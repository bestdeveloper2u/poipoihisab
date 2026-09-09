import logging
from collections.abc import AsyncIterator

import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

logger = logging.getLogger("poipoihisab.db")

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_schema_ready: bool = False


def get_engine_and_sessionmaker() -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    """Create (once) and return the process-wide async engine + sessionmaker."""
    global _engine, _sessionmaker
    if _engine is None or _sessionmaker is None:
        settings = get_settings()
        connect_args: dict = {}
        if "pooler.supabase.com" in settings.database_url or "pgbouncer=true" in settings.database_url:
            # Transaction-mode poolers (pgbouncer/Supabase pooler) do not support
            # asyncpg prepared statements — disable the driver-level cache.
            connect_args["statement_cache_size"] = 0
        _engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            connect_args=connect_args,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine, _sessionmaker


async def ensure_schema_ready(engine: AsyncEngine) -> None:
    """Ensure newly added columns exist in existing production databases.

    Prevents 500 crashes on serverless deploys (e.g. Vercel) where Alembic
    DDL migrations cannot be run automatically during deployment.
    """
    global _schema_ready
    if _schema_ready:
        return

    def _sync_upgrade(sync_conn: sa.Connection) -> None:
        insp = sa.inspect(sync_conn)
        if not insp.has_table("profiles"):
            return
        cols = {c["name"] for c in insp.get_columns("profiles")}
        if "is_superadmin" not in cols:
            sync_conn.execute(
                text("ALTER TABLE profiles ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT FALSE")
            )
        if "is_suspended" not in cols:
            sync_conn.execute(
                text("ALTER TABLE profiles ADD COLUMN is_suspended BOOLEAN NOT NULL DEFAULT FALSE")
            )

    try:
        async with engine.begin() as conn:
            await conn.run_sync(_sync_upgrade)
        _schema_ready = True
    except Exception as exc:  # noqa: BLE001 — best-effort startup boundary; requests retry.
        logger.warning("ensure_schema_ready non-fatal notice: %s", type(exc).__name__)


async def dispose_engine() -> None:
    """Dispose the engine if it was created (used on graceful shutdown)."""
    global _engine, _sessionmaker, _schema_ready
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
    _schema_ready = False


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an ``AsyncSession``.

    Rollback on error, always close.
    """
    engine, sessionmaker = get_engine_and_sessionmaker()
    if not _schema_ready:
        await ensure_schema_ready(engine)
    session = sessionmaker()
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
