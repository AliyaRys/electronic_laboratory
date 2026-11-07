"""receipt_confirmations: freeze the route-relevant previous-ВСЭ decision

Revision ID: 0007_confirmation_route_flag
Revises: 0006_arrivals
Create Date: 2026-11-07

Review fix (A03, Important): the downstream route (FT-ARR-12) must survive the
deletion of the reconciliation row. The previous-sufficient flag
(previous ВСЭ present AND repeat explicitly not required) is frozen into the
confirmation at confirm time and is what ``downstream_route`` reads.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_confirmation_route_flag"
down_revision: str | Sequence[str] | None = "0006_arrivals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "receipt_confirmations",
        sa.Column("previous_sufficient", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("receipt_confirmations", "previous_sufficient")
