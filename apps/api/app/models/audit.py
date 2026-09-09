"""admin_audit_log table.

Every mutating superadmin action is recorded here (ADR: superadmin role
split). The row is written inside the SAME transaction as the mutation it
describes, so an action can never commit without its trail — and a rolled
back action leaves no phantom entry.

``actor_id`` is intentionally NOT a foreign key: an admin account may later
be deleted, and the trail of what that admin did must survive them. The
denormalised ``actor_email``/``target_label`` columns exist for the same
reason — after a cascade delete the target profile is gone, and the log is
the only remaining record of who it was.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import GUID

# Action verbs written to ``action``. Kept as plain strings (no DB enum) so
# adding a verb never needs a migration on either dialect.
ACTION_USER_SUSPEND = "user.suspend"
ACTION_USER_UNSUSPEND = "user.unsuspend"
ACTION_USER_DELETE = "user.delete"
ACTION_USER_BULK_SUSPEND = "user.bulk_suspend"
ACTION_USER_BULK_UNSUSPEND = "user.bulk_unsuspend"
ACTION_USER_BULK_DELETE = "user.bulk_delete"
ACTION_USER_IMPORT = "user.import"
ACTION_USER_EXPORT = "user.export"
ACTION_USER_ROLE_GRANT = "user.role_grant"
ACTION_USER_ROLE_REVOKE = "user.role_revoke"
ACTION_USER_SESSIONS_REVOKE = "user.sessions_revoke"
ACTION_CATEGORY_MERGE = "category.merge"


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    # No FK: the trail outlives the admin who wrote it.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(GUID())
    actor_email: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_type: Mapped[str | None] = mapped_column(Text)
    target_id: Mapped[str | None] = mapped_column(Text)
    # Human-readable snapshot of the target at action time (name/email), so a
    # cascade-deleted user is still identifiable in the log.
    target_label: Mapped[str | None] = mapped_column(Text)
    # How many rows the action touched (1 for single-target actions).
    affected: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    detail: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("admin_audit_created", "created_at"),
        Index("admin_audit_action", "action"),
    )
