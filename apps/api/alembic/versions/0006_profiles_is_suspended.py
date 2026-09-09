"""profiles: add is_suspended for superadmin user moderation

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-08

Adds is_suspended boolean column to profiles table with default false.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "profiles" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("profiles")}
        if "is_suspended" in cols:
            return
    op.add_column(
        "profiles",
        sa.Column(
            "is_suspended",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("profiles", "is_suspended")
