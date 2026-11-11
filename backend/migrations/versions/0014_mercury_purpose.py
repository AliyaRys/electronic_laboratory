"""Local cargo-purpose dictionary (contour-scoped) + its sync checkpoint

The dictionary is seeded IDEMPOTENTLY from the versioned committed resource
``backend/resources/vetis/purpose_dictionary.json`` (151 records of the
GetPurposeList answer, WITHOUT the SOAP envelope or any credentials). The
migration never reads user-desktop files. The downgrade drops ONLY the new
dictionary structures — no user or legal data is touched.

Revision ID: 0014_mercury_purpose
Revises: 0013_vetis_receipts
Create Date: 2026-11-11
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from uuid import UUID

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_mercury_purpose"
down_revision: str | Sequence[str] | None = "0013_vetis_receipts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RESOURCE = Path(__file__).resolve().parents[2] / "resources" / "vetis" / "purpose_dictionary.json"


def _records() -> list[dict[str, object]]:
    """The 151 committed source records; a malformed resource fails the run."""
    raw = json.loads(_RESOURCE.read_text(encoding="utf-8"))
    records = raw.get("records")
    if not isinstance(records, list) or not records:
        raise RuntimeError("purpose_dictionary.json не содержит записей")
    return records  # type: ignore[no-any-return]


def _seed(connection: sa.Connection) -> None:
    """Idempotent upsert of the initial dictionary (contour of the resource)."""
    raw = json.loads(_RESOURCE.read_text(encoding="utf-8"))
    contour = str(raw.get("contour") or "PILOT")
    source = str(raw.get("source") or "purpose_dictionary.json")
    table = sa.table(
        "mercury_purpose_guid",
        sa.column("contour", sa.String),
        sa.column("guid", sa.UUID),
        sa.column("current_uuid", sa.UUID),
        sa.column("name", sa.String),
        sa.column("active", sa.Boolean),
        sa.column("is_last", sa.Boolean),
        sa.column("external_status", sa.Integer),
        sa.column("source_created_at", sa.DateTime(timezone=True)),
        sa.column("source_updated_at", sa.DateTime(timezone=True)),
        sa.column("previous_uuid", sa.UUID),
        sa.column("source", sa.String),
        sa.column("synchronized_at", sa.DateTime(timezone=True)),
    )
    for record in _records():
        guid = UUID(str(record["guid"]))
        current = UUID(str(record["uuid"]))
        name = str(record["name"] or "").strip()
        if not name:
            continue
        created = record.get("created_at")
        updated = record.get("updated_at")
        previous = record.get("previous")
        values = {
            "contour": contour,
            "guid": guid,
            "current_uuid": current,
            "name": name,
            "active": str(record.get("active") or "false").lower() == "true",
            "is_last": str(record.get("last") or "false").lower() == "true",
            "external_status": int(record.get("status") or 0),
            "source_created_at": datetime.fromisoformat(created) if created else None,
            "source_updated_at": datetime.fromisoformat(updated) if updated else None,
            "previous_uuid": UUID(str(previous)) if previous else None,
            "source": source,
            "synchronized_at": datetime.now().astimezone(),
        }
        connection.execute(
            postgresql.insert(table)
            .values(**values)
            .on_conflict_do_update(
                index_elements=["contour", "guid"],
                set_={
                    key: value
                    for key, value in values.items()
                    if key not in ("contour", "guid", "synchronized_at")
                },
            )
        )


def upgrade() -> None:
    op.create_table(
        "mercury_purpose_guid",
        sa.Column("contour", sa.String(16), nullable=False, primary_key=True),
        sa.Column("guid", sa.UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column("current_uuid", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("is_last", sa.Boolean(), nullable=False),
        sa.Column("external_status", sa.Integer(), nullable=False),
        sa.Column("source_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("previous_uuid", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(128), nullable=False),
        sa.Column(
            "synchronized_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="mercury_purpose_contour_valid"),
        sa.CheckConstraint("length(name) > 0", name="mercury_purpose_name_not_empty"),
        sa.UniqueConstraint("contour", "current_uuid", name="uq_mercury_purpose_contour_uuid"),
    )
    op.create_index("ix_mercury_purpose_contour_name", "mercury_purpose_guid", ["contour", "name"])
    op.create_table(
        "mercury_purpose_sync_state",
        sa.Column("contour", sa.String(16), nullable=False, primary_key=True),
        sa.Column("last_success", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failures", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("records", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("pages", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("problem_code", sa.String(128), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint(
            "contour IN ('PILOT','PRODUCTION')", name="mercury_purpose_sync_contour_valid"
        ),
        sa.CheckConstraint("failures >= 0", name="mercury_purpose_sync_failures_positive"),
    )
    _seed(op.get_bind())


def downgrade() -> None:
    # Only the new structures: no user, party, document or receipt data.
    op.drop_table("mercury_purpose_sync_state")
    op.drop_index("ix_mercury_purpose_contour_name", table_name="mercury_purpose_guid")
    op.drop_table("mercury_purpose_guid")
