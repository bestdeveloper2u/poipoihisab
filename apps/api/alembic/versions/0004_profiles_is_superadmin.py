"""profiles: add is_superadmin for superadmin access

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-08

Adds is_superadmin boolean column to profiles table with default false.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "profiles" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("profiles")}
        if "is_superadmin" in cols:
            return
    op.add_column(
        "profiles",
        sa.Column(
            "is_superadmin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("profiles", "is_superadmin")
