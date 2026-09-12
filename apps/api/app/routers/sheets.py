"""Owner-scoped Google Sheets export into the দৈনিক খরচের হিসাব workbook.

The destination must be shared with the status endpoint's service-account email.
Google calls run in worker threads, use bounded timeouts, and never follow redirects.

── WHY THIS WRITES INTO MONTH TABS AND NOT ONE FLAT SHEET ──────────────────

It used to append every row to a tab literally named "Poi Poi Hisab", with the
CSV's own header. Pointed at the workbook the owner actually keeps, that was
wrong in three ways at once, and each failed silently:

  * The CSV order is date, description, GROUP, CATEGORY. The workbook's monthly
    sheets are date, description, CATEGORY, GROUP — and their group column is a
    formula. Appending CSV order put the group into the category dropdown and
    overwrote the formula with a category name, so every SUMIF on the sheet
    stopped matching.
  * The amount was translated to Bengali digits. Under USER_ENTERED, "৪৮০.০০"
    is text, not a number: the figure appears on the row and every SUM and
    SUMIF ignores it. A sheet whose whole purpose is to total things cannot
    receive its numbers as text.
  * Appending meant a second sync duplicated the month. The README warned
    about it, which is not the same as fixing it.

So: rows land in the tab for their own month, in that sheet's column order,
with the amount as a number, and the group column is never written — the
sheet's own lookup owns it. A sync REPLACES the month it covers, so running it
twice leaves the same result and an expense edited or deleted in the app is
corrected in the sheet.

Nothing here creates the workbook. R3.3 extends an intact 2026 template with
complete new years, including date validation and a separate yearly summary.
Incomplete years still refuse; they are not silently reconstructed.

── WHY THE LEDGER TABS ARE WRITTEN ON EVERY SYNC ───────────────────────────

Expenses were the only thing this export carried, and the app owns three more
things: debts, the budget, and the recurring rules. A workbook holding only
the expenses is a record of spending, not the ledger — so the sheet could
never be what the owner asked it to be, somewhere to keep working from if the
app went away.

Those three are current state, not a month of history, so `month` does not
apply to them: it narrows which expense months are touched and nothing else,
and every sync rewrites all three in full. The alternative — refresh them only
on a full sync — makes the sheet trustworthy only after the *right* kind of
sync, with nothing on the sheet to say which kind was run last.

A workbook without those tabs is an older copy of the template, not a broken
one. Its ledger tabs are skipped and named in the response, because refusing
would break the expense sync this integration already promises. A missing
MONTH tab still refuses unless it belongs to a wholly absent, extendable year.

The division of labour is the one column D established. Every column the sheet
computes — `অবস্থা` on the debt sheet, `গ্রুপ` and `মাসিক সমমান` on the
recurring sheet, the four computed columns and the reconciliation line on the
budget sheet — is left alone here. `apps/api/scripts/add_ledger_sheets.py`
writes those formulas and names the same geometry; the two files have to agree
about tab titles, first and last row, and which columns are the sheet's own.
"""

import calendar
import csv
import io
import json
import os
import re
import uuid
from datetime import date
from decimal import Decimal
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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.models.budget import Budget
from app.models.debt import Debt
from app.models.recurring import RecurringExpense
from app.routers.export import CurrentUser, DbDep, _csv_bytes, _money
from app.routers.sheets_bootstrap import (
    build_bootstrap_structural,
    build_bootstrap_values,
    is_uninitialized_spreadsheet,
)
from app.routers.sheets_years import SUMMARY, TemplateError, plan_years

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
_TIMEOUT = (5, 30)
_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
_ID = r"[A-Za-z0-9_-]{1,200}"

# Monthly sheet geometry, from the workbook: row 3 is the header, rows 4-203
# are the 200 entry rows, and columns are
#   A তারিখ · B বিবরণ · C খাত · D গ্রুপ (formula) · E পরিমাণ · F পেমেন্ট · G মন্তব্য
_ROW_FIRST, _ROW_LAST = 4, 203
_ROWS_PER_MONTH = _ROW_LAST - _ROW_FIRST + 1

# Tab titles are Bengali month plus Bengali-digit year: "সেপ্টেম্বর ২০২৬".
_BN_MONTHS = (
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
)

