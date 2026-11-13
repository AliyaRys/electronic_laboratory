"""Local name cache of external participant objects (ТЗ DR18 §5/§7)

``vetis_reference_names`` stores, per VetIS contour and entity kind, the
locally resolved name of a ``businessEntity``/``enterprise`` object that an
incoming eVSD carries only as a GUID. ``name`` stays nullable: the absence of
a name never deletes the row and never fabricates a name. The resolution
queue lives in the same row (``next_check_at``/``failure_count``), so one key
``(contour, entity_kind, guid)`` can never get duplicate jobs. Contours and
entity kinds are never mixed. Nothing is deleted; the downgrade drops ONLY
the new table (no stored document or fact is touched).

Revision ID: 0018_vetis_reference_names
Revises: 0017_check_tariff_lab_scope
Create Date: 2026-11-13
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0018_vetis_reference_names"
down_revision: str | Sequence[str] | None = "0017_check_tariff_lab_scope"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vetis_reference_names",
        sa.Column("contour", sa.String(length=16), primary_key=True),
        sa.Column("entity_kind", sa.String(length=20), primary_key=True),
        sa.Column("guid", UUID(as_uuid=True), primary_key=True),
        sa.Column("uuid", UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_problem_code", sa.String(length=128), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_reference_contour_valid"),
        sa.CheckConstraint(
            "entity_kind IN ('BUSINESS_ENTITY','ENTERPRISE')", name="vetis_reference_kind_valid"
        ),
        sa.CheckConstraint("source IN ('SOURCE_XML','VETIS_LOOKUP')", name="vetis_reference_source_valid"),
        sa.CheckConstraint("status IN ('PENDING','RESOLVED','ERROR')", name="vetis_reference_status_valid"),
        sa.CheckConstraint("failure_count >= 0", name="vetis_reference_failures_positive"),
    )
    op.create_index("ix_vetis_reference_due", "vetis_reference_names", ["status", "next_check_at"])


def downgrade() -> None:
    op.drop_index("ix_vetis_reference_due", table_name="vetis_reference_names")
    op.drop_table("vetis_reference_names")
