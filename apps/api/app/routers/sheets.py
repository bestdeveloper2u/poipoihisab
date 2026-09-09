"""Owner-scoped CSV-compatible Google Sheets export using a service account.

The destination must be shared with the status endpoint's service-account email.
Each export appends a header and the selected rows; repeated exports are not deduplicated.
Google calls run in worker threads, use bounded timeouts, and never follow redirects.
"""

import calendar
import csv
import io
import json
import os
import re
from datetime import date
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # runtime bindings are populated lazily by _ensure_google()
    import requests  # noqa: TC004
    from google.auth.exceptions import GoogleAuthError  # noqa: TC004
    from google.auth.transport.requests import Request  # noqa: TC004
    from google.oauth2 import service_account  # noqa: TC004


def __getattr__(name: str) -> Any:
    """PEP 562 — lazily surface google bindings to external module access."""
    if name in ('requests', 'GoogleAuthError', 'Request', 'service_account'):
        _ensure_google()
        return globals()[name]
    raise AttributeError(f'module {__name__!r} has no attribute {name!r}')

from urllib.parse import quote, urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import AliasChoices, BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.routers.export import CurrentUser, DbDep, _csv_bytes

# google-auth is imported lazily (first Sheets use) — keeps serverless cold
# starts lean for the 99% of traffic that never touches Sheets. Tests patch
# module attributes (sheets.service_account), so the lazy loader must respect
# already-present attributes instead of overwriting them.


def _ensure_google() -> None:
    """Populate module-level google bindings on first use (idempotent)."""
    if 'service_account' in globals():
        return
    try:
        import requests
        from google.auth import exceptions as _gex
        from google.auth.transport import requests as _gtr
        from google.oauth2 import service_account as _sa

        globals()['requests'] = requests
        globals()['GoogleAuthError'] = _gex.GoogleAuthError
        globals()['Request'] = _gtr.Request
        globals()['service_account'] = _sa
    except ImportError:  # Keep CSV/the rest of the API usable without the optional integration.
        globals()['service_account'] = None
        globals()['GoogleAuthError'] = Exception
        globals()['requests'] = None
        globals()['Request'] = None

router = APIRouter(prefix="/export/sheets", tags=["export"])
_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
_TAB = "Poi Poi Hisab"
_TIMEOUT = (5, 30)
_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
_ID = r"[A-Za-z0-9_-]{1,200}"


def _error(status: int, code: str, bn: str, en: str) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={
            "code": code,
            "message_bn": bn,
            "message_en": en,
        },
    )


def _unconfigured() -> HTTPException:
    return _error(
        503,
        "sheets_unconfigured",
        "Google Sheets রপ্তানি চালু নেই",
        "Google Sheets export is not configured",
    )


def _upstream() -> HTTPException:
    return _error(
        502,
        "sheets_upstream_error",
        "Google Sheets-এ রপ্তানি ব্যর্থ হয়েছে",
        "Google Sheets export failed; some rows may already have been appended",
    )


def _sa_value() -> str | None:
    """Raw ``POIPOIHISAB_GOOGLE_SHEETS_SA_FILE`` value (path OR inline JSON)."""
    from app.core.config import get_settings

    settings = get_settings()
    if settings.google_sheets_sa_file:
        return settings.google_sheets_sa_file
    return (
        os.environ.get("POIPOIHISAB_GOOGLE_SHEETS_SA_FILE")
        or os.environ.get("poipoihisab_GOOGLE_SHEETS_SA_FILE")
        or None
    )


def _load_sa_info() -> dict[str, Any] | None:
    """Load the service-account info from a file path or inline JSON content.

    Inline JSON (value starting with ``{``) is how Vercel serverless deploys
    receive the credential — serverless filesystems have no persistent file.
    """
    _ensure_google()
    if service_account is None:
        return None
    value = _sa_value()
    if not value:
        return None
    try:
        if value.lstrip().startswith("{"):
            info = json.loads(value)
        else:
            with open(value, encoding="utf-8") as source:
                info = json.load(source)
    except (OSError, ValueError):
        return None
    if not isinstance(info, dict):
        return None
    return info


def _configuration() -> dict[str, Any] | None:
    return _load_sa_info()


class SheetsExportRequest(BaseModel):
    sheet_id: str = Field(validation_alias=AliasChoices("sheet", "sheet_id", "sheet_url"))
    month: str | None = None

    @field_validator("sheet_id", mode="before")
    @classmethod
    def validate_sheet(cls, value: Any) -> str:
        invalid = _error(
            422,
            "sheets_invalid_sheet",
            "সঠিক Google Sheets লিংক বা আইডি দিন",
            "Provide a valid Google Sheets ID or HTTPS docs.google.com spreadsheet URL",
        )
        if not isinstance(value, str) or len(value) > 2048 or any(ord(c) < 32 for c in value):
            raise invalid
        value = value.strip()
        if re.fullmatch(_ID, value):
            return value
        try:
            url = urlsplit(value)
            match = re.fullmatch(
                rf"/spreadsheets/d/({_ID})(?:/(?:edit|view|preview|copy))?/?", url.path
            )
            if url.scheme != "https" or url.netloc != "docs.google.com" or match is None:
                raise invalid
            return match.group(1)
        except ValueError:
            raise invalid from None

    @field_validator("month", mode="before")
    @classmethod
    def validate_month(cls, value: Any) -> str | None:
        if value is None:
            return None
        if (
            not isinstance(value, str)
            or not re.fullmatch(r"[0-9]{4}-(?:0[1-9]|1[0-2])", value)
            or value.startswith("0000")
        ):
            raise _error(
                422,
                "sheets_invalid_month",
                "মাস YYYY-MM আকারে দিন",
                "Month must be YYYY-MM with a valid year and month",
            )
        return value


