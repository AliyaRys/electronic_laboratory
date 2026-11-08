"""immutable signed report snapshots

Revision ID: 0010_report_snapshots
Revises: 0009_examinations
Create Date: 2026-11-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_report_snapshots"
down_revision: str | Sequence[str] | None = "0009_examinations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("report_type", sa.String(32), nullable=False),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("half", sa.Integer(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("codes", postgresql.JSONB(), nullable=False),
        sa.Column("source_count", sa.Integer(), nullable=False),
        sa.Column("preview_generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "saved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("key_id", sa.String(128), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint("report_type", "laboratory_id", "year", "half", name="uq_report_snapshot_period"),
        sa.CheckConstraint("half IN (1, 2)", name="report_snapshot_half_valid"),
        sa.CheckConstraint("source_count >= 0", name="report_snapshot_source_count_nonnegative"),
        sa.CheckConstraint("rev = 1", name="report_snapshot_immutable_revision"),
    )
    op.create_index("ix_report_snapshots_lab_saved", "report_snapshots", ["laboratory_id", sa.text("saved_at DESC")])


def downgrade() -> None:
    op.drop_index("ix_report_snapshots_lab_saved", table_name="report_snapshots")
    op.drop_table("report_snapshots")
