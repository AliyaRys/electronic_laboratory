"""durable examination deletion tombstones

Revision ID: 0011_examination_tombstones
Revises: 0010_report_snapshots
Create Date: 2026-11-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_examination_tombstones"
down_revision: str | Sequence[str] | None = "0010_report_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_command_records_status_valid"), "command_records", type_="check")
    op.create_check_constraint(
        "status_valid",
        "command_records",
        "status IN ('IN_PROGRESS','SUCCESS','FAILED','UNKNOWN')",
    )
    op.create_table(
        "examination_tombstones",
        sa.Column("examination_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("command_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.UniqueConstraint("command_id", name="uq_examination_tombstone_command"),
    )


def downgrade() -> None:
    op.drop_table("examination_tombstones")
    op.drop_constraint(op.f("ck_command_records_status_valid"), "command_records", type_="check")
    op.create_check_constraint(
        "status_valid",
        "command_records",
        "status IN ('IN_PROGRESS','SUCCESS','FAILED')",
    )
