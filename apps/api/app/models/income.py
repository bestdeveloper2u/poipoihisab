"""incomes table.

Stores user income entries (salary, business, freelance, gifts, investments, etc.)
with date, amount, payment method, description, and source.
Follows ADR-0004 / ADR-0005 database portability rules.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import GUID


class Income(Base):
    __tablename__ = "incomes"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    amt: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    pay: Mapped[str] = mapped_column(Text, nullable=False, default="cash")
    description: Mapped[str | None] = mapped_column("desc", Text)
    iso: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("amt > 0", name="income_amt_positive"),
        Index("incomes_user_iso", "user_id", text("iso DESC")),
    )
