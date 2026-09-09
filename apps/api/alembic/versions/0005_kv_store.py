"""kv_store — shared KV for sessions/rate-limits (Vercel serverless support)

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-08

Backs ``app.core.kv.PostgresKV``: when ``poipoihisab_KV_URL`` is a
``postgres://`` URL, auth sessions, the session index, and fixed-window
rate-limit counters live here instead of per-process memory or Redis —
the property serverless deploys need (every lambda instance sees the
same rows; expiry is a ``timestamptz`` compared against the DB clock).

Layout mirrors MemoryKV's two namespaces: string keys are ``kind='s'``
rows (``member=''``), set members are ``kind='m'`` rows (one per member).
``PostgresKV`` also lazily issues the equivalent ``CREATE TABLE IF NOT
EXISTS``, so a fresh environment works even before this migration runs —
the migration exists so Alembic-managed databases track the table too.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("kv_store"):
        # PostgresKV's lazy DDL may have created the table before this
        # migration ran (same schema) — record the revision and move on.
        return
    op.create_table(
        "kv_store",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("member", sa.Text(), nullable=False, server_default=""),
        sa.Column("val", sa.Text(), nullable=True),
        sa.Column("exp", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("key", "kind", "member", name="pk_kv_store"),
    )
    op.create_index("ix_kv_store_exp", "kv_store", ["exp"])


def downgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("kv_store"):
        return
    op.drop_index("ix_kv_store_exp", table_name="kv_store")
    op.drop_table("kv_store")
