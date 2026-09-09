"""Vercel serverless entrypoint for the Poi Poi Hisab API (FastAPI / ASGI).

The monorepo keeps the FastAPI source in ``apps/api``; this shim puts it on
``sys.path`` and exposes the ASGI ``app`` for Vercel's Python runtime. The
``apps/api/app`` package itself is bundled into the lambda via the
``includeFiles`` entry in ``vercel.json``.
"""

import sys
from pathlib import Path

_API_SRC = Path(__file__).resolve().parent.parent / "apps" / "api"
if str(_API_SRC) not in sys.path:
    sys.path.insert(0, str(_API_SRC))

from app.main import app  # noqa: E402  (path set up above, deliberately late)

# Vercel's @vercel/python builder auto-detects the FastAPI/Starlette ``app``.
handler = app
