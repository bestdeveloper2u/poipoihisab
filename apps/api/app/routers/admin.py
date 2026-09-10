"""Super Admin endpoints for viewing platform statistics and inspecting any user's data."""

import csv
import io
import secrets
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_superadmin, get_kv_dep, is_superadmin_user
from app.core.kv import KV
from app.core.security import hash_password
from app.db.session import get_db
from app.models.audit import (
    ACTION_CATEGORY_MERGE,
    ACTION_USER_BULK_DELETE,
    ACTION_USER_BULK_SUSPEND,
    ACTION_USER_BULK_UNSUSPEND,
    ACTION_USER_DELETE,
    ACTION_USER_EXPORT,
    ACTION_USER_IMPORT,
    ACTION_USER_ROLE_GRANT,
    ACTION_USER_ROLE_REVOKE,
    ACTION_USER_SESSIONS_REVOKE,
    ACTION_USER_SUSPEND,
    ACTION_USER_UNSUSPEND,
    AdminAuditLog,
)
from app.models.budget import Budget
from app.models.debt import Debt
from app.models.expense import Expense
from app.models.profile import DEMO_USER_NAME, Profile
from app.models.recurring import RecurringExpense
from app.routers.auth import (
    _scan_user_sessions,
    _user_sess_key,
    revoke_all_user_sessions,
)
from app.schemas.admin import (
    AdminAnalyticsOut,
    AdminAuditItemOut,
    AdminAuditListOut,
    AdminBulkActionOut,
    AdminBulkUserDeleteIn,
    AdminBulkUserSuspendIn,
    AdminCategoryItemOut,
    AdminCategoryListOut,
    AdminCategoryMergeIn,
    AdminIntegrationsOut,
    AdminPlatformStatsOut,
    AdminRevokeSessionsOut,
    AdminSessionsOut,
    AdminSessionUserOut,
    AdminSliceOut,
    AdminSystemOut,
    AdminTopUserOut,
    AdminTrendPointOut,
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
    AdminUserRoleIn,
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

# Bulk-delete throttling. The endpoint is irreversible and takes an arbitrary
# id list, so it is capped twice: per call and per minute, per admin.
_BULK_DELETE_MAX_TARGETS = 100
_BULK_DELETE_CALLS_PER_MINUTE = 5

# Cap on how many profiles /admin/sessions will walk in one request: the scan
# is O(users) KV round-trips, and an unbounded one would time out on Vercel.
_SESSION_SCAN_MAX_USERS = 300


def _csv_safe(cell: str) -> str:
    """Defuse CSV formula injection in user-controlled cells."""
    if cell.startswith(_FORMULA_PREFIXES):
        return f"'{cell}"
    return cell


def _client_ip(request: Request | None) -> str | None:
    """Best-effort caller IP, honouring the proxy header Vercel/Nginx sets."""
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Left-most entry is the original client (the rest are proxies).
        return forwarded.split(",")[0].strip()[:64] or None
    client = request.client
    return client.host[:64] if client is not None else None


def _audit(
    db: AsyncSession,
    actor: Profile,
    action: str,
    *,
    request: Request | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    target_label: str | None = None,
    affected: int = 1,
    detail: str | None = None,
) -> None:
    """Stage an audit row on the CALLER'S session — no commit of its own.

    The row therefore lands in the same transaction as the mutation it
    describes: the action cannot commit without its trail, and a rollback
    takes the trail with it. Every mutating endpoint below calls this
    BEFORE its ``await db.commit()``.
    """
    db.add(
        AdminAuditLog(
            id=uuid.uuid4(),
            actor_id=actor.id,
            actor_email=actor.email,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=(target_label[:200] if target_label else None),
            affected=affected,
            detail=(detail[:500] if detail else None),
            ip=_client_ip(request),
        )
    )


def _user_label(profile: Profile) -> str:
    """Snapshot of a user for the audit trail (survives their deletion)."""
    return f"{profile.name} <{profile.email or 'no-email'}>"


async def _count_effective_superadmins(db: AsyncSession) -> int:
    """How many accounts can currently reach ``/admin``.

    Counts both grant paths (see ``is_superadmin_user``): the DB flag and
    the ``POIPOIHISAB_SUPERADMIN_EMAILS`` allowlist. This is the number
    worth *showing* an admin; it is NOT the number to guard on — see below.
    """
    profiles = (await db.execute(select(Profile))).scalars().all()
    return sum(1 for p in profiles if is_superadmin_user(p))


async def _count_db_superadmins(db: AsyncSession) -> int:
    """Accounts that are superadmin *in the database* and can still sign in.

    A suspended profile is refused at ``get_current_session``, so it is not
    a usable admin however its flag reads.
    """
    return (
        await db.execute(
            select(func.count(Profile.id)).where(
                Profile.is_superadmin.is_(True),
                Profile.is_suspended.is_(False),
            )
        )
    ).scalar_one() or 0


async def _guard_last_db_superadmin(
    db: AsyncSession, targets: list[Profile], what: str
) -> None:
    """Refuse an action that would empty the database of usable superadmins.

    Note what this deliberately does NOT claim to prevent. The acting admin
    is never among ``targets`` (every caller filters their own id out first),
    so "no superadmin left at all" is not reachable through these endpoints
    while the caller still holds their own grant.

    The reachable failure is narrower and worse, because it is silent: an
    admin whose access comes only from ``POIPOIHISAB_SUPERADMIN_EMAILS`` can
    suspend, delete or demote every DB-flagged admin, leaving the database
    with zero. Nothing looks wrong — until that env var changes (a redeploy,
    an edited value, a second region that never got it), and then no account
    on the platform can reach ``/admin`` and no account can grant it back.
    The env allowlist is deployment config; the flag is the durable record.
    So the invariant guarded here is on the durable record.
    """
    losing = [
        p
        for p in targets
        if getattr(p, "is_superadmin", False) and not getattr(p, "is_suspended", False)
    ]
    if not losing:
        return
    if await _count_db_superadmins(db) - len(losing) >= 1:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Refusing to {what}: it is the last superadmin account in the "
            "database. Your own access comes from "
            "POIPOIHISAB_SUPERADMIN_EMAILS, which is deployment config — if "
            "it ever changes, nobody could reach the admin area again. "
            "Grant superadmin to another account (or to yourself) first."
        ),
    )


