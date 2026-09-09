"""FastAPI application entrypoint.

Phase 1: health + auth (register/login/refresh/logout/me, rotating refresh
tokens per ADR-0002). Phase 2: expenses CRUD + bulk (keyset cursor
pagination), rule-based Bengali voice parsing, and cached monthly/yearly
reports. Phase 3: debts CRUD + pay close-out (PARTIAL/FULL), monthly
budgets with spend/usage breakdown, and CSV export. T15.3: full-fidelity
JSON backup (GET /export/backup.json) + replace-semantics restore
(POST /import/restore, ADR-0012). T16.1: recurring-expense rules + the
idempotent materialization run (POST /recurring/run, ADR-0014). Run locally:
uv run uvicorn app.main:app --reload
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.kv import close_kv
from app.core.security_headers import SecurityHeadersMiddleware
from app.db.session import dispose_engine
from app.routers import (
    admin,
    auth,
    backup,
    budgets,
    debts,
    expenses,
    export,
    health,
    recurring,
    reports,
    sheets,
    voice,
)

logger = logging.getLogger("poipoihisab.api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.google_sheets_sa_file:
        # Bridge the pydantic-prefixed setting into os.environ so the Sheets
        # router (which reads the env directly for testability) sees it.
        os.environ.setdefault(
            "poipoihisab_GOOGLE_SHEETS_SA_FILE", settings.google_sheets_sa_file
        )
    logger.info(
        "Starting %s v%s (env=%s)", settings.app_name, settings.version, settings.env
    )
    # Ensure database schema compatibility on boot
    try:
        from app.db.session import ensure_schema_ready, get_engine_and_sessionmaker
        engine, _ = get_engine_and_sessionmaker()
        await ensure_schema_ready(engine)
    except Exception as exc:  # noqa: BLE001 — startup must retain owner's best-effort behavior.
        logger.warning("Auto schema migration check skipped or failed on boot: %s", type(exc).__name__)
    yield
    await close_kv()
    await dispose_engine()
    logger.info("Shutting down %s", settings.app_name)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Poi Poi Hisab API",
        version=settings.version,
        docs_url="/api/docs",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # T19.4 (ADR-0018): nosniff + referrer-policy on every response,
    # including 404s and error responses.
    app.add_middleware(SecurityHeadersMiddleware)
    # Versioned surface ...
    app.include_router(health.router, prefix="/api/v1")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(expenses.router, prefix="/api/v1")
    app.include_router(debts.router, prefix="/api/v1")
    app.include_router(budgets.router, prefix="/api/v1")
    app.include_router(voice.router, prefix="/api/v1")
    app.include_router(reports.router, prefix="/api/v1")
    app.include_router(recurring.router, prefix="/api/v1")
    app.include_router(export.router, prefix="/api/v1")
    app.include_router(sheets.router, prefix="/api/v1")
    app.include_router(backup.export_router, prefix="/api/v1")
    app.include_router(backup.import_router, prefix="/api/v1")
    app.include_router(admin.router, prefix="/api/v1")
    # ... plus a root-level /healthz for load balancers (same handler).
    app.include_router(health.router)
    return app


app = create_app()
