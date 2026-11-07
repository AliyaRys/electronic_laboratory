"""samples: independent physical sample baskets, collections, disposal facts

Revision ID: 0008_samples
Revises: 0007_confirmation_route_flag
Create Date: 2026-11-07

DATA-03. A collection is an independent physical fact: it carries its own
party/laboratory/species snapshot, date, weight and author, so deleting or
renumbering a ВСЭ never destroys it (FT-SMP-02). The balance is a query-time
SUM of collections with ``disposal_id IS NULL`` — no materialized balance and
no second source of truth. ``sample_disposals`` is created here because
``sample_collections.disposal_id`` references it; the disposal command itself
lands in S02. ``examination_samples`` is created in E01, after the examination
FK exists.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_samples"
down_revision: str | Sequence[str] | None = "0007_confirmation_route_flag"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sample_baskets",
        sa.Column("laboratory_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_species_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("rev >= 1", name="sample_basket_rev_positive"),
    )

    disposals = op.create_table(
        "sample_disposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "laboratory_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("laboratories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("product_species_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("disposed_on", sa.Date(), nullable=False),
        sa.Column("mass_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column("external_vsd_number", sa.String(128), nullable=False),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("btrim(external_vsd_number) <> ''", name="sample_disposal_vsd_nonblank"),
        sa.CheckConstraint("mass_kg > 0", name="sample_disposal_mass_positive"),
    )
    op.create_index(
        "ix_sample_disposals_lab_date",
        "sample_disposals",
        ["laboratory_id", sa.text("disposed_on DESC"), sa.text("id DESC")],
    )
    del disposals

    op.create_table(
        "sample_collections",
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
        sa.Column("product_species_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("classification_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("collected_on", sa.Date(), nullable=False),
        sa.Column("mass_kg", sa.Numeric(20, 6), nullable=False),
        sa.Column(
            "collected_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "disposal_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sample_disposals.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("mass_kg > 0", name="sample_collection_mass_positive"),
        sa.CheckConstraint("rev >= 1", name="sample_collection_rev_positive"),
    )
    op.create_index("ix_sample_collections_lab_species", "sample_collections", ["laboratory_id", "product_species_id"])
    op.create_index("ix_sample_collections_party", "sample_collections", ["party_id"])


def downgrade() -> None:
    op.drop_index("ix_sample_collections_party", table_name="sample_collections")
    op.drop_index("ix_sample_collections_lab_species", table_name="sample_collections")
    op.drop_table("sample_collections")
    op.drop_index("ix_sample_disposals_lab_date", table_name="sample_disposals")
    op.drop_table("sample_disposals")
    op.drop_table("sample_baskets")
