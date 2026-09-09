"""Minimal async KV abstraction used for sessions and rate limiting.

Three backends:

* :class:`RedisKV` — real Redis via ``redis.asyncio``, selected when
  ``poipoihisab_KV_URL`` is a ``redis://`` URL.
* :class:`PostgresKV` — SQL-backed store on the app's existing async engine
  (Supabase), selected when ``poipoihisab_KV_URL`` is a ``postgres://`` URL.
  Built for serverless deploys (Vercel): state lives in Postgres, so all
  lambda instances share the same sessions/rate-limits.
* :class:`MemoryKV` — plain dict with per-key TTLs (loop-time based), used
  when ``poipoihisab_KV_URL`` is empty (tests + local dev).

Keys used by the auth layer (all values are strings):

* ``rt:<sha256-of-refresh-token>`` → session id (TTL = refresh TTL)
* ``sess:<session-id>`` → ``"<profile-id>:<sha256-of-current-refresh>"``
  (TTL = refresh TTL; presence also proves the session is alive)
* ``user_sess:<profile-id>`` → SET of that profile's live session ids
  (ADR-0024; TTL = refresh TTL, refreshed on every login/rotation so the
  index never expires before the sessions it points at)
* ``rl:<ip>|<email-or-'-'>`` → fixed-window rate-limit counter
"""

import asyncio
import random
import time
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from app.core.config import get_settings


