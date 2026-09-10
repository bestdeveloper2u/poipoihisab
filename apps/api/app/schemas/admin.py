"""Admin request/response schemas (camelCase wire format)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.budget import BudgetOut
from app.schemas.debt import DebtOut
from app.schemas.expense import ExpenseOut
from app.schemas.recurring import RecurringOut


class AdminPlatformStatsOut(BaseModel):
    """Global system-wide statistics for superadmins."""

    model_config = ConfigDict(populate_by_name=True)

    total_users: int = Field(alias="totalUsers")
    total_expenses: int = Field(alias="totalExpenses")
    total_amount: str = Field(alias="totalAmount")
    total_debts: int = Field(alias="totalDebts")
    active_recurring: int = Field(alias="activeRecurring")
    # Added alongside the superadmin role split: the web dict already carried
    # an "active (30 days)" label with no field behind it.
    active_users_30d: int = Field(default=0, alias="activeUsers30d")
    new_users_30d: int = Field(default=0, alias="newUsers30d")
    suspended_users: int = Field(default=0, alias="suspendedUsers")
    superadmin_count: int = Field(default=0, alias="superadminCount")
    month_amount: str = Field(default="0.00", alias="monthAmount")


class AdminUserItemOut(BaseModel):
    """User row in the admin users list."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    name: str
    email: str | None
    created_at: datetime = Field(alias="createdAt")
    lang: str
    theme: str
    is_superadmin: bool = Field(alias="isSuperadmin")
    is_suspended: bool = Field(default=False, alias="isSuspended")
    expense_count: int = Field(default=0, alias="expenseCount")
    total_expense: str = Field(default="0.00", alias="totalExpense")
    debt_count: int = Field(default=0, alias="debtCount")
    budget_count: int = Field(default=0, alias="budgetCount")
    recurring_count: int = Field(default=0, alias="recurringCount")


class AdminUserListOut(BaseModel):
    """List of users with pagination total."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[AdminUserItemOut]
    total: int


class AdminUserBudgetOut(BaseModel):
    """User budget configuration."""

    model_config = ConfigDict(populate_by_name=True)

    total: str
    cats: dict[str, str]
    updated_at: datetime | None = Field(default=None, alias="updatedAt")


class AdminUserDetailOut(BaseModel):
    """Comprehensive user data summary for superadmins."""

    model_config = ConfigDict(populate_by_name=True)

    user: AdminUserItemOut
    admin_sources: list[Literal["database", "environment"]] = Field(
        default_factory=list, alias="adminSources"
    )
    total_lend: str = Field(default="0.00", alias="totalLend")
    total_borrow: str = Field(default="0.00", alias="totalBorrow")
    net_debt: str = Field(default="0.00", alias="netDebt")
    current_month_expense: str = Field(default="0.00", alias="currentMonthExpense")
    budget: AdminUserBudgetOut | None = None


class AdminUserExpensesOut(BaseModel):
    """List of expenses for a specific user."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[ExpenseOut]
    total: int


class AdminUserDebtsOut(BaseModel):
    """List of debts for a specific user."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[DebtOut]
    total: int


class AdminUserBudgetsOut(BaseModel):
    """List of budgets for a specific user."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[BudgetOut]
    total: int


class AdminUserRecurringOut(BaseModel):
    """List of recurring rules for a specific user."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[RecurringOut]
    total: int


class AdminUserSuspendIn(BaseModel):
    """Payload to suspend or unsuspend a user."""

    model_config = ConfigDict(populate_by_name=True)

    suspended: bool = True


class AdminUserActionOut(BaseModel):
    """Result of an admin action on a user."""

    model_config = ConfigDict(populate_by_name=True)

    success: bool = True
    message: str


class AdminBulkUserSuspendIn(BaseModel):
    """Payload to bulk suspend or unsuspend users."""

    model_config = ConfigDict(populate_by_name=True)

    user_ids: list[uuid.UUID] = Field(alias="userIds")
    suspended: bool = True


class AdminBulkUserDeleteIn(BaseModel):
    """Payload to bulk permanently delete users."""

    model_config = ConfigDict(populate_by_name=True)

    user_ids: list[uuid.UUID] = Field(alias="userIds")


class AdminBulkActionOut(BaseModel):
    """Result of an admin bulk action."""

    model_config = ConfigDict(populate_by_name=True)

    success: bool = True
    affected_count: int = Field(alias="affectedCount")
    message: str


class AdminUserImportRow(BaseModel):
    """Single user entry to import."""

    model_config = ConfigDict(populate_by_name=True)

    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=255)
    password: str | None = Field(default=None, max_length=100)


class AdminUserImportIn(BaseModel):
    """Payload to import a batch of users."""

    model_config = ConfigDict(populate_by_name=True)

    users: list[AdminUserImportRow]


class AdminUserImportOut(BaseModel):
    """Result of an admin user import batch."""

    model_config = ConfigDict(populate_by_name=True)

    success: bool = True
    created_count: int = Field(alias="createdCount")
    skipped_count: int = Field(alias="skippedCount")
    errors: list[str] = Field(default_factory=list)



# ---------------------------------------------------------------------------
# Superadmin role split additions (audit, roles, sessions, analytics, system)
# ---------------------------------------------------------------------------


class AdminAuditItemOut(BaseModel):
    """One row of the admin audit trail."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    actor_id: uuid.UUID | None = Field(default=None, alias="actorId")
    actor_email: str | None = Field(default=None, alias="actorEmail")
    action: str
    target_type: str | None = Field(default=None, alias="targetType")
    target_id: str | None = Field(default=None, alias="targetId")
    target_label: str | None = Field(default=None, alias="targetLabel")
    affected: int = 1
    detail: str | None = None
    ip: str | None = None
    created_at: datetime = Field(alias="createdAt")


