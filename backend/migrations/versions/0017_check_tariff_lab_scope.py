"""CHECK service tariffs are scoped by laboratory only (owner decision DR14).

The owner cancelled the product-species binding of the two CHECK services
(PRODUCT_IDENTIFICATION, TRANSPORT_INSPECTION): the «Платные услуги» directory
is bound to the laboratory only, and a price applies to reconciliations of
EVERY product species. VSE tariffs (all other service codes) legitimately keep
the laboratory + species scope and are not touched.

Upgrade:
- ``tariffs.product_species_id`` becomes nullable;
- the data-fix NULLs the species of the two CHECK service codes — this repairs
  the mis-scoped live rows (species wrongly equal to the laboratory UUID);
- HONEST DELETION of superseded duplicates: the previous constraint allowed a
  laboratory to hold CHECK tariffs under DIFFERENT species values; NULLing the
  species would make such rows identical keys and the unique index creation
  would abort mid-upgrade. BEFORE creating the index, within every
  (laboratory_id, service_code, unit_id) group that would collide, exactly one
  row SURVIVES — the newest (highest version, then rev, then id) — and the
  others are DELETED. This deletes duplicate rows of the SAME tariff scope
  (same laboratory, service, unit; superseded price entries), not business
  data; saved reconciliation snapshots are frozen and never re-read the
  deleted rows (ADR-020);
- the single unique constraint is replaced by TWO partial unique indexes:
  CHECK rows (species IS NULL) are unique by (laboratory, service code, unit),
  VSE rows (species set) keep the previous full key.

Downgrade restores the previous NOT NULL semantics honestly: it FAILS when a
CHECK row still carries a NULL species (an honest error, never a silent
rewrite of data), otherwise it drops the partial indexes, restores the NOT NULL
column and the original unique constraint.

Revision ID: 0017_check_tariff_lab_scope
Revises: 0016_reconciliation_pricing
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_check_tariff_lab_scope"
down_revision: str | Sequence[str] | None = "0016_reconciliation_pricing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHECK_CODES = ("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")


def upgrade() -> None:
    bind = op.get_bind()
    op.alter_column("tariffs", "product_species_id", existing_type=sa.UUID(), nullable=True)
    # The CHECK codes are the only rows whose species may be NULL; the data-fix
    # repairs the live mis-scoped CHECK rows (species == laboratory UUID).
    for code in CHECK_CODES:
        op.execute(
            sa.text("UPDATE tariffs SET product_species_id = NULL WHERE service_code = :code").bindparams(code=code)
        )
    # Safe resolution BEFORE the index: NULLing species can make previously
    # distinct (laboratory, species, code, unit) rows identical. In every
    # colliding group keep exactly ONE row — the newest (version DESC, rev
    # DESC, id DESC) — and delete the superseded duplicates of the same tariff
    # scope. Frozen reconciliation snapshots never re-read these rows, so no
    # saved price history becomes unreadable.
    deduplicated = bind.execute(
        sa.text(
            "WITH ranked AS ("
            "  SELECT id, row_number() OVER ("
            "    PARTITION BY laboratory_id, service_code, unit_id"
            "    ORDER BY version DESC, rev DESC, id DESC"
            "  ) AS position"
            "  FROM tariffs"
            "  WHERE product_species_id IS NULL"
            "    AND service_code IN ('PRODUCT_IDENTIFICATION','TRANSPORT_INSPECTION')"
            ")"
            "DELETE FROM tariffs"
            " WHERE id IN (SELECT id FROM ranked WHERE position > 1)"
            " RETURNING id"
        )
    ).fetchall()
    if deduplicated:
        print(f"0017: deleted {len(deduplicated)} superseded CHECK tariff duplicate(s)")
    op.drop_constraint("uq_tariff_scope_code_unit", "tariffs", type_="unique")
    # CHECK rows: laboratory + service code + unit, species is NULL by definition.
    op.create_index(
        "uq_tariff_lab_code_unit_check",
        "tariffs",
        ["laboratory_id", "service_code", "unit_id"],
        unique=True,
        postgresql_where=sa.text("product_species_id IS NULL"),
    )
    # VSE rows: the previous full pricing key (species is always set).
    op.create_index(
        "uq_tariff_lab_species_code_unit",
        "tariffs",
        ["laboratory_id", "product_species_id", "service_code", "unit_id"],
        unique=True,
        postgresql_where=sa.text("product_species_id IS NOT NULL"),
    )


def downgrade() -> None:
    # Honest failure: a NULL-species CHECK tariff cannot be represented under
    # the previous schema. The operator must resolve the row first — the
    # downgrade never silently deletes or rewrites pricing data.
    bind = op.get_bind()
    count = bind.execute(
        sa.text(
            "SELECT count(*) FROM tariffs "
            "WHERE product_species_id IS NULL "
            "AND service_code IN ('PRODUCT_IDENTIFICATION','TRANSPORT_INSPECTION')"
        )
    ).scalar_one()
    if count:
        raise RuntimeError(
            "downgrade 0017: найдены CHECK-тарифы без вида продукции "
            f"({count}); перенесите или удалите их перед откатом."
        )
    count = bind.execute(sa.text("SELECT count(*) FROM tariffs WHERE product_species_id IS NULL")).scalar_one()
    if count:
        raise RuntimeError(
            "downgrade 0017: найдены тарифы без вида продукции "
            f"({count}); перенесите или удалите их перед откатом."
        )
    op.drop_index("uq_tariff_lab_species_code_unit", table_name="tariffs")
    op.drop_index("uq_tariff_lab_code_unit_check", table_name="tariffs")
    op.alter_column("tariffs", "product_species_id", existing_type=sa.UUID(), nullable=False)
    op.create_unique_constraint(
        "uq_tariff_scope_code_unit",
        "tariffs",
        ["laboratory_id", "product_species_id", "service_code", "unit_id"],
    )