def _kv_facts() -> tuple[str, bool, bool]:
    """``(backend_name, is_ephemeral, is_configured)`` for the live KV.

    ``is_ephemeral`` is the one a superadmin must see: MemoryKV keeps
    sessions and rate-limit counters in one process, so on serverless every
    cold start silently logs everybody out and resets brute-force counters.
    """
    from app.core.kv import get_kv

    backend = type(get_kv()).__name__
    configured = bool(get_settings().kv_url)
    return backend, backend == "MemoryKV", configured



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

    # 30-day activity. "Active" = recorded at least one expense dated inside
    # the window; there is no last_seen column to lean on, and an expense is
    # the only first-class signal that a user actually used the app.
    today = datetime.now(UTC).date()
    since = today - timedelta(days=30)
    active_users_30d = (
        await db.execute(
            select(func.count(func.distinct(Expense.user_id))).where(Expense.iso >= since)
        )
    ).scalar_one() or 0
    new_users_30d = (
        await db.execute(
            select(func.count(Profile.id)).where(
                Profile.created_at >= datetime.now(UTC) - timedelta(days=30)
            )
        )
    ).scalar_one() or 0
    suspended_users = (
        await db.execute(
            select(func.count(Profile.id)).where(Profile.is_suspended == True)
        )
    ).scalar_one() or 0
    first_of_month = date(today.year, today.month, 1)
    month_amount = (
        await db.execute(select(func.sum(Expense.amt)).where(Expense.iso >= first_of_month))
    ).scalar_one()

    return AdminPlatformStatsOut(
        totalUsers=total_users,
        totalExpenses=total_expenses,
        totalAmount=_money_str(raw_amount),
        totalDebts=total_debts,
        activeRecurring=active_recurring,
        activeUsers30d=active_users_30d,
        newUsers30d=new_users_30d,
        suspendedUsers=suspended_users,
        superadminCount=await _count_effective_superadmins(db),
        monthAmount=_money_str(month_amount),
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
        adminSources=[
            source for source, enabled in (
                ("database", profile.is_superadmin),
                ("environment", bool(profile.email) and profile.email.lower() in {
                    email.lower() for email in get_settings().superadmin_emails
                }),
            ) if enabled
        ],
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
    request: Request,
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

    if body.suspended:
        await _guard_last_db_superadmin(db, [profile], "suspend this account")

    profile.is_suspended = body.suspended
    _audit(
        db,
        current_admin,
        ACTION_USER_SUSPEND if body.suspended else ACTION_USER_UNSUSPEND,
        request=request,
        target_type="user",
        target_id=str(user_id),
        target_label=_user_label(profile),
    )
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
    request: Request,
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

    await _guard_last_db_superadmin(db, [profile], "delete this account")

    user_name = profile.name
    # Audit BEFORE the delete: the row snapshots who this was, because the
    # cascade is about to remove every other trace of them.
    _audit(
        db,
        current_admin,
        ACTION_USER_DELETE,
        request=request,
        target_type="user",
        target_id=str(user_id),
        target_label=_user_label(profile),
        detail=(
            f"cascade: {profile.email or 'no-email'} "
            "(expenses, debts, budgets, recurring)"
        ),
    )
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
    request: Request,
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

    if body.suspended:
        await _guard_last_db_superadmin(db, list(profiles), "suspend these accounts")

    for p in profiles:
        p.is_suspended = body.suspended

    _audit(
        db,
        current_admin,
        ACTION_USER_BULK_SUSPEND if body.suspended else ACTION_USER_BULK_UNSUSPEND,
        request=request,
        target_type="user",
        affected=len(profiles),
        detail="; ".join(_user_label(p) for p in profiles),
    )
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
    request: Request,
) -> AdminBulkActionOut:
    """Bulk permanently delete users, excluding the current admin.

    The most destructive endpoint in the app: an irreversible cascade over
    an arbitrary id list. It is therefore both rate-limited and audited.
    """
    target_ids = [uid for uid in body.user_ids if uid != current_admin.id]
    if not target_ids:
        return AdminBulkActionOut(
            success=True,
            affectedCount=0,
            message="No eligible accounts selected (cannot perform action on your own account)",
        )

    # Fixed-window limiter keyed to the acting admin: a runaway script (or a
    # stolen admin token) cannot walk the whole user table in one minute.
    burst = await kv.incr(f"rl:admin_bulk_delete:{current_admin.id}", 60)
    if burst > _BULK_DELETE_CALLS_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many bulk-delete calls; wait a minute and retry",
            headers={"Retry-After": str(max(await kv.ttl(f"rl:admin_bulk_delete:{current_admin.id}"), 1))},
        )
    if len(target_ids) > _BULK_DELETE_MAX_TARGETS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Refusing to delete {len(target_ids)} accounts in one call "
                f"(limit {_BULK_DELETE_MAX_TARGETS}). Delete in smaller batches."
            ),
        )

    profiles = (
        await db.execute(select(Profile).where(Profile.id.in_(target_ids)))
    ).scalars().all()

    await _guard_last_db_superadmin(db, list(profiles), "delete these accounts")

    # Audit BEFORE the cascade — after it, nothing else names these users.
    _audit(
        db,
        current_admin,
        ACTION_USER_BULK_DELETE,
        request=request,
        target_type="user",
        affected=len(profiles),
        detail="; ".join(_user_label(p) for p in profiles),
    )

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
    current_admin: SuperAdminDep,
    db: DbDep,
    request: Request,
) -> StreamingResponse:
    """Stream all registered users as an RFC-4180 CSV with UTF-8 BOM.

    Reading is not usually audited, but this endpoint exfiltrates the whole
    user table (names, emails, spend) in one request — worth a trail entry.
    """
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

    _audit(
        db,
        current_admin,
        ACTION_USER_EXPORT,
        request=request,
        target_type="user",
        affected=len(rows),
        detail=f"full users.csv dump ({len(rows)} rows)",
    )
    # Committed before the body streams: the rows are already materialised
    # above, and the generator runs after the session dependency closes.
    await db.commit()

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
    current_admin: SuperAdminDep,
    db: DbDep,
    request: Request,
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
        _audit(
            db,
            current_admin,
            ACTION_USER_IMPORT,
            request=request,
            target_type="user",
            affected=created_count,
            detail=f"created {created_count}, skipped {skipped_count}",
        )
        await db.commit()

    return AdminUserImportOut(
        success=True,
        createdCount=created_count,
        skippedCount=skipped_count,
        errors=errors[:50],
    )



# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------


@router.get("/audit", response_model=AdminAuditListOut)
async def list_admin_audit(
    _: SuperAdminDep,
    db: DbDep,
    action: Annotated[str | None, Query(description="Filter by exact action verb")] = None,
    q: Annotated[str | None, Query(description="Search actor, target or detail")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminAuditListOut:
    """Read the admin audit trail, newest first.

    Deliberately read-only: there is no endpoint that edits or deletes a
    trail entry, because a trail an admin can rewrite is not a trail.
    """
    query = select(AdminAuditLog)
    count_query = select(func.count(AdminAuditLog.id))

    if action and action.strip():
        query = query.where(AdminAuditLog.action == action.strip())
        count_query = count_query.where(AdminAuditLog.action == action.strip())
    if q and q.strip():
        term = f"%{q.strip()}%"
        expr = or_(
            AdminAuditLog.actor_email.ilike(term),
            AdminAuditLog.target_label.ilike(term),
            AdminAuditLog.target_id.ilike(term),
            AdminAuditLog.detail.ilike(term),
        )
        query = query.where(expr)
        count_query = count_query.where(expr)

    total = (await db.execute(count_query)).scalar_one() or 0
    rows = (
        await db.execute(
            query.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    # Distinct verbs present, so the UI filter only offers what exists.
    actions = [
        str(a)
        for a in (
            await db.execute(
                select(AdminAuditLog.action).distinct().order_by(AdminAuditLog.action)
            )
        ).scalars().all()
    ]

    return AdminAuditListOut(
        items=[AdminAuditItemOut.model_validate(r) for r in rows],
        total=total,
        actions=actions,
    )


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------


@router.post("/users/{user_id}/role", response_model=AdminUserActionOut)
async def set_admin_user_role(
    user_id: uuid.UUID,
    body: AdminUserRoleIn,
    current_admin: SuperAdminDep,
    db: DbDep,
    request: Request,
) -> AdminUserActionOut:
    """Grant or revoke superadmin on a user.

    Before this endpoint, ``is_superadmin`` could only be set by editing the
    ``POIPOIHISAB_SUPERADMIN_EMAILS`` env var or writing to the database by
    hand. Two guards apply: an admin cannot demote themselves (that is how
    you lock yourself out with one click), and the platform can never be
    left with zero superadmins.
    """
    if current_admin.id == user_id and not body.superadmin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot revoke superadmin from your own account",
        )
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not body.superadmin:
        # Order matters: the env allowlist wins over the DB flag inside
        # is_superadmin_user, so for an allowlisted email clearing the flag
        # would change nothing. Report that specifically rather than letting
        # the generic last-admin message below explain the wrong cause — or
        # worse, answering 200 to a revoke the next request contradicts.
        settings = get_settings()
        if profile.email and profile.email.lower() in [
            e.lower() for e in settings.superadmin_emails
        ]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"{profile.email} is granted superadmin by the "
                    "POIPOIHISAB_SUPERADMIN_EMAILS environment variable. "
                    "Remove it there and redeploy — the database flag cannot "
                    "override it."
                ),
            )
        await _guard_last_db_superadmin(db, [profile], "revoke superadmin from")

    profile.is_superadmin = body.superadmin
    _audit(
        db,
        current_admin,
        ACTION_USER_ROLE_GRANT if body.superadmin else ACTION_USER_ROLE_REVOKE,
        request=request,
        target_type="user",
        target_id=str(user_id),
        target_label=_user_label(profile),
    )
    await db.commit()

    verb = "granted to" if body.superadmin else "revoked from"
    return AdminUserActionOut(
        success=True, message=f"Superadmin {verb} {profile.name}"
    )


# ---------------------------------------------------------------------------
# Sessions & security
# ---------------------------------------------------------------------------


@router.get("/sessions", response_model=AdminSessionsOut)
async def list_admin_sessions(
    _: SuperAdminDep,
    db: DbDep,
    kv: KvDep,
    limit: Annotated[int, Query(ge=1, le=_SESSION_SCAN_MAX_USERS)] = 100,
) -> AdminSessionsOut:
    """Live sessions per user across the platform.

    ``GET /auth/sessions`` only ever shows the caller's own sessions, so
    until now the only way an admin could end someone else's session was to
    suspend the account. This walks the per-user session index instead.

    The scan is one KV round-trip per user, hence the ``limit``; users with
    no live session are omitted from the response rather than padding it.
    """
    profiles = (
        await db.execute(select(Profile).order_by(Profile.created_at.desc()).limit(limit))
    ).scalars().all()

    items: list[AdminSessionUserOut] = []
    total_sessions = 0
    for p in profiles:
        live, dead = await _scan_user_sessions(kv, str(p.id))
        if dead:
            await kv.srem(_user_sess_key(str(p.id)), *dead)
        if not live:
            continue
        total_sessions += len(live)
        items.append(
            AdminSessionUserOut(
                userId=p.id,
                name=p.name,
                email=p.email,
                isSuperadmin=is_superadmin_user(p),
                isSuspended=getattr(p, "is_suspended", False),
                sessionCount=len(live),
                maxExpiresIn=max((s.expires_in for s in live), default=0),
            )
        )

    items.sort(key=lambda i: i.session_count, reverse=True)
    backend, ephemeral, _configured = _kv_facts()
    return AdminSessionsOut(
        items=items,
        totalSessions=total_sessions,
        usersScanned=len(profiles),
        kvBackend=backend,
        kvEphemeral=ephemeral,
    )


@router.post("/users/{user_id}/revoke-sessions", response_model=AdminRevokeSessionsOut)
async def revoke_admin_user_sessions(
    user_id: uuid.UUID,
    current_admin: SuperAdminDep,
    db: DbDep,
    kv: KvDep,
    request: Request,
) -> AdminRevokeSessionsOut:
    """Sign one user out everywhere without suspending their account.

    The recovery path for a lost or shared device: suspension is the wrong
    tool there, because it also locks the user out of their own data.
    """
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    revoked = await revoke_all_user_sessions(kv, str(user_id))
    _audit(
        db,
        current_admin,
        ACTION_USER_SESSIONS_REVOKE,
        request=request,
        target_type="user",
        target_id=str(user_id),
        target_label=_user_label(profile),
        affected=revoked,
        detail=f"revoked {revoked} live session(s)",
    )
    await db.commit()

    return AdminRevokeSessionsOut(
        success=True,
        revoked=revoked,
        message=f"Revoked {revoked} session(s) for {profile.name}",
    )


# ---------------------------------------------------------------------------
# Platform analytics
# ---------------------------------------------------------------------------


def _slices(rows: list[tuple[str | None, int, Decimal | None]]) -> list[AdminSliceOut]:
    return [
        AdminSliceOut(label=str(label or "—"), count=int(count or 0), amount=_money_str(total))
        for label, count, total in rows
    ]


@router.get("/analytics", response_model=AdminAnalyticsOut)
async def get_admin_analytics(
    _: SuperAdminDep,
    db: DbDep,
    months: Annotated[int, Query(ge=1, le=36)] = 12,
) -> AdminAnalyticsOut:
    """Platform-wide spending shape, aggregated across every user.

    Deliberately aggregate-only: this is the one admin screen that reads all
    users' expenses at once, so it returns distributions and totals, never
    individual rows (the per-user inspector already covers that, one
    consciously chosen user at a time).
    """
    by_group = _slices(
        (
            await db.execute(
                select(Expense.grp, func.count(Expense.id), func.sum(Expense.amt))
                .group_by(Expense.grp)
                .order_by(func.sum(Expense.amt).desc())
            )
        ).all()  # type: ignore[arg-type]
    )
    by_category = _slices(
        (
            await db.execute(
                select(Expense.cat, func.count(Expense.id), func.sum(Expense.amt))
                .group_by(Expense.cat)
                .order_by(func.sum(Expense.amt).desc())
                .limit(20)
            )
        ).all()  # type: ignore[arg-type]
    )
    by_payment = _slices(
        (
            await db.execute(
                select(Expense.pay, func.count(Expense.id), func.sum(Expense.amt))
                .group_by(Expense.pay)
                .order_by(func.sum(Expense.amt).desc())
            )
        ).all()  # type: ignore[arg-type]
    )

    # Monthly trend. The month key is built in Python from the date column
    # rather than with strftime/to_char, which spell differently on SQLite
    # and PostgreSQL (ADR-0005 portability).
    today = datetime.now(UTC).date()
    start_year, start_month = today.year, today.month
    for _ in range(months - 1):
        start_month -= 1
        if start_month == 0:
            start_month = 12
            start_year -= 1
    window_start = date(start_year, start_month, 1)

    exp_rows = (
        await db.execute(
            select(Expense.iso, Expense.amt).where(Expense.iso >= window_start)
        )
    ).all()
    user_rows = (
        await db.execute(
            select(Profile.created_at).where(
                Profile.created_at
                >= datetime(window_start.year, window_start.month, 1, tzinfo=UTC)
            )
        )
    ).all()

    buckets: dict[str, dict[str, Decimal | int]] = {}
    cursor_year, cursor_month = start_year, start_month
    for _ in range(months):
        buckets[f"{cursor_year:04d}-{cursor_month:02d}"] = {
            "expenses": 0,
            "amount": Decimal("0.00"),
            "new_users": 0,
        }
        cursor_month += 1
        if cursor_month == 13:
            cursor_month = 1
            cursor_year += 1

    for iso, amt in exp_rows:
        key = f"{iso.year:04d}-{iso.month:02d}"
        bucket = buckets.get(key)
        if bucket is None:
            continue
        bucket["expenses"] = int(bucket["expenses"]) + 1
        bucket["amount"] = Decimal(str(bucket["amount"])) + Decimal(str(amt or 0))
    for (created,) in user_rows:
        if created is None:
            continue
        key = f"{created.year:04d}-{created.month:02d}"
        bucket = buckets.get(key)
        if bucket is not None:
            bucket["new_users"] = int(bucket["new_users"]) + 1

    trend = [
        AdminTrendPointOut(
            month=key,
            expenses=int(vals["expenses"]),
            amount=_money_str(Decimal(str(vals["amount"]))),
            newUsers=int(vals["new_users"]),
        )
        for key, vals in buckets.items()
    ]

    top_rows = (
        await db.execute(
            select(
                Profile.id,
                Profile.name,
                Profile.email,
                func.count(Expense.id),
                func.sum(Expense.amt),
            )
            .join(Expense, Expense.user_id == Profile.id)
            .group_by(Profile.id, Profile.name, Profile.email)
            .order_by(func.sum(Expense.amt).desc())
            .limit(10)
        )
    ).all()
    top_users = [
        AdminTopUserOut(
            userId=uid,
            name=name,
            email=email,
            expenseCount=int(cnt or 0),
            totalExpense=_money_str(total),
        )
        for uid, name, email, cnt, total in top_rows
    ]

    debt_rows = (
        await db.execute(select(Debt.dir, func.sum(Debt.amt)).group_by(Debt.dir))
    ).all()
    lend = Decimal("0.00")
    borrow = Decimal("0.00")
    for direction, amt_sum in debt_rows:
        if direction == "lend":
            lend = Decimal(str(amt_sum or 0))
        elif direction == "borrow":
            borrow = Decimal(str(amt_sum or 0))

    return AdminAnalyticsOut(
        byGroup=by_group,
        byCategory=by_category,
        byPayment=by_payment,
        trend=trend,
        topUsers=top_users,
        debtLend=_money_str(lend),
        debtBorrow=_money_str(borrow),
    )


# ---------------------------------------------------------------------------
# Expense taxonomy
# ---------------------------------------------------------------------------


@router.get("/categories", response_model=AdminCategoryListOut)
async def list_admin_categories(
    _: SuperAdminDep,
    db: DbDep,
) -> AdminCategoryListOut:
    """Distinct cat/grp pairs actually present in expenses, with usage.

    ``expenses.cat`` is free text: no foreign key, no check constraint, and
    the API accepts any 1-80 character string. It is also what the Bengali
    voice parser writes and what every report groups by, so the live
    taxonomy is whatever users and the parser happened to type — "রিক্সা"
    and "রিকশা" are two categories to the database and one to a human. This
    endpoint is how a superadmin sees that drift; ``grp`` is a fixed
    ``ExpenseGroup`` literal at the API layer, so it drifts only for rows
    written before a group was renamed.
    """
    rows = (
        await db.execute(
            select(
                Expense.cat,
                Expense.grp,
                func.count(Expense.id),
                func.sum(Expense.amt),
                func.count(func.distinct(Expense.user_id)),
            )
            .group_by(Expense.cat, Expense.grp)
            .order_by(func.count(Expense.id).desc())
        )
    ).all()

    items = [
        AdminCategoryItemOut(
            cat=str(cat or "—"),
            grp=str(grp or "—"),
            count=int(cnt or 0),
            amount=_money_str(total),
            userCount=int(users or 0),
        )
        for cat, grp, cnt, total, users in rows
    ]
    return AdminCategoryListOut(items=items, total=len(items))


@router.post("/categories/merge", response_model=AdminBulkActionOut)
async def merge_admin_categories(
    body: AdminCategoryMergeIn,
    current_admin: SuperAdminDep,
    db: DbDep,
    request: Request,
) -> AdminBulkActionOut:
    """Rename or merge one category into another across ALL users' expenses.

    The repair tool for taxonomy drift ("রিক্সা" vs "রিকশা" vs "rickshaw"
    all meaning the same thing). It rewrites rows for every user at once, so
    it is audited with the exact from/to pair and the affected row count.
    """
    from_cat = body.from_cat.strip()
    to_cat = body.to_cat.strip()
    if not from_cat or not to_cat:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Both categories are required"
        )
    if from_cat == to_cat and not body.to_grp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and target category are identical; nothing to merge",
        )

    affected = (
        await db.execute(select(func.count(Expense.id)).where(Expense.cat == from_cat))
    ).scalar_one() or 0
    if affected == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No expenses use the category '{from_cat}'",
        )

    values: dict[str, str] = {"cat": to_cat}
    if body.to_grp and body.to_grp.strip():
        values["grp"] = body.to_grp.strip()

    await db.execute(
        sa.update(Expense).where(Expense.cat == from_cat).values(**values)
    )
    _audit(
        db,
        current_admin,
        ACTION_CATEGORY_MERGE,
        request=request,
        target_type="category",
        target_id=from_cat,
        target_label=f"{from_cat} → {to_cat}",
        affected=int(affected),
        detail=f"rewrote {affected} expense row(s) across all users",
    )
    await db.commit()

    return AdminBulkActionOut(
        success=True,
        affectedCount=int(affected),
        message=f"Merged '{from_cat}' into '{to_cat}' across {affected} expense(s)",
    )


