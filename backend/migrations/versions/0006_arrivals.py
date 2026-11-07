"""arrivals: incoming eVSD identity, parties, reconciliation shell, hiding

Revision ID: 0006_arrivals
Revises: 0005_mercury_product_lvl2
Create Date: 2026-11-07

DATA-02. The queue is a query-time read model; no queue column is stored.
``hidden_incoming`` keeps the user's hide decision per content hash —
``fetched_at`` is excluded from the hash so a fresh import of an unchanged
document stays invisible (AT-23).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_arrivals"
down_revision: str | Sequence[str] | None = "0005_mercury_product_lvl2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    incoming = op.create_table(
        "incoming_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("contour", sa.String(16), nullable=False),
        sa.Column("evsd_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("external_status", sa.String(64), nullable=False),
        sa.Column("source_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("replaced_document_uuid", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("contour", "evsd_uuid", name="uq_incoming_contour_evsd"),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="incoming_contour_valid"),
        sa.CheckConstraint("rev >= 1", name="incoming_rev_positive"),
    )
    op.create_index(
        "ix_incoming_lab_created",
        "incoming_documents",
        ["laboratory_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index("ix_incoming_external_uuid", "incoming_documents", ["contour", "evsd_uuid"])
    op.create_index("ix_incoming_status", "incoming_documents", ["external_status"])

    parties = op.create_table(
        "parties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "incoming_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("incoming_documents.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("classification_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("rev >= 1", name="party_rev_positive"),
    )
    op.create_index(
        "ix_parties_lab_created",
        "parties",
        ["laboratory_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )

    quantity_columns = [
        ("delivered_mass_kg", "delivered_quantity", "delivered_unit_id"),
        ("accepted_mass_kg", "accepted_quantity", "accepted_unit_id"),
        ("returned_mass_kg", "returned_quantity", "returned_unit_id"),
    ]
    reconciliation = op.create_table(
        "reconciliations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "party_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("parties.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("checks", postgresql.JSONB(), nullable=False),
        *(
            sa.Column(mass, sa.Numeric(20, 6), nullable=False, server_default=sa.text("0"))
            for mass, _, _ in quantity_columns
        ),
        *(
            sa.Column(quantity, sa.Numeric(20, 6), nullable=False, server_default=sa.text("0"))
            for _, quantity, _ in quantity_columns
        ),
        *(sa.Column(unit, sa.String(64), nullable=True) for _, _, unit in quantity_columns),
        sa.Column("decision", sa.String(20), nullable=True),
        sa.Column("transaction_planned", sa.Boolean(), nullable=True),
        sa.Column("transaction_type", sa.String(20), nullable=True),
        sa.Column("fair", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("services", postgresql.JSONB(), nullable=False),
        sa.Column("repeated_required", sa.Boolean(), nullable=True),
        sa.Column("repeat_reason", sa.String(255), nullable=True),
        sa.Column("repeat_act_number", sa.String(64), nullable=True),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("state IN ('OPEN','CONFIRMED','RETURNED')", name="reconciliation_state_valid"),
        sa.CheckConstraint("rev >= 1", name="reconciliation_rev_positive"),
    )
    del reconciliation, incoming, parties

    op.create_table(
        "receipt_confirmations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "party_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("parties.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("source_evsd_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.Column("accepted_mass_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column("accepted_quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("accepted_unit_id", sa.String(64), nullable=False),
        sa.Column("returned_mass_kg", sa.Numeric(20, 6), nullable=False, server_default=sa.text("0")),
        sa.Column("returned_quantity", sa.Numeric(20, 6), nullable=False, server_default=sa.text("0")),
        sa.Column("returned_unit_id", sa.String(64), nullable=True),
        sa.Column("classification_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    hidden = op.create_table(
        "hidden_incoming",
        sa.Column("contour", sa.String(16), primary_key=True),
        sa.Column("evsd_uuid", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="hidden_contour_valid"),
    )
    op.create_index("ix_hidden_hash", "hidden_incoming", ["contour", "evsd_uuid", "content_hash"])
    del hidden


def downgrade() -> None:
    op.drop_index("ix_hidden_hash", table_name="hidden_incoming")
    op.drop_table("hidden_incoming")
    op.drop_table("receipt_confirmations")
    op.drop_table("reconciliations")
    op.drop_index("ix_parties_lab_created", table_name="parties")
    op.drop_table("parties")
    op.drop_index("ix_incoming_status", table_name="incoming_documents")
    op.drop_index("ix_incoming_external_uuid", table_name="incoming_documents")
    op.drop_index("ix_incoming_lab_created", table_name="incoming_documents")
    op.drop_table("incoming_documents")
