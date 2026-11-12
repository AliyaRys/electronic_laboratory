"""Frozen pricing snapshot of the saved reconciliation (ТЗ DR11 §5/§6)

The ``reconciliations`` row gains ``pricing_snapshot`` JSONB: the complete
``PricingSnapshot`` calculated SERVER-side by ``evaluate_and_price`` at the
moment of the save of a full valid reconciliation (context="CHECK"). The
column is nullable — a started incomplete reconciliation legitimately has no
snapshot (O-09), and a save refused by ``CONFIGURATION_MISSING`` writes
nothing (no empty or fictitious snapshot, never a silent zero). The stored
snapshot is frozen: a later tariff change never recalculates it (ADR-020).
Nothing is deleted; the downgrade drops ONLY the new column.

Revision ID: 0016_reconciliation_pricing
Revises: 0015_source_presence
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0016_reconciliation_pricing"
down_revision: str | Sequence[str] | None = "0015_source_presence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("reconciliations", sa.Column("pricing_snapshot", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("reconciliations", "pricing_snapshot")
