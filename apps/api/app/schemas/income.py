"""Income schemas (wire contract per ADR-0004).

Rules:
* money is a decimal STRING with exactly 2 places ("50000.00") — never a JSON number;
* amt must be positive (> 0);
* JSON keys mirror DB columns: source, amt, pay, description (desc), iso;
* id/user_id are lowercase canonical uuid strings; created_at is RFC 3339 UTC string.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.schemas.expense import AmtStr, MoneyStr, Rfc3339Str, UidStr


def _require_positive(v: str) -> str:
    if Decimal(v) <= 0:
        raise ValueError("amt must be greater than 0")
    return v


PositiveAmt = Annotated[AmtStr, AfterValidator(_require_positive)]


class IncomeIn(BaseModel):
    """POST /incomes request body."""

    source: str = Field(min_length=1, max_length=120)
    amt: PositiveAmt
    pay: str = Field(default="cash", max_length=32)
    description: str | None = Field(default=None, max_length=255)
    iso: date


class IncomeUpdate(BaseModel):
    """PATCH /incomes/{id} request body — all fields optional."""

    source: str | None = Field(default=None, min_length=1, max_length=120)
    amt: PositiveAmt | None = None
    pay: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=255)
    iso: date | None = None


class IncomeOut(BaseModel):
    """Public income row."""

    model_config = ConfigDict(from_attributes=True)

    id: UidStr
    user_id: UidStr
    source: str
    amt: MoneyStr
    pay: str
    description: str | None = None
    iso: date
    created_at: Rfc3339Str


class IncomeListOut(BaseModel):
    """Envelope for GET /incomes with cursor pagination."""

    items: list[IncomeOut]
    next_cursor: str | None