# The workbook's payment dropdown reads from 'সেটিংস'!G2:G7 and its validation
# rejects anything else, so the app's enum has to arrive as those exact
# strings. Only `card` differs in wording from the app's own label ("কার্ড").
_PAY_BN = {
    "cash": "নগদ টাকা",
    "bkash": "বিকাশ",
    "nagad": "নগদ (অ্যাপ)",
    "rocket": "রকেট",
    "card": "ডেবিট / ক্রেডিট কার্ড",
    "bank": "ব্যাংক ট্রান্সফার",
}

# Where the workbook keeps its category list. Used twice: to warn the caller
# which categories the sheet cannot place in a group, and to order the budget
# rows the way the settings sheet lists them.
_CATEGORY_RANGE = "'সেটিংস'!B2:B"

# ── The three whole-state ledger tabs ──────────────────────────────────────
# Titles and row bounds are the contract with scripts/add_ledger_sheets.py,
# which builds these sheets. Both files have to name the same numbers.
_TAB_DEBTS = "ধার-দেনা"
_TAB_BUDGET = "বাজেট"
_TAB_RECURRING = "পুনরাবৃত্ত খরচ"

_DEBT_FIRST, _DEBT_LAST = 4, 103
_BUDGET_FIRST, _BUDGET_LAST = 4, 53
_RECUR_FIRST, _RECUR_LAST = 4, 103
_DEBT_ROWS = _DEBT_LAST - _DEBT_FIRST + 1
_BUDGET_ROWS = _BUDGET_LAST - _BUDGET_FIRST + 1
_RECUR_ROWS = _RECUR_LAST - _RECUR_FIRST + 1
#: The budget's single monthly total. One cell, not a row.
_BUDGET_TOTAL_CELL = "D2"

# Each of these dropdowns rejects anything outside its list, so the app's
# enums have to arrive as these exact strings. The wording is the app's own,
# taken from web-i18n (`dGave`/`dTook`, `rFreq*`, `rActive`/`rPaused`), so a
# row reads the same in the sheet as it does on screen.
_DIR_BN = {"lend": "ধার দিয়েছি", "borrow": "ধার নিয়েছি"}
_FREQ_BN = {
    "daily": "প্রতিদিন",
    "weekly": "প্রতি সপ্তাহে",
    "monthly": "প্রতি মাসে",
    "yearly": "প্রতি বছরে",
}
_ACTIVE_ON, _ACTIVE_OFF = "চালু", "বন্ধ"


def _tab_name(year: int, month: int) -> str:
    """Monthly tab title for a year and 1-indexed month."""
    return f"{_BN_MONTHS[month - 1]} {str(year).translate(_DIGITS)}"


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
        "Google Sheets export could not be confirmed; check the sheet before retrying",
    )


def _missing_tabs(tabs: list[str]) -> HTTPException:
    names = ", ".join(tabs)
    return _error(
        409,
        "sheets_missing_month_tab",
        f"শিটে এই মাসের ট্যাব নেই: {names}। ‘দৈনিক খরচের হিসাব’ টেমপ্লেটের কপি ব্যবহার করুন।",
        f"The spreadsheet has no tab for: {names}. Use a copy of the "
        f"দৈনিক খরচের হিসাব template. New years require an intact 2026 template; "
        f"partly missing years must be restored manually.",
    )


def _month_full(details: list[str]) -> HTTPException:
    names = "; ".join(details)
    return _error(
        409,
        "sheets_month_full",
        f"একটি মাসের শিটে {_ROWS_PER_MONTH}টির বেশি এন্ট্রি রাখা যায় না ({names})। "
        "কোনো তথ্য লেখা হয়নি। সব এন্ট্রির জন্য CSV রপ্তানি ব্যবহার করুন।",
        f"A monthly sheet holds {_ROWS_PER_MONTH} entries ({names}). Nothing was "
        "written. Use CSV export for all entries; adding sheet rows does not "
        "increase this integration's fixed template limit.",
    )


