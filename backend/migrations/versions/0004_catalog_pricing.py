"""catalog_pricing configuration tables

Revision ID: 0004_catalog_pricing
Revises: 0003_user_admin_constraints
Create Date: 2026-11-06

Task C01 (DATA-04): versioned method rules with one active applicability
version, tariffs, the two CHECK service rules, report classifications and the
bulk price job/targets contract tables. Money is NUMERIC(20,2), quantities and
masses NUMERIC(20,6) (SPEC-05). Snapshot tables of working records belong to
their own domains (DATA-03) and arrive with those tasks.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_catalog_pricing"
down_revision: str | Sequence[str] | None = "0003_user_admin_constraints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "method_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("laboratory_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_species_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_state_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("indicator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("result_schema", sa.String(32), nullable=False),
        sa.Column("unit_id", sa.String(64), nullable=False),
        sa.Column("rule", postgresql.JSONB(), nullable=False),
        sa.Column("source", postgresql.JSONB(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("rev >= 1", name="rev_positive"),
        sa.CheckConstraint("version >= 1", name="version_positive"),
    )
    op.create_index(
        "uq_method_rule_active",
        "method_rules",
        ["laboratory_id", "product_species_id", "product_state_id", "indicator_id"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.create_index("ix_method_rules_scope", "method_rules", ["laboratory_id", "product_species_id", "indicator_id"])

    op.create_table(
        "tariffs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("laboratory_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_species_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_code", sa.String(128), nullable=False),
        sa.Column("unit_id", sa.String(64), nullable=False),
        sa.Column("price", sa.Numeric(20, 2), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("source", postgresql.JSONB(), nullable=False),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint(
            "laboratory_id", "product_species_id", "service_code", "unit_id", name="uq_tariff_scope_code_unit"
        ),
        sa.CheckConstraint("price >= 0", name="price_nonnegative"),
        sa.CheckConstraint("rev >= 1", name="rev_positive"),
    )
    op.create_index("ix_tariffs_lab", "tariffs", ["laboratory_id", "product_species_id"])

    op.create_table(
        "check_service_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("service_code", sa.String(64), nullable=False),
        sa.Column("unit_id", sa.String(64), nullable=False),
        sa.Column("multiplier_basis", sa.String(32), nullable=False),
        sa.Column("applicable_decisions", postgresql.JSONB(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("source", postgresql.JSONB(), nullable=False),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint("service_code", name="uq_check_service_code"),
        sa.CheckConstraint(
            "service_code IN ('PRODUCT_IDENTIFICATION','TRANSPORT_INSPECTION')", name="service_code_valid"
        ),
        sa.CheckConstraint(
            "multiplier_basis IN ('ACCEPTED_QUANTITY','DELIVERED_QUANTITY','ONE_SERVICE')",
            name="multiplier_basis_valid",
        ),
        sa.CheckConstraint("rev >= 1", name="rev_positive"),
    )

    op.create_table(
        "report_classifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("mercury_species_id", sa.String(64), nullable=False),
        sa.Column("product_type_id", sa.String(64), nullable=True),
        sa.Column("product_state_id", sa.String(64), nullable=True),
        sa.Column("supported", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("animal_column", sa.String(32), nullable=False),
        sa.Column("material_kind", sa.String(16), nullable=False),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.UniqueConstraint("version", "mercury_species_id", name="uq_classification_species"),
        sa.CheckConstraint("material_kind IN ('MEAT','OFFAL')", name="material_kind_valid"),
        sa.CheckConstraint(
            "animal_column IN ('CATTLE','PIG','SHEEP_GOAT','RABBIT_NUTRIA','CHICKEN','OTHER_BIRDS','FISH',"
            "'OTHER_ANIMALS')",
            name="animal_column_valid",
        ),
    )
    op.create_index("ix_classification_version", "report_classifications", ["version"])

    op.create_table(
        "bulk_price_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_species_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_code", sa.String(128), nullable=False),
        sa.Column("unit_id", sa.String(64), nullable=False),
        sa.Column("price", sa.Numeric(20, 2), nullable=False),
        sa.Column("created_at", sa.Date(), nullable=True),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("price >= 0", name="price_nonnegative"),
    )

    op.create_table(
        "bulk_price_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("bulk_price_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("laboratory_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("problem_code", sa.String(128), nullable=True),
        sa.UniqueConstraint("job_id", "laboratory_id", name="uq_bulk_target_lab"),
        sa.CheckConstraint("state IN ('PENDING','SUCCEEDED','FAILED')", name="state_valid"),
    )


def downgrade() -> None:
    op.drop_table("bulk_price_targets")
    op.drop_table("bulk_price_jobs")
    op.drop_index("ix_classification_version", table_name="report_classifications")
    op.drop_table("report_classifications")
    op.drop_table("check_service_rules")
    op.drop_index("ix_tariffs_lab", table_name="tariffs")
    op.drop_table("tariffs")
    op.drop_index("ix_method_rules_scope", table_name="method_rules")
    op.drop_index("uq_method_rule_active", table_name="method_rules")
    op.drop_table("method_rules")
