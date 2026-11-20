"""The unit reference names of the conclusion (fix-loop DR55).

``vetis_reference_names`` gains the ``UNIT`` entity kind: the VetIS unit
dictionary entry (``batch.unit``) whose readable name the printable
conclusion needs when the source snapshot carries ``batch.unit.name = null``.
The constraint is re-created non-destructively — only the check constraint is
dropped and re-added WITH ``'UNIT'``; no table, column or stored row is
touched and nothing is deleted.

``UNIT`` rows are keyed by the VetIS unit UUID (the
``GetUnitByUuidOperation`` key); the batch unit GUID is stored in the
``uuid`` column as the paired identity for the read-side matching.

Revision ID: 0027_unit_reference_names
Revises: 0026_report_remove_codes
Create Date: 2026-11-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_unit_reference_names"
down_revision: str | Sequence[str] | None = "0026_report_remove_codes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NEW_KIND_CHECK = "(entity_kind IN ('BUSINESS_ENTITY','ENTERPRISE','UNIT'))"
_OLD_KIND_CHECK = "(entity_kind IN ('BUSINESS_ENTITY','ENTERPRISE'))"


def _find_kind_check_constraint(bind: object) -> str | None:
    """The ACTUAL name of the kind check constraint in this database.

    The name historically varies with the applied naming convention (a bare
    ``vetis_reference_kind_valid`` or the ``ck_``-prefixed form); the migration
    never guesses it — it looks the constraint up in the catalogs by its
    table and expression and drops exactly what exists.
    """
    from sqlalchemy import text

    row = bind.execute(  # type: ignore[attr-defined]
        text(
            "SELECT conname FROM pg_constraint "
            "WHERE conrelid = 'vetis_reference_names'::regclass AND contype = 'c' "
            "AND pg_get_constraintdef(oid) LIKE '%entity_kind%'"
        )
    ).first()
    return str(row[0]) if row is not None else None


def upgrade() -> None:
    bind = op.get_bind()
    existing = _find_kind_check_constraint(bind)
    # Raw DDL: alembic's op.drop_constraint/create_check_constraint re-apply
    # the metadata naming convention to the given name (mangling it); the
    # constraint must be replaced under the EXACT name it actually has.
    if existing is not None:
        bind.execute(sa.text(f'ALTER TABLE vetis_reference_names DROP CONSTRAINT "{existing}"'))
    bind.execute(
        sa.text(f"ALTER TABLE vetis_reference_names ADD CONSTRAINT vetis_reference_kind_valid CHECK {_NEW_KIND_CHECK}")
    )


def downgrade() -> None:
    """The honest downgrade: the new kind stays queryable or refuses loudly."""
    bind = op.get_bind()
    existing_rows = bind.execute(
        sa.text("SELECT count(*) FROM vetis_reference_names WHERE entity_kind = 'UNIT'")
    ).scalar_one()
    if existing_rows:
        raise RuntimeError(
            "0027 downgrade refused: UNIT reference rows exist and would violate the old check "
            "constraint; remove the rows explicitly first (nothing is deleted automatically)."
        )
    existing = _find_kind_check_constraint(bind)
    if existing is not None:
        bind.execute(sa.text(f'ALTER TABLE vetis_reference_names DROP CONSTRAINT "{existing}"'))
    bind.execute(
        sa.text(f"ALTER TABLE vetis_reference_names ADD CONSTRAINT vetis_reference_kind_valid CHECK {_OLD_KIND_CHECK}")
    )
