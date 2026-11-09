"""VetIS ТЗ-10: bindings, sync operations journal and per-eVSD raw XML store

Revision ID: 0012_vetis_operations
Revises: 0011_examination_tombstones
Create Date: 2026-11-09

Extends the DATA-05 journal family (no duplication of the technical-events or
outbox tables): ``vetis_bindings`` is the registered laboratory→enterprise
binding with the read initiator and the successful-full-run checkpoint
(``last_success``); ``vetis_operations`` is the durable sync/receipt operation
journal the worker and dispatcher restore from SQL; ``vetis_source_documents``
keeps the raw source XML of every external UUID with revision/checksum.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_vetis_operations"
down_revision: str | Sequence[str] | None = "0011_examination_tombstones"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vetis_bindings",
        sa.Column("laboratory_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("contour", sa.String(16), nullable=False),
        sa.Column("business_member_id", sa.String(64), nullable=True),
        sa.Column("enterprise_id", sa.String(64), nullable=True),
        # The read initiator lives server-side (secret profile); the column
        # stores the identity NAME only — never an apiKey or a login secret.
        sa.Column("initiator", sa.String(128), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        # The checkpoint: the instant of the last SUCCESSFUL FULL page walk.
        sa.Column("last_success", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["laboratory_id"], ["laboratories.id"], ondelete="RESTRICT", name="fk_vetis_bindings_lab"
        ),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_bindings_contour_valid"),
    )
    op.create_index("ix_vetis_bindings_active", "vetis_bindings", ["laboratory_id"])

    op.create_table(
        "vetis_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("contour", sa.String(16), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        # The RECEIPT operations (ТЗ-11/W01) reference the party; sync rows leave it NULL.
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["party_id"], ["parties.id"], ondelete="RESTRICT", name="fk_vetis_operations_party"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_success", sa.DateTime(timezone=True), nullable=True),
        sa.Column("problem_code", sa.String(128), nullable=True),
        sa.Column("problem_detail", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=False, server_default=sa.text("gen_random_uuid()::text")),
        sa.Column("pages_done", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("imported", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("kind IN ('SYNC','RECEIPT')", name="vetis_operations_kind_valid"),
        sa.CheckConstraint(
            "state IN ('PENDING','RUNNING','SUCCESS','FAILED','CONFIRMED','REJECTED')",
            name="vetis_operations_state_valid",
        ),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_operations_contour_valid"),
    )
    op.create_index(
        "ix_vetis_operations_scope_state",
        "vetis_operations",
        ["laboratory_id", "kind", "state"],
    )

    op.create_table(
        "vetis_source_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("contour", sa.String(16), nullable=False),
        sa.Column("evsd_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("raw_xml", sa.Text(), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("contour", "evsd_uuid", name="uq_vetis_source_contour_evsd"),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_source_contour_valid"),
    )


def downgrade() -> None:
    op.drop_table("vetis_source_documents")
    op.drop_index("ix_vetis_operations_scope_state", table_name="vetis_operations")
    op.drop_table("vetis_operations")
    op.drop_index("ix_vetis_bindings_active", table_name="vetis_bindings")
    op.drop_table("vetis_bindings")