# ---------------------------------------------------------------------------
# System health & integrations
# ---------------------------------------------------------------------------


@router.get("/system", response_model=AdminSystemOut)
async def get_admin_system(
    _: SuperAdminDep,
    db: DbDep,
) -> AdminSystemOut:
    """Runtime facts behind the rest of the dashboard.

    The reason this screen exists: with ``POIPOIHISAB_KV_URL`` unset the app
    silently falls back to per-process ``MemoryKV``. On a serverless deploy
    that means every cold start logs everybody out and resets the
    brute-force counters — a production-breaking condition with no symptom
    anywhere else in the UI.
    """
    settings = get_settings()

    db_ok = True
    db_error: str | None = None
    dialect = "unknown"
    migration_current: str | None = None
    audit_present = False
    try:
        # Everything below is probed through the request's own session, so the
        # answer describes the database this deployment is actually serving —
        # not whatever the module-level engine happens to point at.
        conn = await db.connection()
        dialect = conn.dialect.name

        def _inspect(sync_conn: sa.Connection) -> tuple[str | None, bool]:
            insp = sa.inspect(sync_conn)
            has_audit = insp.has_table("admin_audit_log")
            version: str | None = None
            if insp.has_table("alembic_version"):
                version = sync_conn.execute(
                    sa.text("SELECT version_num FROM alembic_version LIMIT 1")
                ).scalar()
            return version, has_audit

        migration_current, audit_present = await conn.run_sync(_inspect)
    except Exception as exc:  # noqa: BLE001 — surfaced to the admin verbatim
        db_ok = False
        db_error = f"{type(exc).__name__}: {exc}"[:300]

    backend, ephemeral, configured = _kv_facts()

    warnings: list[str] = []
    if ephemeral:
        warnings.append(
            "KV falls back to in-process memory: sessions and rate-limit "
            "counters are lost on every restart or cold start. Set "
            "POIPOIHISAB_KV_URL."
        )
    if settings.env.lower() in {"prod", "production"} and not settings.refresh_cookie_secure:
        warnings.append(
            "POIPOIHISAB_REFRESH_COOKIE_SECURE is off in production: the "
            "refresh cookie can travel over plain HTTP."
        )
    if settings.database_url.startswith("sqlite"):
        warnings.append(
            "Running on SQLite. On serverless the file is per-instance and "
            "not durable — set POIPOIHISAB_DATABASE_URL to PostgreSQL."
        )
    if not audit_present:
        warnings.append(
            "admin_audit_log is missing: admin actions are not being "
            "recorded. Run `alembic upgrade head`."
        )
    if not settings.superadmin_emails:
        warnings.append("POIPOIHISAB_SUPERADMIN_EMAILS is empty.")

    return AdminSystemOut(
        env=settings.env,
        version=settings.version,
        dbDialect=dialect,
        dbOk=db_ok,
        dbError=db_error,
        kvBackend=backend,
        kvEphemeral=ephemeral,
        kvConfigured=configured,
        migrationCurrent=migration_current,
        auditTablePresent=audit_present,
        corsOrigins=list(settings.cors_origins),
        superadminEmails=list(settings.superadmin_emails),
        refreshCookieSecure=settings.refresh_cookie_secure,
        accessTtl=settings.access_ttl,
        refreshTtl=settings.refresh_ttl,
        authRateLimit=settings.auth_rate_limit,
        serverTime=datetime.now(UTC),
        warnings=warnings,
    )


