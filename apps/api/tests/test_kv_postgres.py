"""PostgresKV — real-Postgres verification (skipped without a live URL).

Run against a scratch Postgres (Supabase is fine):

    KVPG_TEST_URL="postgresql+asyncpg://..." ./.venv/bin/python -m pytest \
        tests/test_kv_postgres.py -q

Exercises every KV verb plus the property the serverless deploy needs:
state written through one PostgresKV instance is visible through another
(simulating two lambda instances).
"""

import asyncio
import os
from collections.abc import AsyncIterator

import pytest

from app.core.kv import KV, PostgresKV, get_kv

pytestmark = [
    pytest.mark.skipif(
        not os.environ.get("KVPG_TEST_URL"),
        reason="KVPG_TEST_URL not set (live-Postgres test)",
    ),
]


def _reset_singletons() -> None:
    from app.core import kv as kv_mod
    from app.core.config import get_settings

    kv_mod.set_kv(None)
    get_settings.cache_clear()


async def _dispose_engine() -> None:
    """Drop the shared engine — asyncpg conns are bound to one event loop."""
    from app.db.session import dispose_engine

    await dispose_engine()


@pytest.fixture()
async def kv() -> AsyncIterator[PostgresKV]:
    os.environ["poipoihisab_KV_URL"] = os.environ["KVPG_TEST_URL"]
    os.environ["poipoihisab_DATABASE_URL"] = os.environ["KVPG_TEST_URL"]
    _reset_singletons()
    store = PostgresKV()
    yield store
    await _dispose_engine()
    os.environ.pop("poipoihisab_KV_URL", None)
    _reset_singletons()


@pytest.fixture()
def second_instance(kv: PostgresKV) -> PostgresKV:
    """A second PostgresKV on the same DB — simulates another lambda."""
    return PostgresKV()


async def test_string_lifecycle(kv: PostgresKV, second_instance: PostgresKV) -> None:
    await kv.delete("t:str")
    assert await kv.get("t:str") is None
    assert await kv.exists("t:str") is False
    assert await kv.ttl("t:str") == -2

    await kv.setex("t:str", 60, "hello")
    # visible through the second instance (the serverless property)
    assert await second_instance.get("t:str") == "hello"
    assert await second_instance.exists("t:str") is True
    ttl = await second_instance.ttl("t:str")
    assert 0 < ttl <= 60

    await kv.setex("t:str", 60, "updated")
    assert await second_instance.get("t:str") == "updated"

    await kv.delete("t:str")
    assert await second_instance.get("t:str") is None


async def test_expiry(kv: PostgresKV, second_instance: PostgresKV) -> None:
    # TTL generous enough to outlive cross-continent DB round-trips.
    await kv.delete("t:exp")
    await kv.setex("t:exp", 5, "soon")
    assert await kv.get("t:exp") == "soon"
    await asyncio.sleep(5.5)
    assert await second_instance.get("t:exp") is None
    assert await second_instance.exists("t:exp") is False
    assert await second_instance.ttl("t:exp") == -2


async def test_incr_rate_limit_window(kv: PostgresKV) -> None:
    await kv.delete("t:rl")
    assert await kv.incr("t:rl", 60) == 1
    assert await kv.incr("t:rl", 60) == 2
    assert await kv.incr("t:rl", 60) == 3


async def test_sets_cross_instance(kv: PostgresKV, second_instance: PostgresKV) -> None:
    await kv.delete("t:set")
    await kv.sadd("t:set", "sess-a", ttl_seconds=120)
    await kv.sadd("t:set", "sess-b", ttl_seconds=120)
    assert await second_instance.smembers("t:set") == {"sess-a", "sess-b"}

    await kv.srem("t:set", "sess-a")
    assert await second_instance.smembers("t:set") == {"sess-b"}

    await kv.srem("t:set", "sess-b")  # empty set -> key gone (Redis semantics)
    assert await second_instance.smembers("t:set") == set()
    assert await second_instance.exists("t:set") is False


async def test_namespace_flip(kv: PostgresKV) -> None:
    await kv.delete("t:flip")
    await kv.sadd("t:flip", "m1", ttl_seconds=60)
    await kv.setex("t:flip", 60, "now-a-string")  # string write clears the set
    assert await kv.smembers("t:flip") == set()
    assert await kv.get("t:flip") == "now-a-string"

    await kv.sadd("t:flip", "m2", ttl_seconds=60)  # set write clears the string
    assert await kv.get("t:flip") is None
    assert await kv.smembers("t:flip") == {"m2"}


async def test_get_kv_selects_postgres() -> None:
    os.environ["poipoihisab_KV_URL"] = "postgresql://u:p@h/db"
    _reset_singletons()
    try:
        assert isinstance(get_kv(), PostgresKV)
        assert isinstance(get_kv(), KV)
    finally:
        os.environ.pop("poipoihisab_KV_URL", None)
        _reset_singletons()
