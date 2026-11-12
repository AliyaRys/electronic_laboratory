"""Source-presence freshness of incoming eVSDs (ТЗ DR9 §4/§5)

The read model gains the freshness state ``source_presence``
(CURRENT_CONFIRMED / NOT_IN_CURRENT_CONFIRMED_LIST / UNKNOWN), the reason of
the last change, the last successful sync that observed the document and the
sync at which it stopped being observed. Existing rows are backfilled as
``CURRENT_CONFIRMED`` — they entered the read model through the full
INCOMING+CONFIRMED pass, so the confirmation list DID observe them at
``fetched_at``. Nothing is deleted; the downgrade drops ONLY the new columns.

Revision ID: 0015_source_presence
Revises: 0014_mercury_purpose
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_source_presence"
down_revision: str | Sequence[str] | None = "0014_mercury_purpose"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "incoming_documents",
        sa.Column("source_presence", sa.String(32), nullable=False, server_default="UNKNOWN"),
    )
    op.add_column("incoming_documents", sa.Column("source_presence_reason", sa.String(64)))
    op.add_column("incoming_documents", sa.Column("last_seen_sync_at", sa.DateTime(timezone=True)))
    op.add_column("incoming_documents", sa.Column("presence_changed_at", sa.DateTime(timezone=True)))
    op.create_check_constraint(
        "incoming_source_presence_valid",
        "incoming_documents",
        "source_presence IN ('CURRENT_CONFIRMED','NOT_IN_CURRENT_CONFIRMED_LIST','UNKNOWN')",
    )
    # Honest backfill: every existing row was imported from the confirmed
    # external list of its full pass; the import fetch is its last observation.
    op.execute(
        "UPDATE incoming_documents "
        "SET source_presence = 'CURRENT_CONFIRMED', last_seen_sync_at = fetched_at "
        "WHERE source_presence = 'UNKNOWN'"
    )
    op.create_index(
        "ix_incoming_presence",
        "incoming_documents",
        ["laboratory_id", "contour", "source_presence"],
    )


def downgrade() -> None:
    op.drop_index("ix_incoming_presence", table_name="incoming_documents")
    op.drop_constraint("incoming_source_presence_valid", "incoming_documents", type_="check")
    op.drop_column("incoming_documents", "presence_changed_at")
    op.drop_column("incoming_documents", "last_seen_sync_at")
    op.drop_column("incoming_documents", "source_presence_reason")
    op.drop_column("incoming_documents", "source_presence")
