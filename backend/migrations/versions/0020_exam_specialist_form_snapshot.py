"""Examination create data rules (DR35): specialist identity + frozen form snapshot.

The create page must read ONE immutable local snapshot of the confirmed
reconciliation step (ТЗ 2026-11-16-examination-create-data-rules-and-live-pricing
§4/§14) and must keep the specialist of the ВСЭ separately from the audit actor
(§12.3).

Upgrade (NON-DESTRUCTIVE, repeatable):
- ``examinations.specialist_id`` (nullable FK to users) — the chosen
  Госветслужбы specialist, distinct from ``created_by``/``updated_by``;
- ``examinations.specialist_name`` (nullable) — the ФИО frozen at save time,
  so the historical display survives a later user block;
- ``parties.form_snapshot`` (nullable JSONB) — the frozen create-page snapshot:
  four participant display values, the product type code, the accepted mass and
  quantity of the confirmed reconciliation and the pinned source/reconciliation
  revisions. Legacy backfill is performed by the read model and NEVER
  overwrites a non-empty frozen value (§4.2).

Existing rows are never rewritten: a card without ``specialist_id`` keeps the
audit actor as the displayed specialist (documented fallback, no fabricated
data), and an absent ``form_snapshot`` is backfilled from the saved
confirmation and the local name cache on read.

Revision ID: 0020_dr35_specialist
Revises: 0019_meat_scope_methods
Create Date: 2026-11-16
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_dr35_specialist"
down_revision: str | Sequence[str] | None = "0019_meat_scope_methods"  # type: ignore[name-defined]
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("examinations", sa.Column("specialist_id", sa.UUID(), nullable=True))
    op.add_column("examinations", sa.Column("specialist_name", sa.String(255), nullable=True))
    op.create_foreign_key(
        "fk_examinations_specialist",
        "examinations",
        "users",
        ["specialist_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column("parties", sa.Column("form_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("parties", "form_snapshot")
    op.drop_constraint("fk_examinations_specialist", "examinations", type_="foreignkey")
    op.drop_column("examinations", "specialist_name")
    op.drop_column("examinations", "specialist_id")