def _ledger_full(details: list[str]) -> HTTPException:
    names = "; ".join(details)
    return _error(
        409,
        "sheets_ledger_full",
        f"লেজার শিটে জায়গা নেই ({names})। কোনো তথ্য লেখা হয়নি। "
        "পুরো তালিকার জন্য সেটিংস থেকে ব্যাকআপ ডাউনলোড করুন।",
        f"A ledger sheet in the template has a fixed number of rows ({names}). "
        "Nothing was written: a sheet holding some of the records and not the "
        "rest reads as complete and is not. Use the JSON backup download for "
        "the full set.",
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
    #: Monthly tabs this sync replaced, by their Bengali titles.
    months: list[str] = []
    #: Categories the workbook has no entry for, so its group lookup will leave
    #: their group blank and its "শ্রেণিবিন্যাসহীন" line will name the amount.
    #: Reported rather than corrected — see the module docstring.
    unmapped: list[str] = []
    #: Ledger records written. Zero means the tab was emptied because the app
    #: holds none — a skipped tab is named in ``skipped_tabs`` instead, so the
    #: two cases can be told apart.
    debts: int = 0
    budget_categories: int = 0
    recurring: int = 0
    #: Ledger tabs this workbook does not have. Skipped and named rather than
    #: created: a tab this code fabricated would carry none of the formulas
    #: that make the sheet worth having.
    skipped_tabs: list[str] = []
    #: New month and yearly-summary tabs created by this sync (never existing tabs).
    created_tabs: list[str] = []


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


def _block(
    tab: str, first: int, last: int, rows: list[list[str]],
    columns: str, start: int, stop: int,
) -> dict[str, Any]:
    """One ``values:batchUpdate`` entry: a column span over a tab's own rows.

    Padded to ``last`` with empty strings so a record deleted in the app
    clears its cell instead of being left behind. Empty strings clear; nulls
    would skip the cell and leave the stale value in place. Writing the pad in
    the same request as the data is what makes this idempotent without a
    clear-then-write window in which a failure can empty the tab.
    """
    left, right = columns.split(":")
    values = [row[start:stop] for row in rows]
    values += [[""] * (stop - start) for _ in range(last - first + 1 - len(rows))]
    return {
        "range": f"'{tab}'!{left}{first}:{right}{last}",
        "majorDimension": "ROWS",
        "values": values,
    }


def _decimal_text(value: Any) -> str | None:
    """A budget's per-category limit as a plain two-place decimal, or None.

    ``budgets.cats`` is free-form JSON — JSONB on PostgreSQL, a JSON string on
    SQLite — so a limit can arrive as an int, a float or a string, and a row
    written by an older client can hold something that is not a number at all.
    Unparseable values are dropped rather than written: a limit the sheet
    cannot compute against would silently poison that row's ব্যবহার and
    অবস্থা, which is the failure mode this whole module is about.
    """
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            return None
        return _money(amount)
    # InvalidOperation is an ArithmeticError; TypeError/ValueError cover a
    # value str() cannot render or Decimal cannot parse.
    except (ArithmeticError, ValueError, TypeError):
        return None


async def _debt_rows(db: AsyncSession, user_id: uuid.UUID) -> list[list[str]]:
    """Debt rows in the debt sheet's column order, oldest first.

    ``amt`` is the OUTSTANDING amount, not the original loan: a partial
    payment shrinks it in place (``POST /debts/{id}/pay``), and the app keeps
    no separate original. The sheet's header says বাকি for that reason.

    Column F (অবস্থা) is left empty — the sheet derives it from the settle
    date, so the column and the summary panel cannot disagree.
    """
    stmt = (
        select(Debt.iso, Debt.party, Debt.dir, Debt.amt, Debt.note, Debt.settled_at)
        .where(Debt.user_id == user_id)
        .order_by(Debt.iso, Debt.created_at, Debt.id)
        .limit(_DEBT_ROWS + 1)
    )
    return [
        [
            iso.isoformat(),
            _safe_text(party),
            _DIR_BN.get(direction, _safe_text(direction)),
            _money(amt),
            _safe_text(note or ""),
            "",
            settled.date().isoformat() if settled else "",
        ]
        for iso, party, direction, amt, note, settled in (await db.execute(stmt)).all()
    ]


async def _budget_rows(
    db: AsyncSession, user_id: uuid.UUID, order: list[str]
) -> tuple[str, list[list[str]]]:
    """The monthly total and the per-category limits, settings-sheet order.

    ``order`` is the workbook's own category list. Sorting by it makes the
    budget sheet read down in the same sequence as সেটিংস instead of by
    whatever order a JSON map happens to iterate in; a limit for a category
    the workbook does not list sorts to the end rather than being dropped.
    """
    row = (
        await db.execute(select(Budget.total, Budget.cats).where(Budget.user_id == user_id))
    ).first()
    if row is None:
        return "", []
    total, cats = row
    entries = [
        (str(name), amount)
        for name, value in (cats or {}).items()
        if (amount := _decimal_text(value)) is not None
    ]
    rank = {name: index for index, name in enumerate(order)}
    entries.sort(key=lambda entry: (rank.get(entry[0], len(rank)), entry[0]))
    return _money(total), [[_safe_text(name), amount] for name, amount in entries]


async def _recurring_rows(db: AsyncSession, user_id: uuid.UUID) -> list[list[str]]:
    """Recurring rules in the recurring sheet's column order, oldest first.

    Columns B (গ্রুপ) and J (মাসিক সমমান) are left empty: B is the same
    category-to-group lookup the monthly sheets use, so a rule and an expense
    in one category can never land in different groups, and J is the sheet's
    own monthly-equivalent arithmetic.
    """
    stmt = (
        select(
            RecurringExpense.cat,
            RecurringExpense.amt,
            RecurringExpense.pay,
            RecurringExpense.description,
            RecurringExpense.freq,
            RecurringExpense.start_date,
            RecurringExpense.next_run,
            RecurringExpense.active,
        )
        .where(RecurringExpense.user_id == user_id)
        .order_by(
            RecurringExpense.start_date, RecurringExpense.created_at, RecurringExpense.id
        )
        .limit(_RECUR_ROWS + 1)
    )
    return [
        [
            _safe_text(cat),
            "",
            _money(amt),
            _PAY_BN.get(pay, _safe_text(pay)),
            _safe_text(desc or ""),
            _FREQ_BN.get(freq, _safe_text(freq)),
            start.isoformat(),
            following.isoformat(),
            _ACTIVE_ON if active else _ACTIVE_OFF,
            "",
        ]
        for cat, amt, pay, desc, freq, start, following, active in (
            await db.execute(stmt)
        ).all()
    ]


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
        _google, "GET", base, token,
        params={"fields": "sheets(properties,charts),namedRanges"},
    )
    try:
        titles = {sheet["properties"]["title"] for sheet in metadata.get("sheets", [])}
    except (TypeError, KeyError, AttributeError):
        raise _upstream() from None

    start = end = None
    requested: tuple[int, int] | None = None
    if body.month:
        year, month = map(int, body.month.split("-"))
        requested = (year, month)
        start = date(year, month, 1)
        end = date(year, month, calendar.monthrange(year, month)[1])

    # Reuse CSV's owner filter, date bounds, keyset pagination, column ordering,
    # nullable descriptions and Decimal money serialization instead of
    # duplicating SQL. CSV column order is
    #   0 তারিখ · 1 বিবরণ · 2 গ্রুপ · 3 খাত · 4 পরিমাণ · 5 পেমেন্ট
    # and the group at index 2 is deliberately dropped: the workbook derives it.
    by_month: dict[tuple[int, int], list[list[str]]] = {}
    if requested is not None:
        # An explicitly requested month is always a target, so a month emptied
        # in the app can be emptied in the sheet.
        by_month[requested] = []
    header_seen = False
    async for chunk in _csv_bytes(db, user.id, start, end):
        rows = list(csv.reader(io.StringIO(chunk.decode("utf-8-sig"), newline="")))
        if not header_seen:
            header_seen = True
            rows = rows[1:]
        for row in rows:
            iso, desc, _grp, cat, amt, pay = row[0], row[1], row[2], row[3], row[4], row[5]
            key = (int(iso[0:4]), int(iso[5:7]))
            by_month.setdefault(key, []).append(
                [
                    # ISO stays ISO: Google Sheets parses yyyy-mm-dd as a date in
                    # every locale, where dd/mm/yyyy is read differently
                    # depending on the spreadsheet's own locale setting.
                    iso,
                    _safe_text(desc),
                    _safe_text(cat),
                    # NOT digit-translated. Bengali numerals here would arrive as
                    # text and every SUM on the sheet would skip the row.
                    amt,
                    _PAY_BN.get(pay, _safe_text(pay)),
                ]
            )

    # If the spreadsheet is uninitialized (e.g. fresh blank sheet with Sheet1),
    # automatically provision the complete template so the sync can proceed.
    bootstrapped_tabs: list[str] = []
    if is_uninitialized_spreadsheet(list(titles)):
        struct_reqs, _, bootstrapped_tabs = build_bootstrap_structural(metadata, year=2026)
        if struct_reqs:
            await run_in_threadpool(
                _google, "POST", base + ":batchUpdate", token,
                json={"requests": struct_reqs},
            )
        user_cats = {row[2].lstrip("'") for rows in by_month.values() for row in rows}
        values_data = build_bootstrap_values(user_cats, year=2026)
        if values_data:
            await run_in_threadpool(
                _google, "POST", base + "/values:batchUpdate", token,
                json={"valueInputOption": "USER_ENTERED", "data": values_data},
            )
        metadata = await run_in_threadpool(
            _google, "GET", base, token,
            params={"fields": "sheets(properties,charts),namedRanges"},
        )
        try:
            titles = {sheet["properties"]["title"] for sheet in metadata.get("sheets", [])}
        except (TypeError, KeyError, AttributeError):
            raise _upstream() from None

    # Refuse the whole sync before writing anything: a partial write would
    # leave some months replaced and others stale, which is harder to notice
    # and harder to undo than a refusal.
    absent = [
        _tab_name(*key) for key in sorted(by_month) if _tab_name(*key) not in titles
    ]
    new_years = sorted({y for y, m in by_month if _tab_name(y, m) not in titles})
    if new_years and not all(
        title in titles for title in [SUMMARY, "সেটিংস", *[_tab_name(2026, m) for m in range(1, 13)]]
    ):
        raise _missing_tabs(absent or [_tab_name(*key) for key in by_month])
    overflow = [
        f"{_tab_name(*key)}: {len(rows)}"
        for key, rows in sorted(by_month.items())
        if len(rows) > _ROWS_PER_MONTH
    ]
    if overflow:
        raise _month_full(overflow)

    # The workbook's own category list, in its own order. Read once and used
    # twice — to name the categories the sheet cannot place in a group, and to
    # sort the budget rows the way সেটিংস lists them.
    order: list[str] = []
    if _CATEGORY_RANGE.split("!")[0].strip("'") in titles:
        listed = await run_in_threadpool(
            _google,
            "GET",
            base + "/values/" + quote(_CATEGORY_RANGE, safe=""),
            token,
            params={"majorDimension": "COLUMNS"},
        )
        columns = listed.get("values") or [[]]
        order = [
            text
            for value in (columns[0] if columns else [])
            if (text := str(value).strip())
        ]

    # Ledger rows are only fetched for tabs this workbook actually has, so a
    # skipped tab costs no query — and its categories stay out of `unmapped`,
    # which reports what the sheet cannot place, not what it was never sent.
    debts = await _debt_rows(db, user.id) if _TAB_DEBTS in titles else []
    recurring = await _recurring_rows(db, user.id) if _TAB_RECURRING in titles else []
    if _TAB_BUDGET in titles:
        budget_total, budget = await _budget_rows(db, user.id, order)
    else:
        budget_total, budget = "", []

    # Reported, never rewritten — guessing at a category would put a number in
    # the wrong group, which is worse than the sheet's own reconciliation line
    # naming it. Every category the sync sends is checked, not just the
    # expenses': a recurring rule in an unlisted category leaves its গ্রুপ
    # blank the same way, and a budget row in one sits outside its dropdown.
    unmapped: list[str] = []
    if order:
        known = set(order)
        seen = {row[2].lstrip("'") for rows in by_month.values() for row in rows}
        seen |= {row[0].lstrip("'") for row in recurring}
        seen |= {row[0].lstrip("'") for row in budget}
        unmapped = sorted(name for name in seen if name and name not in known)

    # Same refusal-before-writing rule as the months, for the same reason: a
    # ledger sheet holding 100 of 140 debts reads as the whole ledger.
    beyond = [
        f"{tab}: {len(rows)} / {limit}"
        for tab, rows, limit in (
            (_TAB_DEBTS, debts, _DEBT_ROWS),
            (_TAB_BUDGET, budget, _BUDGET_ROWS),
            (_TAB_RECURRING, recurring, _RECUR_ROWS),
        )
        if len(rows) > limit
    ]
    if beyond:
        raise _ledger_full(beyond)

    created_tabs: list[str] = []
    if new_years:
        # All row caps have fired before even planning a remote mutation. Read
        # only summary cells/dimensions and the picker registry, not expenses.
        snapshot = await run_in_threadpool(
            _google, "GET", base, token,
            params={"ranges": f"'{SUMMARY}'", "fields":
                    "sheets(properties,charts,data(startRow,startColumn,"
                    "rowMetadata(pixelSize,hiddenByUser),columnMetadata(pixelSize,hiddenByUser),"
                    "rowData(values(userEnteredValue))))"},
        )
        registry = await run_in_threadpool(
            _google, "GET", base + "/values/" + quote("'সেটিংস'!I:I", safe=""), token,
            params={"valueRenderOption": "FORMULA"},
        )
        try:
            structural, created_tabs = plan_years(
                metadata, snapshot["sheets"][0], new_years, _tab_name,
                registry.get("values", []),
            )
        except TemplateError as exc:
            raise _error(409, "sheets_year_template_invalid",
                         "নতুন বছরের শিট তৈরি করা যায়নি। মূল টেমপ্লেট ও মাসের তালিকা পরীক্ষা করুন।",
                         f"No data was written. Cannot extend this template: {exc}") from None
        except (KeyError, TypeError, IndexError, AttributeError):
            raise _upstream() from None
        # Duplicate + clear + retarget + picker expansion is one atomic batch.
        # A later values failure leaves EMPTY new months, not copied expenses.
        # Retrying sees those complete years and only retries the normal write.
        await run_in_threadpool(
            _google, "POST", base + ":batchUpdate", token,
            json={"requests": structural},
        )

    # Replace every owned cell in one request, including empty trailing cells.
    # A separate clear can succeed before a failed write and erase the month.
    # Empty strings clear cells (nulls would skip them). D's lookup formulas
    # and G's manually entered comments are outside the owned ranges.
    data: list[dict[str, Any]] = []
    count = 0
    for key in sorted(by_month):
        rows = by_month[key]
        tab = _tab_name(*key)
        data.append(_block(tab, _ROW_FIRST, _ROW_LAST, rows, "A:C", 0, 3))
        data.append(_block(tab, _ROW_FIRST, _ROW_LAST, rows, "E:F", 3, 5))
        count += len(rows)

    # F (অবস্থা), B (গ্রুপ) and J (মাসিক সমমান) are skipped by writing around
    # them, which is why each sheet takes two spans rather than one.
    if _TAB_DEBTS in titles:
        data.append(_block(_TAB_DEBTS, _DEBT_FIRST, _DEBT_LAST, debts, "A:E", 0, 5))
        data.append(_block(_TAB_DEBTS, _DEBT_FIRST, _DEBT_LAST, debts, "G:G", 6, 7))
    if _TAB_BUDGET in titles:
        data.append(_block(_TAB_BUDGET, _BUDGET_FIRST, _BUDGET_LAST, budget, "A:B", 0, 2))
        data.append(
            {
                "range": f"'{_TAB_BUDGET}'!{_BUDGET_TOTAL_CELL}",
                "majorDimension": "ROWS",
                "values": [[budget_total]],
            }
        )
    if _TAB_RECURRING in titles:
        data.append(
            _block(_TAB_RECURRING, _RECUR_FIRST, _RECUR_LAST, recurring, "A:A", 0, 1)
        )
        data.append(
            _block(_TAB_RECURRING, _RECUR_FIRST, _RECUR_LAST, recurring, "C:I", 2, 9)
        )

    if data:
        await run_in_threadpool(
            _google,
            "POST",
            base + "/values:batchUpdate",
            token,
            json={"valueInputOption": "USER_ENTERED", "data": data},
        )

    return SheetsExportResult(
        rows=count,
        months=[_tab_name(*key) for key in sorted(by_month)],
        unmapped=unmapped,
        debts=len(debts),
        budget_categories=len(budget),
        recurring=len(recurring),
        created_tabs=bootstrapped_tabs + created_tabs,
        skipped_tabs=[
            tab
            for tab in (_TAB_DEBTS, _TAB_BUDGET, _TAB_RECURRING)
            if tab not in titles
        ],
    )
