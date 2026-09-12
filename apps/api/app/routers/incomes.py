"""Incomes router: list (keyset cursor pagination), create, patch, delete.
Every endpoint is scoped to the authenticated user via :meth:`app.core.deps.get_current_user`.
Follows ADR-0004 / ADR-0005.
"""

import base64
import binascii
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_kv_dep
from app.core.kv import KV
from app.db.session import get_db
from app.models.income import Income
from app.models.profile import Profile
from app.schemas.income import (
    IncomeIn,
    IncomeListOut,
    IncomeOut,
    IncomeUpdate,
)

router = APIRouter(prefix="/incomes", tags=["incomes"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
KvDep = Annotated[KV, Depends(get_kv_dep)]
CurrentUser = Annotated[Profile, Depends(get_current_user)]

_NOT_FOUND = {
    "code": "not_found",
    "message_bn": "আয়টি খুঁজে পাওয়া যায়নি",
    "message_en": "Income record not found",
}
_INVALID_CURSOR = {
    "code": "invalid_cursor",
    "message_bn": "পেজিনেশন কার্সারটি অবৈধ",
    "message_en": "Invalid pagination cursor",
}


def _encode_cursor(income: Income) -> str:
    return base64.urlsafe_b64encode(str(income.id).encode()).decode("ascii")


def _decode_cursor(cursor: str) -> uuid.UUID:
    try:
        return uuid.UUID(
            base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        )
    except (ValueError, binascii.Error, UnicodeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_CURSOR
        ) from None


async def _get_owned(db: AsyncSession, user: Profile, income_id: uuid.UUID) -> Income:
    income = await db.scalar(
        select(Income).where(Income.id == income_id, Income.user_id == user.id)
    )
    if income is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return income


async def _evict_report_cache(kv: KV, user_id: uuid.UUID, dt: date) -> None:
    ym = f"{dt.year:04d}-{dt.month:02d}"
    await kv.delete(f"rep:monthly:{user_id}:{ym}")
    await kv.delete(f"rep:yearly:{user_id}:{dt.year:04d}")


@router.get("", response_model=IncomeListOut)
async def list_incomes(
    db: DbDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[str | None, Query()] = None,
    from_iso: Annotated[date | None, Query(alias="from")] = None,
    to_iso: Annotated[date | None, Query(alias="to")] = None,
) -> IncomeListOut:
    """List caller's incomes, newest first, keyset-paginated."""
    stmt = select(Income).where(Income.user_id == user.id)
    if from_iso is not None:
        stmt = stmt.where(Income.iso >= from_iso)
    if to_iso is not None:
        stmt = stmt.where(Income.iso <= to_iso)

    if cursor is not None:
        cursor_id = _decode_cursor(cursor)
        anchor_iso = select(Income.iso).where(Income.id == cursor_id).scalar_subquery()
        anchor_ts = (
            select(Income.created_at).where(Income.id == cursor_id).scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Income.iso < anchor_iso,
                and_(Income.iso == anchor_iso, Income.created_at < anchor_ts),
                and_(
                    Income.iso == anchor_iso,
                    Income.created_at == anchor_ts,
                    Income.id < cursor_id,
                ),
            )
        )
    stmt = stmt.order_by(
        Income.iso.desc(), Income.created_at.desc(), Income.id.desc()
    ).limit(limit + 1)

    rows = (await db.scalars(stmt)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode_cursor(rows[-1]) if has_more and rows else None
    return IncomeListOut(
        items=[IncomeOut.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=IncomeOut)
async def create_income(
    body: IncomeIn, db: DbDep, user: CurrentUser, kv: KvDep
) -> IncomeOut:
    """Record a new income entry."""
    income = Income(
        user_id=user.id,
        source=body.source,
        amt=Decimal(body.amt),
        pay=body.pay,
        description=body.description,
        iso=body.iso,
    )
    db.add(income)
    await db.commit()
    await db.refresh(income)
    await _evict_report_cache(kv, user.id, income.iso)
    return IncomeOut.model_validate(income)


@router.patch("/{income_id}", response_model=IncomeOut)
async def update_income(
    income_id: uuid.UUID,
    body: IncomeUpdate,
    db: DbDep,
    user: CurrentUser,
    kv: KvDep,
) -> IncomeOut:
    """Update an income entry."""
    income = await _get_owned(db, user, income_id)
    old_iso = income.iso
    updates = body.model_dump(exclude_unset=True)
    if "amt" in updates:
        updates["amt"] = Decimal(str(updates["amt"]))
    for field, value in updates.items():
        setattr(income, field, value)
    await db.commit()
    await db.refresh(income)
    await _evict_report_cache(kv, user.id, old_iso)
    if income.iso != old_iso:
        await _evict_report_cache(kv, user.id, income.iso)
    return IncomeOut.model_validate(income)


@router.delete("/{income_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_income(
    income_id: uuid.UUID, db: DbDep, user: CurrentUser, kv: KvDep
) -> None:
    """Delete an income entry."""
    income = await _get_owned(db, user, income_id)
    target_iso = income.iso
    await db.delete(income)
    await db.commit()
    await _evict_report_cache(kv, user.id, target_iso)