class KV(ABC):
    """Tiny async key/value interface mirroring the Redis verbs we need."""

    @abstractmethod
    async def get(self, key: str) -> str | None:
        """Value stored at ``key`` or ``None`` (expired/missing)."""

    @abstractmethod
    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        """Set ``key`` to ``value`` with an expiry."""

    @abstractmethod
    async def delete(self, *keys: str) -> None:
        """Delete one or more keys (missing keys are ignored)."""

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Whether a live (non-expired) ``key`` exists."""

    @abstractmethod
    async def ttl(self, key: str) -> int:
        """Remaining TTL in seconds; -1 no expiry, -2 missing (Redis semantics)."""

    @abstractmethod
    async def incr(self, key: str, ttl_seconds: int) -> int:
        """Atomically increment, setting ``ttl_seconds`` on first hit (INCR+EXPIRE)."""

    @abstractmethod
    async def sadd(self, key: str, member: str, ttl_seconds: int | None = None) -> None:
        """Add ``member`` to the set at ``key`` (creating it if missing).

        ``ttl_seconds`` refreshes the key's expiry alongside the write —
        mirroring how :meth:`setex` refreshes TTL on string writes — so set
        keys stay on the same lazy-TTL lifecycle as every other key. Pass
        ``None`` to keep an existing expiry untouched.
        """

    @abstractmethod
    async def srem(self, key: str, *members: str) -> None:
        """Remove ``members`` from the set at ``key`` (missing keys/members are ignored).

        A set that becomes empty is deleted outright (Redis SREM semantics),
        so no empty-set husks linger in the store.
        """

    @abstractmethod
    async def smembers(self, key: str) -> set[str]:
        """Members of the set at ``key`` (empty set when missing/expired)."""

    async def aclose(self) -> None:
        """Release backend resources (no-op for in-memory)."""


def _loop_time() -> float:
    try:
        return asyncio.get_running_loop().time()
    except RuntimeError:  # pragma: no cover - only outside a running loop
        return time.monotonic()


class MemoryKV(KV):
    """Dict-backed KV with lazy TTL expiry; fallback for tests/local dev."""

    def __init__(self) -> None:
        # key -> (value, expires_at | None); expires_at uses loop time.
        self._data: dict[str, tuple[str, float | None]] = {}
        # Set keys (SADD/SREM/SMEMBERS), same lazy-TTL tuple shape. Kept in a
        # separate map so string and set namespaces can never collide.
        self._sets: dict[str, tuple[set[str], float | None]] = {}

    def _alive_item(self, key: str) -> tuple[Any, float | None] | None:
        """Live item (string value or set) at ``key``, lazy-expiring it if dead.

        Checks both namespaces so ``exists``/``ttl`` answer coherently no
        matter which store owns the key.
        """
        item = self._data.get(key) or self._sets.get(key)
        if item is None:
            return None
        _, expires_at = item
        if expires_at is not None and expires_at <= _loop_time():
            self._data.pop(key, None)
            self._sets.pop(key, None)
            return None
        return item

    def _alive(self, key: str) -> tuple[str, float | None] | None:
        item = self._alive_item(key)
        return item if item is not None and isinstance(item[0], str) else None

    def _alive_set(self, key: str) -> set[str] | None:
        item = self._alive_item(key)
        return item[0] if item is not None and isinstance(item[0], set) else None

    async def get(self, key: str) -> str | None:
        item = self._alive(key)
        return item[0] if item is not None else None

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        self._sets.pop(key, None)  # one namespace owner per key
        self._data[key] = (value, _loop_time() + ttl_seconds)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self._data.pop(key, None)
            self._sets.pop(key, None)

    async def exists(self, key: str) -> bool:
        return self._alive_item(key) is not None

    async def ttl(self, key: str) -> int:
        item = self._alive_item(key)
        if item is None:
            return -2
        expires_at = item[1]
        if expires_at is None:
            return -1
        return max(0, int(expires_at - _loop_time()))

    async def incr(self, key: str, ttl_seconds: int) -> int:
        item = self._alive(key)
        if item is None:
            self._data[key] = ("1", _loop_time() + ttl_seconds)
            return 1
        value, expires_at = item
        new_count = int(value) + 1
        self._data[key] = (str(new_count), expires_at)
        return new_count

    async def sadd(self, key: str, member: str, ttl_seconds: int | None = None) -> None:
        self._data.pop(key, None)  # one namespace owner per key
        members = self._alive_set(key)
        if members is None:
            members = set()
            expires_at = None if ttl_seconds is None else _loop_time() + ttl_seconds
            self._sets[key] = (members, expires_at)
        elif ttl_seconds is not None:
            self._sets[key] = (members, _loop_time() + ttl_seconds)
        members.add(member)

    async def srem(self, key: str, *members: str) -> None:
        if not members:
            return
        live = self._alive_set(key)
        if live is None:
            return
        live.difference_update(members)
        if not live:  # Redis semantics: empty set -> key gone
            self._sets.pop(key, None)

    async def smembers(self, key: str) -> set[str]:
        members = self._alive_set(key)
        return set(members) if members is not None else set()


class RedisKV(KV):
    """Redis backend (``redis.asyncio``), selected via a ``redis://`` KV URL."""

    def __init__(self, url: str) -> None:
        import redis.asyncio as aioredis  # lazy: only needed for this backend

        self._redis: aioredis.Redis = aioredis.Redis.from_url(
            url, decode_responses=True
        )

    async def get(self, key: str) -> str | None:
        result = await self._redis.get(key)
        if result is None:
            return None
        # decode_responses=True yields str, but stay robust to bytes.
        return result if isinstance(result, str) else result.decode("utf-8")

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        await self._redis.setex(key, ttl_seconds, value)

    async def delete(self, *keys: str) -> None:
        if keys:
            await self._redis.delete(*keys)

    async def exists(self, key: str) -> bool:
        return bool(await self._redis.exists(key))

    async def ttl(self, key: str) -> int:
        return int(await self._redis.ttl(key))

    async def incr(self, key: str, ttl_seconds: int) -> int:
        count = int(await self._redis.incr(key))
        if count == 1:
            await self._redis.expire(key, ttl_seconds)
        return count

    async def sadd(self, key: str, member: str, ttl_seconds: int | None = None) -> None:
        await self._redis.sadd(key, member)
        if ttl_seconds is not None:
            await self._redis.expire(key, ttl_seconds)

    async def srem(self, key: str, *members: str) -> None:
        if members:
            await self._redis.srem(key, *members)

    async def smembers(self, key: str) -> set[str]:
        result = await self._redis.smembers(key)
        # decode_responses=True yields str, but stay robust to bytes.
        return {m if isinstance(m, str) else m.decode("utf-8") for m in result}

    async def aclose(self) -> None:
        await self._redis.aclose()


_kv: KV | None = None

