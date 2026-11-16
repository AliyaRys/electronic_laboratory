"""VetIS receipt intent, submit/poll journal and durable evidence

Revision ID: 0013_vetis_receipts
Revises: 0012_vetis_operations
Create Date: 2026-11-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_vetis_receipts"
down_revision: str | Sequence[str] | None = "0012_vetis_operations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("vetis_operations_state_valid", "vetis_operations", type_="check")
    op.create_check_constraint(
        "vetis_operations_state_valid",
        "vetis_operations",
        "state IN ('PENDING','RUNNING','SUCCESS','FAILED','NOT_SENT','QUEUED',"
        "'SUBMITTING','PROCESSING','CONFIRMED','REJECTED','UNKNOWN')",
    )
    columns: list[sa.Column[object]] = [
        sa.Column("source_checksum", sa.String(64)),
        sa.Column("source_revision", sa.BigInteger()),
        sa.Column("reconciliation_revision", sa.BigInteger()),
        sa.Column("local_transaction_id", sa.String(64)),
        sa.Column("application_id", sa.String(128)),
        sa.Column("fingerprint", sa.String(64)),
        sa.Column("intent", postgresql.JSONB()),
        sa.Column("evidence", postgresql.JSONB()),
        sa.Column("diagnostics", postgresql.JSONB()),
        sa.Column("confirmed_by", postgresql.UUID(as_uuid=True)),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("next_poll_at", sa.DateTime(timezone=True)),
        sa.Column("poll_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
    ]
    for column in columns:
        op.add_column("vetis_operations", column)
    op.create_unique_constraint("uq_vetis_operations_local_tx", "vetis_operations", ["local_transaction_id"])
    op.create_unique_constraint("uq_vetis_operations_application", "vetis_operations", ["application_id"])
    op.create_index(
        "uq_vetis_receipt_unresolved_party",
        "vetis_operations",
        ["party_id"],
        unique=True,
        postgresql_where=sa.text(
            "kind = 'RECEIPT' AND state NOT IN ('CONFIRMED','REJECTED')"
        ),
    )
    op.create_index("ix_vetis_receipt_poll_due", "vetis_operations", ["kind", "state", "next_poll_at"])


def downgrade() -> None:
    op.drop_index("ix_vetis_receipt_poll_due", table_name="vetis_operations")
    op.drop_index("uq_vetis_receipt_unresolved_party", table_name="vetis_operations")
    op.drop_constraint("uq_vetis_operations_application", "vetis_operations", type_="unique")
    op.drop_constraint("uq_vetis_operations_local_tx", "vetis_operations", type_="unique")
    for name in (
        "poll_attempts", "next_poll_at", "submitted_at", "confirmed_at", "confirmed_by",
        "diagnostics", "evidence", "intent", "fingerprint", "application_id",
        "local_transaction_id", "reconciliation_revision", "source_revision", "source_checksum",
    ):
        op.drop_column("vetis_operations", name)
    op.drop_constraint("vetis_operations_state_valid", "vetis_operations", type_="check")
    op.create_check_constraint(
        "vetis_operations_state_valid",
        "vetis_operations",
        "state IN ('PENDING','RUNNING','SUCCESS','FAILED','CONFIRMED','REJECTED')",
    )