class AdminAuditListOut(BaseModel):
    """Paginated slice of the audit trail."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[AdminAuditItemOut]
    total: int
    actions: list[str] = Field(default_factory=list)


class AdminUserRoleIn(BaseModel):
    """Payload to grant or revoke superadmin on a user."""

    model_config = ConfigDict(populate_by_name=True)

    superadmin: bool


class AdminSessionUserOut(BaseModel):
    """Live-session summary for one user."""

    model_config = ConfigDict(populate_by_name=True)

    user_id: uuid.UUID = Field(alias="userId")
    name: str
    email: str | None
    is_superadmin: bool = Field(alias="isSuperadmin")
    is_suspended: bool = Field(alias="isSuspended")
    session_count: int = Field(alias="sessionCount")
    # Longest remaining TTL across that user's live sessions, in seconds.
    max_expires_in: int = Field(default=0, alias="maxExpiresIn")


class AdminSessionsOut(BaseModel):
    """Live sessions across the platform, users with none omitted."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[AdminSessionUserOut]
    total_sessions: int = Field(alias="totalSessions")
    users_scanned: int = Field(alias="usersScanned")
    kv_backend: str = Field(alias="kvBackend")
    # True when sessions live in per-process memory: they die on every cold
    # start, so what this endpoint reports is one lambda's view, not truth.
    kv_ephemeral: bool = Field(alias="kvEphemeral")


class AdminRevokeSessionsOut(BaseModel):
    """Result of revoking one user's sessions."""

    model_config = ConfigDict(populate_by_name=True)

    success: bool = True
    revoked: int
    message: str


class AdminSliceOut(BaseModel):
    """One labelled bucket in an analytics breakdown."""

    model_config = ConfigDict(populate_by_name=True)

    label: str
    count: int
    amount: str


class AdminTrendPointOut(BaseModel):
    """One month in a platform trend series."""

    model_config = ConfigDict(populate_by_name=True)

    month: str
    expenses: int
    amount: str
    new_users: int = Field(alias="newUsers")


class AdminTopUserOut(BaseModel):
    """One row of the top-spenders table."""

    model_config = ConfigDict(populate_by_name=True)

    user_id: uuid.UUID = Field(alias="userId")
    name: str
    email: str | None
    expense_count: int = Field(alias="expenseCount")
    total_expense: str = Field(alias="totalExpense")


class AdminAnalyticsOut(BaseModel):
    """Platform-wide spending analytics (all users aggregated)."""

    model_config = ConfigDict(populate_by_name=True)

    by_group: list[AdminSliceOut] = Field(alias="byGroup")
    by_category: list[AdminSliceOut] = Field(alias="byCategory")
    by_payment: list[AdminSliceOut] = Field(alias="byPayment")
    trend: list[AdminTrendPointOut]
    top_users: list[AdminTopUserOut] = Field(alias="topUsers")
    debt_lend: str = Field(default="0.00", alias="debtLend")
    debt_borrow: str = Field(default="0.00", alias="debtBorrow")


class AdminCategoryItemOut(BaseModel):
    """One distinct category/group pair with platform-wide usage."""

    model_config = ConfigDict(populate_by_name=True)

    cat: str
    grp: str
    count: int
    amount: str
    user_count: int = Field(alias="userCount")


class AdminCategoryListOut(BaseModel):
    """Free-text expense taxonomy as it actually exists in the data."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[AdminCategoryItemOut]
    total: int


class AdminCategoryMergeIn(BaseModel):
    """Rename or merge a category across every user's expenses."""

    model_config = ConfigDict(populate_by_name=True)

    from_cat: str = Field(alias="fromCat", min_length=1, max_length=100)
    to_cat: str = Field(alias="toCat", min_length=1, max_length=100)
    # Optional: also rewrite the group of the affected rows.
    to_grp: str | None = Field(default=None, alias="toGrp", max_length=100)


class AdminSystemOut(BaseModel):
    """Runtime facts a superadmin needs to trust the rest of the dashboard."""

    model_config = ConfigDict(populate_by_name=True)

    env: str
    version: str
    db_dialect: str = Field(alias="dbDialect")
    db_ok: bool = Field(alias="dbOk")
    db_error: str | None = Field(default=None, alias="dbError")
    kv_backend: str = Field(alias="kvBackend")
    kv_ephemeral: bool = Field(alias="kvEphemeral")
    kv_configured: bool = Field(alias="kvConfigured")
    migration_current: str | None = Field(default=None, alias="migrationCurrent")
    audit_table_present: bool = Field(alias="auditTablePresent")
    cors_origins: list[str] = Field(alias="corsOrigins")
    superadmin_emails: list[str] = Field(alias="superadminEmails")
    refresh_cookie_secure: bool = Field(alias="refreshCookieSecure")
    access_ttl: int = Field(alias="accessTtl")
    refresh_ttl: int = Field(alias="refreshTtl")
    auth_rate_limit: int = Field(alias="authRateLimit")
    server_time: datetime = Field(alias="serverTime")
    warnings: list[str] = Field(default_factory=list)


class AdminIntegrationsOut(BaseModel):
    """Global integration wiring (not any one user's settings)."""

    model_config = ConfigDict(populate_by_name=True)

    sheets_configured: bool = Field(alias="sheetsConfigured")
    sheets_sa_file: str | None = Field(default=None, alias="sheetsSaFile")
    sheets_sa_email: str | None = Field(default=None, alias="sheetsSaEmail")
    sheets_detail: str | None = Field(default=None, alias="sheetsDetail")
    voice_parser: str = Field(default="on-device", alias="voiceParser")
    users_total: int = Field(alias="usersTotal")
