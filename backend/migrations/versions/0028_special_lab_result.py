"""DR56 §9.1: the special-laboratory answer as a separate nullable fact.

``examinations`` gains ``special_lab_result`` — the free human-readable text
of the special laboratory research answer. It belongs only to cards with
``sent_to_lab = true``; existing rows migrate to ``NULL`` (no answer is ever
invented). The domain layer enforces the lifecycle (required only for the
WAITING → COMPLETED transition of a sent_to_lab card, rejected for ordinary
cards); the migration only adds the nullable column and changes nothing else.

Revision ID: 0028_special_lab_result
Revises: 0027_unit_reference_names
Create Date: 2026-11-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_special_lab_result"
down_revision: str | Sequence[str] | None = "0027_unit_reference_names"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("examinations", sa.Column("special_lab_result", sa.String(length=2000), nullable=True))


def downgrade() -> None:
    op.drop_column("examinations", "special_lab_result")
