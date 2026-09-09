"""Admin request/response schemas (camelCase wire format)."""

import uuid
from datetime import datetime

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

