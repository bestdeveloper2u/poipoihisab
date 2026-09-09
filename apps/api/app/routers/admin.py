"""Super Admin endpoints for viewing platform statistics and inspecting any user's data."""

import csv
import io
import secrets
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_superadmin, get_kv_dep, is_superadmin_user
from app.core.kv import KV
from app.core.security import hash_password
from app.db.session import get_db
from app.models.budget import Budget
from app.models.debt import Debt
from app.models.expense import Expense
from app.models.profile import DEMO_USER_NAME, Profile
from app.models.recurring import RecurringExpense
from app.routers.auth import revoke_all_user_sessions
from app.schemas.admin import (
    AdminBulkActionOut,
    AdminBulkUserDeleteIn,
    AdminBulkUserSuspendIn,
    AdminPlatformStatsOut,
    AdminUserActionOut,
    AdminUserBudgetOut,
    AdminUserDebtsOut,
    AdminUserDetailOut,
    AdminUserExpensesOut,
    AdminUserImportIn,
    AdminUserImportOut,
    AdminUserItemOut,
    AdminUserListOut,
    AdminUserRecurringOut,
    AdminUserSuspendIn,
)
from app.schemas.debt import DebtOut
from app.schemas.expense import ExpenseOut
from app.schemas.recurring import RecurringOut

