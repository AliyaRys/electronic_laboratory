"""DR45 §6: the server owns the reconciliation service facts.

The confirmation (``confirm_receipt``) is the only owner of the CHECK
service facts; the client stopped sending ``services``. This migration
backfills the historical CONFIRMED reconciliations that were saved with an
empty services list (the old client contract): every reconciliation in
``state = 'CONFIRMED'`` with a ``completed_at`` gets the two performed facts
``{"code": ..., "performed": true}`` for PRODUCT_IDENTIFICATION and
TRANSPORT_INSPECTION — but only the codes that are NOT already stored.

Non-destructive and idempotent:
- a fact already stored by the reconciliation is never duplicated;
- a repeated run adds nothing;
- ``RETURNED`` rows are never enriched (a full return never performed a
  paid service automatically);
- the downgrade does NOT delete the backfilled facts (factual data is
  never lost); the JSONB column itself stays untouched by this migration.

Revision ID: 0022_journal_service_facts
Revises: 0020_dr35_specialist
Create Date: 2026-11-17
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_journal_service_facts"
down_revision: str | Sequence[str] | None = "0021_tariff_area_scope"  # type: ignore[name-defined]
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SERVICE_CODES = ("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")


def upgrade() -> None:
    backfill_service_facts(op.get_bind())


def backfill_service_facts(conn: sa.Connection) -> None:
    """The idempotent data backfill (re-exported for the offline tests)."""
    rows = conn.execute(
        sa.text(
            "SELECT id, services FROM reconciliations "
            "WHERE state = 'CONFIRMED' AND completed_at IS NOT NULL"
        )
    ).fetchall()
    for row_id, services in rows:
        stored = list(services) if isinstance(services, list) else []
        performed = {
            str(item.get("code"))
            for item in stored
            if isinstance(item, dict) and item.get("performed") is True
        }
        missing = [code for code in SERVICE_CODES if code not in performed]
        if not missing:
            continue  # idempotent: the facts are already frozen
        for code in missing:
            stored.append({"code": code, "performed": True})
        conn.execute(
            sa.text("UPDATE reconciliations SET services = :services WHERE id = :id"),
            {"services": json.dumps(stored), "id": row_id},
        )


def downgrade() -> None:
    # The backfilled facts are real performed-service data: they are never
    # deleted (O-07). The schema itself is unchanged by this migration.
    pass