@router.get("/integrations", response_model=AdminIntegrationsOut)
async def get_admin_integrations(
    _: SuperAdminDep,
    db: DbDep,
) -> AdminIntegrationsOut:
    """Global integration wiring, as opposed to any one user's settings.

    ``GET /sheets/status`` answers for the caller; the service account
    itself is deployment-wide config, and whether it is present decides
    whether Sheets sync works for *anybody*.
    """
    settings = get_settings()
    sa_email: str | None = None
    detail: str | None = None
    configured = False
    try:
        from fastapi.concurrency import run_in_threadpool

        from app.routers.sheets import _configuration

        info = await run_in_threadpool(_configuration)
        configured = info is not None
        if info is not None:
            sa_email = info.get("client_email") or None
        elif settings.google_sheets_sa_file:
            detail = (
                "POIPOIHISAB_GOOGLE_SHEETS_SA_FILE is set but the credential "
                "could not be loaded (unreadable path, or invalid JSON)."
            )
        else:
            detail = "POIPOIHISAB_GOOGLE_SHEETS_SA_FILE is not set."
    except Exception as exc:  # noqa: BLE001 — optional dependency may be absent
        detail = f"{type(exc).__name__}: {exc}"[:200]

    raw = settings.google_sheets_sa_file
    # Never echo the credential itself — inline JSON is how Vercel receives it.
    shown = "(inline JSON)" if raw.lstrip().startswith("{") else (raw or None)

    users_total = (await db.execute(select(func.count(Profile.id)))).scalar_one() or 0

    return AdminIntegrationsOut(
        sheetsConfigured=configured,
        sheetsSaFile=shown,
        sheetsSaEmail=sa_email,
        sheetsDetail=detail,
        voiceParser="on-device (browser SpeechRecognition + server /voice/parse)",
        usersTotal=users_total,
    )
