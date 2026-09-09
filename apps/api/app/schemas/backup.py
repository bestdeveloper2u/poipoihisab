"""Backup / restore envelope schemas (T15.3, ADR-0012; v2 T28.1, ADR-0028).

``GET /export/backup.json`` returns the caller's COMPLETE ledger as ONE JSON
document; ``POST /import/restore`` accepts the same document and REPLACEs the
caller's ledger with it (deliberately replace-not-merge — ADR-0012).

House rules carried over from ADR-0004 (do not drift):

* money is a decimal STRING with exactly 2 places ("50.50") — never a JSON
  number;
* JSON keys mirror the DB columns; timestamps are RFC 3339 UTC with ``Z``;
* ``schema_version`` gates the envelope format so future evolution is
  explicit: readers reject unknown versions with 422 instead of guessing.
  v2 (ADR-0028) adds the optional ``recurring`` rules array; v1 documents
  (no ``recurring`` key) are still read — restoring one wipes the caller's
  rules, exactly like every other collection.

Restore rows keep the export row shape but only require the LEDGER content:
``id``/``user_id`` in the file are ignored (fresh PKs, rows land under the
calling user), while ``created_at`` / ``settled_at`` / ``updated_at`` are
preserved when present so list ordering and settle status survive a restore.
Recurring rules carry no ``id``/``user_id`` at all; ``next_run`` IS required
on restore and preserved verbatim — it is the forward-only materialization
cursor (ADR-0014 §3), and a rule restored with a rewound cursor would
double-insert every already-materialized occurrence on the next run.
"""

from datetime import UTC, date, datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from app.schemas.budget import BudgetCats, cap_categories
from app.schemas.debt import DebtDirection, DebtOut, PositiveAmt
from app.schemas.expense import (
    AmtStr,
    ExpenseGroup,
    ExpenseOut,
    MoneyStr,
    PayMethod,
    Rfc3339Str,
    UidStr,
)
from app.schemas.recurring import Frequency

#: The newest envelope version this build writes (ADR-0012 §4, ADR-0028).
#: Restore still accepts v1 (Literal[1, 2] on :class:`RestoreIn`).
BACKUP_SCHEMA_VERSION: Literal[2] = 2

#: Abuse guard: a restore may carry at most this many rows per collection.
MAX_BACKUP_ROWS = 10_000


def _as_utc(v: datetime | None) -> datetime | None:
    """Normalize an uploaded timestamp to UTC.

    The SQLite dev/test backend drops the tz offset at storage time, so a
    ``+06:00`` wall time stored as-is would silently shift the instant.
    Our exports always emit ``Z``; this only matters for hand-edited files.
    """
    if v is not None and v.tzinfo is not None:
        return v.astimezone(UTC)
    return v


UtcStamp = Annotated[datetime | None, AfterValidator(_as_utc)]


# --- export / document side --------------------------------------------------


class BackupCounts(BaseModel):
    """Row counts, mirroring the collections of the same envelope."""

    expenses: int
    debts: int
    budgets: int
    # v2 (ADR-0028): rules joined the envelope. Defaults to 0 so a v1-era
    # counts dict still validates.
    recurring: int = 0


class BackupBudgetRow(BaseModel):
    """One budgets row (at most one per user — the PK is ``user_id``)."""

    model_config = ConfigDict(from_attributes=True)

    user_id: UidStr
    total: MoneyStr
    cats: dict[str, str]
    updated_at: Rfc3339Str


