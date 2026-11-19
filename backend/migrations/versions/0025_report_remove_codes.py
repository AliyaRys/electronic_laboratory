"""DR51: the seven organizational codes (ОКУД…ОКФС) leave the report flow.

The owner decision of 2026-11-18 (product-design-records/
owner-decision-2026-11-18-5vet-full-section-iii.md) cancels the seven codes:
they are no longer entered, shown or exported, and the ``report_snapshots.codes``
column is removed. This is a deliberate removal of cancelled requisites —
the printed table lives in ``payload`` and existing reports keep opening and
exporting after this migration.

Downgrade restores the ``codes`` column as nullable JSONB with a ``{}`'
default, but the removed values are NOT recoverable (docstring contract of
the owner decision): a down-then-up cycle keeps reports openable while their
saved codes stay lost.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0025_report_remove_codes"
down_revision: str | None = "0024_report_classification_seed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("report_snapshots", "codes")


def downgrade() -> None:
    op.add_column(
        "report_snapshots",
        sa.Column("codes", JSONB(), nullable=True, server_default=sa.text("'{}'::jsonb")),
    )
