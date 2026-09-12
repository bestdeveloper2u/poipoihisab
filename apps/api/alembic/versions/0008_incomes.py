"""incomes — income tracking table

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-12

Stores income entries (salary, freelance, business, gifts, etc.) per user.
Follows ADR-0004 wire contract and ADR-0005 DB portability.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("incomes"):
        return
    op.create_table(
        "incomes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("amt", sa.Numeric(12, 2), nullable=False),
        sa.Column("pay", sa.Text(), server_default=sa.text("'cash'"), nullable=False),
        sa.Column("desc", sa.Text(), nullable=True),
        sa.Column("iso", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("amt > 0", name=op.f("income_amt_positive")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["profiles.id"],
            name=op.f("fk_incomes_user_id_profiles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_incomes")),
    )
    op.create_index(
        "incomes_user_iso",
        "incomes",
        ["user_id", sa.text("iso DESC")],
    )


def downgrade() -> None:
    op.drop_index("incomes_user_iso", table_name="incomes")
    op.drop_table("incomes")