class SheetsStatus(BaseModel):
    configured: bool
    sa_email: str | None


class SheetsExportResult(BaseModel):
    rows: int


@router.get("/status")
async def sheets_status(user: CurrentUser) -> SheetsStatus:
    info = await run_in_threadpool(_configuration)
    return SheetsStatus(
        configured=info is not None,
        sa_email=(info.get("client_email") or None) if info else None,
    )


def _token() -> str:
    _ensure_google()
    try:
        info = _load_sa_info()
        if info is None:
            raise KeyError("poipoihisab_GOOGLE_SHEETS_SA_FILE")
        credentials = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
    except (OSError, KeyError, ValueError, TypeError, GoogleAuthError):
        raise _unconfigured() from None

    class BoundedRequest(Request):
        def __call__(self, *args: Any, **kwargs: Any) -> Any:
            kwargs["timeout"] = _TIMEOUT
            return super().__call__(*args, **kwargs)

    try:
        with requests.Session() as session:
            credentials.refresh(BoundedRequest(session=session))
        return str(credentials.token)
    except (GoogleAuthError, requests.RequestException, ValueError):
        raise _upstream() from None


def _google(method: str, url: str, token: str, **kwargs: Any) -> dict[str, Any]:
    _ensure_google()
    try:
        response = requests.request(
            method,
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=_TIMEOUT,
            allow_redirects=False,
            **kwargs,
        )
        if response.status_code == 403:
            raise _error(
                403,
                "sheets_permission_denied",
                "সার্ভিস অ্যাকাউন্টকে শিটের সম্পাদনার অনুমতি দিন",
                "Share the spreadsheet with the service account as an editor",
            )
        if not 200 <= response.status_code < 300:
            raise _upstream()
        result = response.json()
        if not isinstance(result, dict):
            raise _upstream()
        return result
    except (requests.RequestException, ValueError):
        raise _upstream() from None


def _safe_text(value: str) -> str:
    # CSV already escapes direct prefixes. Also defend whitespace-prefixed formulas
    # and newlines under Sheets' USER_ENTERED interpretation, in every text column.
    if value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r", "\n")):
        return "'" + value
    return value


@router.post("")
async def export_sheets(
    body: SheetsExportRequest, db: DbDep, user: CurrentUser
) -> SheetsExportResult:
    info = await run_in_threadpool(_configuration)
    if info is None:
        raise _unconfigured()
    token = await run_in_threadpool(_token)
    base = f"{_BASE}/{body.sheet_id}"
    metadata = await run_in_threadpool(
        _google, "GET", base, token, params={"fields": "sheets.properties.title"}
    )
    try:
        exists = any(sheet["properties"]["title"] == _TAB for sheet in metadata.get("sheets", []))
    except (TypeError, KeyError, AttributeError):
        raise _upstream() from None
    if not exists:
        await run_in_threadpool(
            _google,
            "POST",
            base + ":batchUpdate",
            token,
            json={"requests": [{"addSheet": {"properties": {"title": _TAB}}}]},
        )
    start = end = None
    if body.month:
        year, month = map(int, body.month.split("-"))
        start = date(year, month, 1)
        end = date(year, month, calendar.monthrange(year, month)[1])
    # Reuse CSV's owner filter, date bounds, keyset pagination, column ordering,
    # nullable descriptions and Decimal money serialization instead of duplicating SQL.
    header: list[str] = []
    count = 0
    append_url = base + "/values/" + quote(f"'{_TAB}'!A:F", safe="") + ":append"
    async for chunk in _csv_bytes(db, user.id, start, end):
        values = list(csv.reader(io.StringIO(chunk.decode("utf-8-sig"), newline="")))
        if not header:
            header = values[0]
            continue
        for row in values:
            for index in (1, 2, 3, 5):
                row[index] = _safe_text(row[index])
            row[4] = row[4].translate(_DIGITS)
        expense_count = len(values)
        if count == 0:
            values.insert(0, header)
        await run_in_threadpool(
            _google,
            "POST",
            append_url,
            token,
            params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
            json={"majorDimension": "ROWS", "values": values},
        )
        count += expense_count
    if count == 0:
        await run_in_threadpool(
            _google,
            "POST",
            append_url,
            token,
            params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
            json={"majorDimension": "ROWS", "values": [header]},
        )
    return SheetsExportResult(rows=count)