class BackupRecurringRow(BaseModel):
    """One recurring-rule row (ADR-0028) — every column EXCEPT ``id``/``user_id``.

    Rules have no history to preserve beyond their content, so unlike
    expenses/debts the export omits identity entirely: restore always mints
    fresh PKs under the caller. Field validators/amount types are the shared
    :mod:`app.schemas.recurring` ones (do not drift — ADR-0004).
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    cat: str
    grp: ExpenseGroup
    amt: MoneyStr
    pay: PayMethod
    # The ORM attribute is ``description`` (Column "desc") — accept both when
    # reading a row, always serialize the column name ``desc`` on the wire.
    desc: str | None = Field(
        default=None,
        max_length=200,
        validation_alias=AliasChoices("desc", "description"),
    )
    freq: Frequency
    start_date: date
    # The forward-only materialization cursor (ADR-0014 §3) — exported so a
    # restore cannot rewind it into re-materializing old occurrences.
    next_run: date
    active: bool
    created_at: Rfc3339Str | None = None
    updated_at: Rfc3339Str | None = None


class BackupEnvelope(BaseModel):
    """The full-fidelity backup document (both directions, ADR-0012/0028).

    ``expenses``/``debts`` reuse :class:`ExpenseOut`/:class:`DebtOut`, so the
    backup wire shape IS the CRUD wire shape (every column, money as exact
    decimal strings) — a downloaded file can be fed straight back to
    ``POST /import/restore``. ``recurring`` (v2, ADR-0028) carries the
    caller's rules; it defaults to empty so v1 consumers ignore it safely.
    """

    schema_version: Literal[2] = BACKUP_SCHEMA_VERSION
    exported_at: Rfc3339Str
    counts: BackupCounts
    expenses: list[ExpenseOut]
    debts: list[DebtOut]
    budgets: list[BackupBudgetRow]
    recurring: list[BackupRecurringRow] = Field(default_factory=list)


# --- restore side ------------------------------------------------------------


class RestoreExpenseRow(BaseModel):
    """One uploaded expense row, validated like POST /expenses.

    ``created_at`` is optional and preserved when present (keyset ordering
    survives a restore); the fresh PK and the caller's ``user_id`` are
    assigned by the server regardless of what the file says.
    """

    cat: str = Field(min_length=1, max_length=80)
    grp: ExpenseGroup
    amt: AmtStr
    pay: PayMethod = "cash"
    desc: str | None = Field(default=None, max_length=200)
    iso: date
    created_at: UtcStamp = None


class RestoreDebtRow(BaseModel):
    """One uploaded debt row, validated like POST /debts.

    Unlike POST /debts, ``iso`` is REQUIRED (a backup always carries the
    event date — defaulting it to "today" would corrupt history).
    """

    party: str = Field(min_length=1, max_length=120)
    dir: DebtDirection
    amt: PositiveAmt
    note: str | None = Field(default=None, max_length=200)
    iso: date
    settled_at: UtcStamp = None
    created_at: UtcStamp = None


class RestoreBudgetRow(BaseModel):
    """The uploaded budgets row — at most one is accepted (PK is ``user_id``)."""

    total: AmtStr
    cats: BudgetCats = Field(default_factory=dict)
    updated_at: UtcStamp = None

    @field_validator("cats")
    @classmethod
    def _cap_category_count(cls, cats: dict[str, str]) -> dict[str, str]:
        return cap_categories(cats)


class RestoreRecurringRow(BaseModel):
    """One uploaded recurring-rule row (ADR-0028), validated like POST /recurring.

    Reuses the recurring wire validators verbatim (``Frequency``, ``AmtStr``,
    ``ExpenseGroup``, ``PayMethod``) — no parallel validation. Two deliberate
    differences from POST /recurring, both because a backup always carries
    full state: ``next_run`` is REQUIRED and preserved verbatim (it is the
    forward-only cursor, ADR-0014 §3 — defaulting it would rewind the
    cursor), and ``start_date`` is required. ``active`` defaults to True
    (the DB default) when absent. Fresh PKs and the caller's ``user_id``
    are assigned by the server regardless of what the file says.
    """

    cat: str = Field(min_length=1, max_length=80)
    grp: ExpenseGroup
    amt: AmtStr
    pay: PayMethod = "cash"
    desc: str | None = Field(default=None, max_length=200)
    freq: Frequency
    start_date: date
    next_run: date
    active: bool = True
    created_at: UtcStamp = None
    updated_at: UtcStamp = None


class RestoreIn(BaseModel):
    """POST /import/restore body — the envelope as exported, v1 or v2.

    v2 (ADR-0028) adds ``recurring``; v1 documents (no ``recurring`` key)
    are still accepted — the field defaults to empty, and REPLACE then wipes
    the caller's rules like every other collection (a v1 file predates
    rules, so the user restoring it expects that older state). All four
    collections default to empty (a minimal envelope therefore means
    "wipe me", which is exactly REPLACE semantics). ``exported_at`` is
    accepted but not interpreted.
    """

    schema_version: Literal[1, 2] = BACKUP_SCHEMA_VERSION
    exported_at: str | None = None
    expenses: list[RestoreExpenseRow] = Field(
        default_factory=list, max_length=MAX_BACKUP_ROWS
    )
    debts: list[RestoreDebtRow] = Field(
        default_factory=list, max_length=MAX_BACKUP_ROWS
    )
    budgets: list[RestoreBudgetRow] = Field(default_factory=list, max_length=1)
    recurring: list[RestoreRecurringRow] = Field(
        default_factory=list, max_length=MAX_BACKUP_ROWS
    )


class RestoreOut(BaseModel):
    """POST /import/restore response."""

    restored: BackupCounts
