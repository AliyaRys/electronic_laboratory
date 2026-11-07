"""atomic first examination save

Revision ID: 0009_examinations
Revises: 0008_samples
Create Date: 2026-11-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_examinations"
down_revision: str | Sequence[str] | None = "0008_samples"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "examinations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "party_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("parties.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("number", sa.String(128), nullable=False),
        sa.Column("stamp", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sent_to_lab", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("research_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("findings_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("pricing_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=True),
        sa.Column("direction", sa.String(16), nullable=True),
        sa.Column("reason", sa.String(2000), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint("party_id", name="uq_examination_party"),
        sa.UniqueConstraint("laboratory_id", "number", name="uq_examination_lab_number"),
        sa.CheckConstraint("status IN ('WAITING','COMPLETED')", name="examination_status_valid"),
        sa.CheckConstraint("btrim(number) <> ''", name="examination_number_nonblank"),
        sa.CheckConstraint("btrim(stamp) <> ''", name="examination_stamp_nonblank"),
        sa.CheckConstraint("rev >= 1", name="examination_rev_positive"),
        sa.CheckConstraint(
            "(status = 'WAITING' AND first_completed_at IS NULL) OR "
            "(status = 'COMPLETED' AND first_completed_at IS NOT NULL)",
            name="examination_completion_consistent",
        ),
    )
    op.create_index("ix_examinations_lab_created", "examinations", ["laboratory_id", sa.text("created_at DESC")])
    op.create_table(
        "examination_samples",
        sa.Column(
            "examination_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("examinations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "collection_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sample_collections.id", ondelete="RESTRICT"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("examination_samples")
    op.drop_index("ix_examinations_lab_created", table_name="examinations")
    op.drop_table("examinations")