_KV_DDL = """
CREATE TABLE IF NOT EXISTS kv_store (
    key    text        NOT NULL,
    kind   text        NOT NULL,
    member text        NOT NULL DEFAULT '',
    val    text,
    exp    timestamptz,
    PRIMARY KEY (key, kind, member)
)
"""
_KV_EXP_IDX = """
CREATE INDEX IF NOT EXISTS kv_store_exp_idx ON kv_store (exp) WHERE exp IS NOT NULL
"""


class PostgresKV(KV):
    """SQL-backed KV on the app's shared async engine (Supabase Postgres).

    Layout: one table, two namespaces mirroring :class:`MemoryKV` — string
    keys are ``kind='s'`` rows (``member=''``), set members are ``kind='m'``
    rows (one per member, ``val=NULL``). Writes flip namespaces like MemoryKV
    (a ``setex`` clears the key's set rows and vice versa). Expiry is a
    ``timestamptz`` compared against the database clock, so every lambda
    instance agrees on liveness — the property serverless needs.
    """

    def __init__(self) -> None:
        from app.db.session import get_engine_and_sessionmaker

        self._engine = get_engine_and_sessionmaker()[0]
        self._ready = False

    async def _ensure(self) -> None:
        if not self._ready:
            async with self._engine.begin() as conn:
                await conn.execute(text(_KV_DDL))
                await conn.execute(text(_KV_EXP_IDX))
            self._ready = True

    @staticmethod
    def _now() -> datetime:
        return datetime.now(UTC)

    async def _gc(self, conn: Any) -> None:
        # Opportunistic sweep of globally-dead rows (cheap, indexed).
        if random.random() < 0.02:
            await conn.execute(
                text("DELETE FROM kv_store WHERE exp IS NOT NULL AND exp <= :now"),
                {"now": self._now()},
            )

    async def get(self, key: str) -> str | None:
        await self._ensure()
        async with self._engine.begin() as conn:
            row = (
                await conn.execute(
                    text(
                        "SELECT val, exp FROM kv_store "
                        "WHERE key = :key AND kind = 's'"
                    ),
                    {"key": key},
                )
            ).first()
            if row is None:
                return None
            val, exp = row
            if exp is not None and exp <= self._now():
                await conn.execute(
                    text("DELETE FROM kv_store WHERE key = :key AND kind = 's'"),
                    {"key": key},
                )
                return None
            return val

    async def setex(self, key: str, ttl_seconds: int, value: str) -> None:
        await self._ensure()
        exp = self._now() + _td(seconds=ttl_seconds)
        async with self._engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM kv_store WHERE key = :key AND kind = 'm'"),
                {"key": key},
            )
            await conn.execute(
                text(
                    "INSERT INTO kv_store (key, kind, member, val, exp) "
                    "VALUES (:key, 's', '', :val, :exp) "
                    "ON CONFLICT (key, kind, member) "
                    "DO UPDATE SET val = EXCLUDED.val, exp = EXCLUDED.exp"
                ),
                {"key": key, "val": value, "exp": exp},
            )

    async def delete(self, *keys: str) -> None:
        if not keys:
            return
        await self._ensure()
        async with self._engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM kv_store WHERE key = ANY(:keys)"),
                {"keys": list(keys)},
            )

    async def exists(self, key: str) -> bool:
        await self._ensure()
        async with self._engine.begin() as conn:
            row = (
                await conn.execute(
                    text(
                        "SELECT exp FROM kv_store WHERE key = :key "
                        "ORDER BY (kind = 's') DESC LIMIT 1"
                    ),
                    {"key": key},
                )
            ).first()
            if row is None:
                return False
            (exp,) = row
            if exp is not None and exp <= self._now():
                await conn.execute(
                    text("DELETE FROM kv_store WHERE key = :key"), {"key": key}
                )
                return False
            return True

    async def ttl(self, key: str) -> int:
        await self._ensure()
        async with self._engine.begin() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT exp FROM kv_store WHERE key = :key "
                        "ORDER BY (kind = 's') DESC LIMIT 1"
                    ),
                    {"key": key},
                )
            ).first()
            if rows is None:
                return -2
            (exp,) = rows
            if exp is None:
                return -1
            remaining = (exp - self._now()).total_seconds()
            if remaining <= 0:
                await conn.execute(
                    text("DELETE FROM kv_store WHERE key = :key"), {"key": key}
                )
                return -2
            return max(0, int(remaining))

    async def incr(self, key: str, ttl_seconds: int) -> int:
        await self._ensure()
        now = self._now()
        exp = now + _td(seconds=ttl_seconds)
        async with self._engine.begin() as conn:
            await self._gc(conn)
            await conn.execute(
                text("DELETE FROM kv_store WHERE key = :key AND kind = 'm'"),
                {"key": key},
            )
            row = (
                await conn.execute(
                    text(
                        "INSERT INTO kv_store (key, kind, member, val, exp) "
                        "VALUES (:key, 's', '', '1', :exp) "
                        "ON CONFLICT (key, kind, member) DO UPDATE SET "
                        "val = CASE WHEN kv_store.exp IS NULL OR kv_store.exp > :now "
                        "THEN ((kv_store.val)::int + 1)::text ELSE '1' END, "
                        "exp = CASE WHEN kv_store.exp IS NULL OR kv_store.exp > :now "
                        "THEN kv_store.exp ELSE :exp END "
                        "RETURNING val"
                    ),
                    {"key": key, "exp": exp, "now": now},
                )
            ).first()
        assert row is not None
        return int(row[0])

    async def sadd(
        self, key: str, member: str, ttl_seconds: int | None = None
    ) -> None:
        await self._ensure()
        exp = None if ttl_seconds is None else self._now() + _td(seconds=ttl_seconds)
        async with self._engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM kv_store WHERE key = :key AND kind = 's'"),
                {"key": key},
            )
            await conn.execute(
                text(
                    "INSERT INTO kv_store (key, kind, member, val, exp) "
                    "VALUES (:key, 'm', :member, NULL, :exp) "
                    "ON CONFLICT (key, kind, member) DO UPDATE SET "
                    "exp = COALESCE(:exp, kv_store.exp)"
                ),
                {"key": key, "member": member, "exp": exp},
            )
            if exp is not None:
                # Refresh the whole set's expiry (Redis EXPIRE semantics).
                await conn.execute(
                    text(
                        "UPDATE kv_store SET exp = :exp "
                        "WHERE key = :key AND kind = 'm'"
                    ),
                    {"key": key, "exp": exp},
                )

    async def srem(self, key: str, *members: str) -> None:
        if not members:
            return
        await self._ensure()
        async with self._engine.begin() as conn:
            await conn.execute(
                text(
                    "DELETE FROM kv_store WHERE key = :key AND kind = 'm' "
                    "AND member = ANY(:members)"
                ),
                {"key": key, "members": list(members)},
            )

    async def smembers(self, key: str) -> set[str]:
        await self._ensure()
        now = self._now()
        async with self._engine.begin() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT member, exp FROM kv_store "
                        "WHERE key = :key AND kind = 'm'"
                    ),
                    {"key": key},
                )
            ).all()
            if not rows:
                return set()
            alive: set[str] = set()
            dead = False
            for member, exp in rows:
                if exp is not None and exp <= now:
                    dead = True
                    continue
                alive.add(member)
            if dead or (not alive and rows):
                await conn.execute(
                    text("DELETE FROM kv_store WHERE key = :key AND kind = 'm'"),
                    {"key": key},
                )
            return alive


def _td(seconds: int) -> Any:
    """TTL seconds as a timedelta the driver adapts to an interval."""
    from datetime import timedelta

    return timedelta(seconds=seconds)


def get_kv() -> KV:
    """Return the process-wide KV backend, building it from settings once."""
    global _kv
    if _kv is None:
        url = get_settings().kv_url
        scheme = url.split(":", 1)[0].lower()
        if scheme.startswith("postgres"):
            _kv = PostgresKV()
        elif url:
            _kv = RedisKV(url)
        else:
            _kv = MemoryKV()
    return _kv


def set_kv(kv: KV | None) -> None:
    """Replace (or reset with ``None``) the process-wide KV — test hook."""
    global _kv
    _kv = kv


async def close_kv() -> None:
    """Close and reset the process-wide KV (graceful shutdown)."""
    global _kv
    if _kv is not None:
        await _kv.aclose()
    _kv = None