router = APIRouter(prefix="/admin", tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
KvDep = Annotated[KV, Depends(get_kv_dep)]
SuperAdminDep = Annotated[Profile, Depends(get_current_superadmin)]


def _money_str(val: Decimal | float | None) -> str:
    if val is None:
        return "0.00"
    return f"{Decimal(str(val)):.2f}"


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(cell: str) -> str:
    """Defuse CSV formula injection in user-controlled cells."""
    if cell.startswith(_FORMULA_PREFIXES):
        return f"'{cell}"
    return cell



@router.get("/stats", response_model=AdminPlatformStatsOut)
async def get_platform_stats(
    _: SuperAdminDep,
    db: DbDep,
) -> AdminPlatformStatsOut:
    """Return platform-wide summary statistics."""
    total_users = (await db.execute(select(func.count(Profile.id)))).scalar_one() or 0
    total_expenses = (await db.execute(select(func.count(Expense.id)))).scalar_one() or 0
    raw_amount = (await db.execute(select(func.sum(Expense.amt)))).scalar_one()
    total_debts = (await db.execute(select(func.count(Debt.id)))).scalar_one() or 0
    active_recurring = (
        await db.execute(
            select(func.count(RecurringExpense.id)).where(RecurringExpense.active == True)
        )
    ).scalar_one() or 0

    return AdminPlatformStatsOut(
        totalUsers=total_users,
        totalExpenses=total_expenses,
        totalAmount=_money_str(raw_amount),
        totalDebts=total_debts,
        activeRecurring=active_recurring,
    )


@router.get("/users", response_model=AdminUserListOut)
async def list_admin_users(
    _: SuperAdminDep,
    db: DbDep,
    q: Annotated[str | None, Query(description="Search by name, email, or user ID")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminUserListOut:
    """Search and list all users with aggregated financial metrics."""
    # Subqueries for user aggregate stats
    exp_sub = (
        select(
            Expense.user_id,
            func.count(Expense.id).label("exp_count"),
            func.sum(Expense.amt).label("exp_sum"),
        )
        .group_by(Expense.user_id)
        .subquery()
    )
    debt_sub = (
        select(
            Debt.user_id,
            func.count(Debt.id).label("debt_count"),
        )
        .group_by(Debt.user_id)
        .subquery()
    )
    rec_sub = (
        select(
            RecurringExpense.user_id,
            func.count(RecurringExpense.id).label("rec_count"),
        )
        .group_by(RecurringExpense.user_id)
        .subquery()
    )
    budget_sub = (
        select(
            Budget.user_id,
            func.count(Budget.user_id).label("budget_count"),
        )
        .group_by(Budget.user_id)
        .subquery()
    )

    base_query = (
        select(
            Profile,
            func.coalesce(exp_sub.c.exp_count, 0).label("exp_count"),
            func.coalesce(exp_sub.c.exp_sum, 0).label("exp_sum"),
            func.coalesce(debt_sub.c.debt_count, 0).label("debt_count"),
            func.coalesce(rec_sub.c.rec_count, 0).label("rec_count"),
            func.coalesce(budget_sub.c.budget_count, 0).label("budget_count"),
        )
        .outerjoin(exp_sub, Profile.id == exp_sub.c.user_id)
        .outerjoin(debt_sub, Profile.id == debt_sub.c.user_id)
        .outerjoin(rec_sub, Profile.id == rec_sub.c.user_id)
        .outerjoin(budget_sub, Profile.id == budget_sub.c.user_id)
    )

    if q and q.strip():
        term = f"%{q.strip()}%"
        filter_expr = or_(
            Profile.name.ilike(term),
            Profile.email.ilike(term),
            cast(Profile.id, Text).ilike(term),
        )
        base_query = base_query.where(filter_expr)
        count_query = select(func.count(Profile.id)).where(filter_expr)
    else:
        count_query = select(func.count(Profile.id))

    total = (await db.execute(count_query)).scalar_one() or 0

    rows = (
        await db.execute(
            base_query.order_by(Profile.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()

    items = []
    for row in rows:
        p: Profile = row[0]
        exp_count = int(row[1])
        exp_sum = row[2]
        debt_count = int(row[3])
        rec_count = int(row[4])
        budget_count = int(row[5])

        items.append(
            AdminUserItemOut(
                id=p.id,
                name=p.name,
                email=p.email,
                createdAt=p.created_at,
                lang=p.lang,
                theme=p.theme,
                isSuperadmin=is_superadmin_user(p),
                isSuspended=getattr(p, "is_suspended", False),
                expenseCount=exp_count,
                totalExpense=_money_str(exp_sum),
                debtCount=debt_count,
                budgetCount=budget_count,
                recurringCount=rec_count,
            )
        )

    return AdminUserListOut(items=items, total=total)


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
async def get_admin_user_detail(
    user_id: uuid.UUID,
    _: SuperAdminDep,
    db: DbDep,
) -> AdminUserDetailOut:
    """Fetch complete user profile and aggregated metrics."""
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Counts & sums
    exp_count = (
        await db.execute(select(func.count(Expense.id)).where(Expense.user_id == user_id))
    ).scalar_one() or 0
    total_expense = (
        await db.execute(select(func.sum(Expense.amt)).where(Expense.user_id == user_id))
    ).scalar_one()

    # Current month spending
    today = datetime.now(UTC).date()
    first_of_month = date(today.year, today.month, 1)
    month_expense = (
        await db.execute(
            select(func.sum(Expense.amt)).where(
                Expense.user_id == user_id, Expense.iso >= first_of_month
            )
        )
    ).scalar_one()

    # Debts breakdown
    debt_rows = (
        await db.execute(
            select(Debt.dir, func.sum(Debt.amt), func.count(Debt.id))
            .where(Debt.user_id == user_id)
            .group_by(Debt.dir)
        )
    ).all()

    total_lend = Decimal("0.00")
    total_borrow = Decimal("0.00")
    debt_count = 0
    for direction, amt_sum, count in debt_rows:
        debt_count += count or 0
        if direction == "lend":
            total_lend = Decimal(str(amt_sum or 0))
        elif direction == "borrow":
            total_borrow = Decimal(str(amt_sum or 0))

    net_debt = total_lend - total_borrow

    # Recurring count
    rec_count = (
        await db.execute(
            select(func.count(RecurringExpense.id)).where(RecurringExpense.user_id == user_id)
        )
    ).scalar_one() or 0

    # Budget
    budget_row = (await db.execute(select(Budget).where(Budget.user_id == user_id))).scalar_one_or_none()
    budget_count = 1 if budget_row else 0
    budget_out = None
    if budget_row:
        cats_dict = {k: str(v) for k, v in (budget_row.cats or {}).items()}
        budget_out = AdminUserBudgetOut(
            total=_money_str(budget_row.total),
            cats=cats_dict,
            updatedAt=budget_row.updated_at,
        )

    user_item = AdminUserItemOut(
        id=profile.id,
        name=profile.name,
        email=profile.email,
        createdAt=profile.created_at,
        lang=profile.lang,
        theme=profile.theme,
        isSuperadmin=is_superadmin_user(profile),
        isSuspended=getattr(profile, "is_suspended", False),
        expenseCount=exp_count,
        totalExpense=_money_str(total_expense),
        debtCount=debt_count,
        budgetCount=budget_count,
        recurringCount=rec_count,
    )

    return AdminUserDetailOut(
        user=user_item,
        totalLend=_money_str(total_lend),
        totalBorrow=_money_str(total_borrow),
        netDebt=_money_str(net_debt),
        currentMonthExpense=_money_str(month_expense),
        budget=budget_out,
    )


@router.get("/users/{user_id}/expenses", response_model=AdminUserExpensesOut)
async def get_admin_user_expenses(
    user_id: uuid.UUID,
    _: SuperAdminDep,
    db: DbDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminUserExpensesOut:
    """Return expenses for a specific user."""
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    total = (
        await db.execute(select(func.count(Expense.id)).where(Expense.user_id == user_id))
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(Expense)
            .where(Expense.user_id == user_id)
            .order_by(Expense.iso.desc(), Expense.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    items = [ExpenseOut.model_validate(r) for r in rows]
    return AdminUserExpensesOut(items=items, total=total)


@router.get("/users/{user_id}/debts", response_model=AdminUserDebtsOut)
async def get_admin_user_debts(
    user_id: uuid.UUID,
    _: SuperAdminDep,
    db: DbDep,
) -> AdminUserDebtsOut:
    """Return all debts for a specific user."""
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    rows = (
        await db.execute(
            select(Debt).where(Debt.user_id == user_id).order_by(Debt.created_at.desc())
        )
    ).scalars().all()

    items = [DebtOut.model_validate(r) for r in rows]
    return AdminUserDebtsOut(items=items, total=len(items))


@router.get("/users/{user_id}/recurring", response_model=AdminUserRecurringOut)
async def get_admin_user_recurring(
    user_id: uuid.UUID,
    _: SuperAdminDep,
    db: DbDep,
) -> AdminUserRecurringOut:
    """Return recurring expense rules for a specific user."""
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    rows = (
        await db.execute(
            select(RecurringExpense)
            .where(RecurringExpense.user_id == user_id)
            .order_by(RecurringExpense.created_at.desc())
        )
    ).scalars().all()

    items = [RecurringOut.model_validate(r) for r in rows]
    return AdminUserRecurringOut(items=items, total=len(items))


@router.post("/users/{user_id}/suspend", response_model=AdminUserActionOut)
async def suspend_admin_user(
    user_id: uuid.UUID,
    body: AdminUserSuspendIn,
    current_admin: SuperAdminDep,
    db: DbDep,
    kv: KvDep,
) -> AdminUserActionOut:
    """Suspend or unsuspend a user. When suspended, all active sessions are revoked immediately."""
    if current_admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot suspend your own account",
        )
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    profile.is_suspended = body.suspended
    await db.commit()

    if body.suspended:
        await revoke_all_user_sessions(kv, str(user_id))
        msg = f"User {profile.name} has been suspended and all sessions revoked"
    else:
        msg = f"User {profile.name} has been reactivated"

    return AdminUserActionOut(success=True, message=msg)


@router.delete("/users/{user_id}", response_model=AdminUserActionOut)
async def delete_admin_user(
    user_id: uuid.UUID,
    current_admin: SuperAdminDep,
    db: DbDep,
    kv: KvDep,
) -> AdminUserActionOut:
    """Permanently delete a user and cascade delete their expenses, debts, budgets, and recurring rules."""
    if current_admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user_name = profile.name
    # Revoke sessions first
    await revoke_all_user_sessions(kv, str(user_id))

    # Delete profile (expenses, debts, budgets, recurring rules cascade)
    await db.delete(profile)
    await db.commit()

    return AdminUserActionOut(
        success=True,
        message=f"User {user_name} and all associated data have been permanently deleted",
    )


@router.post("/users/bulk-suspend", response_model=AdminBulkActionOut)
async def bulk_suspend_admin_users(
    body: AdminBulkUserSuspendIn,
    current_admin: SuperAdminDep,
    db: DbDep,
    kv: KvDep,
) -> AdminBulkActionOut:
    """Bulk suspend or reactivate users, excluding the current admin."""
    target_ids = [uid for uid in body.user_ids if uid != current_admin.id]
    if not target_ids:
        return AdminBulkActionOut(
            success=True,
            affectedCount=0,
            message="No eligible accounts selected (cannot perform action on your own account)",
        )

    profiles = (
        await db.execute(select(Profile).where(Profile.id.in_(target_ids)))
    ).scalars().all()

    for p in profiles:
        p.is_suspended = body.suspended

    await db.commit()

    if body.suspended:
        for p in profiles:
            await revoke_all_user_sessions(kv, str(p.id))

    action_label = "suspended and sessions revoked" if body.suspended else "reactivated"
    return AdminBulkActionOut(
        success=True,
        affectedCount=len(profiles),
        message=f"Successfully {action_label} for {len(profiles)} user(s)",
    )


@router.post("/users/bulk-delete", response_model=AdminBulkActionOut)
async def bulk_delete_admin_users(
    body: AdminBulkUserDeleteIn,
    current_admin: SuperAdminDep,
    db: DbDep,
    kv: KvDep,
) -> AdminBulkActionOut:
    """Bulk permanently delete users, excluding the current admin."""
    target_ids = [uid for uid in body.user_ids if uid != current_admin.id]
    if not target_ids:
        return AdminBulkActionOut(
            success=True,
            affectedCount=0,
            message="No eligible accounts selected (cannot perform action on your own account)",
        )

    profiles = (
        await db.execute(select(Profile).where(Profile.id.in_(target_ids)))
    ).scalars().all()

    for p in profiles:
        await revoke_all_user_sessions(kv, str(p.id))
        await db.delete(p)

    await db.commit()

    return AdminBulkActionOut(
        success=True,
        affectedCount=len(profiles),
        message=f"Successfully deleted {len(profiles)} user(s) and their associated data",
    )


@router.get("/export/users.csv")
async def export_admin_users_csv(
    _: SuperAdminDep,
    db: DbDep,
) -> StreamingResponse:
    """Stream all registered users as an RFC-4180 CSV with UTF-8 BOM."""
    exp_sub = (
        select(
            Expense.user_id,
            func.count(Expense.id).label("exp_count"),
            func.sum(Expense.amt).label("exp_sum"),
        )
        .group_by(Expense.user_id)
        .subquery()
    )

    query = (
        select(
            Profile,
            func.coalesce(exp_sub.c.exp_count, 0).label("exp_count"),
            func.coalesce(exp_sub.c.exp_sum, 0).label("exp_sum"),
        )
        .outerjoin(exp_sub, Profile.id == exp_sub.c.user_id)
        .order_by(Profile.created_at.desc())
    )

    rows = (await db.execute(query)).all()

    async def _stream():
        bom = "\ufeff"
        header = [
            "User ID",
            "Name",
            "Email",
            "Role",
            "Status",
            "Expense Count",
            "Total Spent (BDT)",
            "Joined Date",
        ]
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\r\n")
        writer.writerow(header)
        yield (bom + buf.getvalue()).encode("utf-8")

        for row in rows:
            p: Profile = row[0]
            exp_count = int(row[1])
            exp_sum = row[2]
            status_str = "Suspended" if getattr(p, "is_suspended", False) else "Active"
            role_str = "Super Admin" if is_superadmin_user(p) else "User"
            created_str = p.created_at.strftime("%Y-%m-%d %H:%M:%S") if p.created_at else ""

            buf = io.StringIO()
            writer = csv.writer(buf, lineterminator="\r\n")
            writer.writerow(
                [
                    str(p.id),
                    _csv_safe(p.name or ""),
                    _csv_safe(p.email or ""),
                    role_str,
                    status_str,
                    exp_count,
                    _money_str(exp_sum),
                    created_str,
                ]
            )
            yield buf.getvalue().encode("utf-8")

    filename = f"users-export-{datetime.now(UTC).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        _stream(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import/users", response_model=AdminUserImportOut)
async def import_admin_users(
    body: AdminUserImportIn,
    _: SuperAdminDep,
    db: DbDep,
) -> AdminUserImportOut:
    """Import users from a batch list. Skips duplicates and invalid emails."""
    created_count = 0
    skipped_count = 0
    errors: list[str] = []

    # Pre-fetch existing emails
    existing_emails_result = await db.execute(
        select(func.lower(Profile.email)).where(Profile.email.is_not(None))
    )
    existing_emails = {str(em).lower() for em in existing_emails_result.scalars().all() if em}

    # Process each user row
    for idx, row in enumerate(body.users, start=1):
        email_clean = row.email.strip().lower()
        if not email_clean or "@" not in email_clean:
            skipped_count += 1
            errors.append(f"Row {idx}: Invalid email '{row.email}'")
            continue

        if email_clean in existing_emails:
            skipped_count += 1
            errors.append(f"Row {idx}: Email '{email_clean}' already exists")
            continue

        name_clean = row.name.strip() if row.name else DEMO_USER_NAME
        raw_password = (
            row.password.strip()
            if row.password and row.password.strip()
            else f"DH#{secrets.token_urlsafe(8)}!"
        )
        password_hash = hash_password(raw_password)

        new_profile = Profile(
            id=uuid.uuid4(),
            email=email_clean,
            name=name_clean,
            password_hash=password_hash,
            lang="bn",
            theme="light",
            is_superadmin=False,
            is_suspended=False,
        )
        db.add(new_profile)
        existing_emails.add(email_clean)
        created_count += 1

    if created_count > 0:
        await db.commit()

    return AdminUserImportOut(
        success=True,
        createdCount=created_count,
        skippedCount=skipped_count,
        errors=errors[:50],
    )

