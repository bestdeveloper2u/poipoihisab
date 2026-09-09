"""admin_audit_log — trail for every mutating superadmin action

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-09

Before this table, ``POST /admin/users/bulk-delete`` cascaded permanent
deletes with no record of who ran it. Every mutating admin endpoint now
writes a row here inside the same transaction as the mutation.

``actor_id``/``target_id`` carry NO foreign keys on purpose: the trail must
outlive both the admin who acted and the user they acted on (a cascade
delete removes the profile, not the evidence). ``actor_email`` and
``target_label`` are denormalised snapshots for the same reason.

``app.db.session.ensure_schema_ready`` also issues an equivalent lazy
CREATE TABLE IF NOT EXISTS, so serverless deploys that cannot run Alembic
still get the table — this migration exists so Alembic-managed databases
track it too.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("admin_audit_log"):
        # ensure_schema_ready may have created it already (same schema).
        return
    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("actor_email", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=True),
        sa.Column("target_id", sa.Text(), nullable=True),
        sa.Column("target_label", sa.Text(), nullable=True),
        sa.Column("affected", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("ip", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_admin_audit_log"),
    )
    op.create_index("admin_audit_created", "admin_audit_log", ["created_at"])
    op.create_index("admin_audit_action", "admin_audit_log", ["action"])


def downgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("admin_audit_log"):
        return
    op.drop_index("admin_audit_action", table_name="admin_audit_log")
    op.drop_index("admin_audit_created", table_name="admin_audit_log")
    op.drop_table("admin_audit_log")
