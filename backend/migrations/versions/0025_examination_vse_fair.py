"""DR52 §3.2: the examination's own VSE-only fair flag (vse_fair).

The card of the ВСЭ receives its own persistable «Ярмарка» mark:

- ``examinations.vse_fair`` boolean NOT NULL with server default ``false``;
- existing cards keep ``false`` and their frozen pricing snapshots and totals
  are NEVER recalculated by this migration;
- the effective VSE free rule stays a pricing-time decision:
  ``effective_vse_fair = reconciliation.fair OR examination.vse_fair``.

Downgrade drops only the added column (data of the column itself is lost by
design, the card rows survive).

Revision ID: 0025_examination_vse_fair
Revises: 0024_report_classification_seed
Create Date: 2026-11-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_examination_vse_fair"
down_revision: str | Sequence[str] | None = "0024_report_classification_seed"  # type: ignore[name-defined]
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "examinations",
        sa.Column("vse_fair", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("examinations", "vse_fair")
