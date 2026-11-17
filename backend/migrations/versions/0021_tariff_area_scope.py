"""VSE tariffs scope = laboratory + product area (owner decision DR43).

Owner ruling 2026-11-17: «Стоимость одна на всю категорию "Мясо и мясопродукты",
не надо делать фильтр» — the VSE tariff scope is now
``laboratory_id + product_area_code('meat') + service_code + unit_id``, exactly
like the DR31 meat norms. The species is NO LONGER part of the pricing key and
the party's species never enters the tariff lookup.

Upgrade (NON-DESTRUCTIVE, runs under the deploy/migrate_lock.py wrapper):

- ``tariffs.product_area_code`` is added NULLABLE (NULL = CHECK or legacy
  species scope, 'meat' = the new area scope);
- ``bulk_price_jobs.product_species_id`` becomes NULLABLE (the bulk echo of the
  superseded species scope; the applied tariff is always the area row);
- within every (laboratory_id, service_code, unit_id) group of VSE rows
  (species set) exactly ONE row — the NEWEST by (version, rev, id) — is
  converted to the area scope (``product_area_code = 'meat'``); its species
  value is KEPT as audit data and never used again. Nothing is deleted:
  the other rows of the group keep their species scope and become audit-only
  legacy rows that pricing never reads. This includes the historical
  mis-scoped rows whose ``product_species_id`` held the laboratory UUID: when
  such a row is the group's newest, it is the row converted (the owner's
  explicit interpretation: the old contract meant «one tariff for the area»);
- the new partial unique index encodes one area row per pricing key.

Saved pricing snapshots are never recalculated (ADR-020); CHECK tariffs,
norms, parties and examinations are never touched.

Downgrade: drops the column; it FAILS honestly while an area-scoped row has a
NULL species (a row created by the new code cannot be represented under the
species contract), otherwise it restores the previous schema.

Revision ID: 0021_tariff_area_scope
Revises: 0020_exam_specialist_form_snapshot
Create Date: 2026-11-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_tariff_area_scope"
down_revision: str | Sequence[str] | None = "0020_dr35_specialist"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MEAT_AREA = "meat"


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column("tariffs", sa.Column("product_area_code", sa.String(16), nullable=True))
    op.alter_column("bulk_price_jobs", "product_species_id", existing_type=sa.UUID(), nullable=True)

    # Group resolution BEFORE the unique index: in every VSE pricing key group
    # the NEWEST row becomes the area row; the rest stay untouched legacy rows
    # (species kept, never read by pricing, never deleted).
    converted = bind.execute(
        sa.text(
            "WITH ranked AS ("
            "  SELECT id, row_number() OVER ("
            "    PARTITION BY laboratory_id, service_code, unit_id"
            "    ORDER BY version DESC, rev DESC, id DESC"
            "  ) AS position"
            "  FROM tariffs"
            "  WHERE product_species_id IS NOT NULL"
            "    AND service_code NOT IN ('PRODUCT_IDENTIFICATION','TRANSPORT_INSPECTION')"
            ")"
            "UPDATE tariffs SET product_area_code = :area"
            " WHERE id IN (SELECT id FROM ranked WHERE position = 1)"
            " RETURNING id"
        ).bindparams(area=MEAT_AREA)
    ).fetchall()
    print(f"0021: converted {len(converted)} VSE tariff row(s) to the meat-area scope")

    op.create_index(
        "uq_tariff_lab_area_code_unit",
        "tariffs",
        ["laboratory_id", "service_code", "unit_id"],
        unique=True,
        postgresql_where=sa.text("product_area_code IS NOT NULL"),
    )
    op.create_index(
        "ix_tariffs_area",
        "tariffs",
        ["laboratory_id", "product_area_code", "service_code"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    count = bind.execute(
        sa.text("SELECT count(*) FROM tariffs WHERE product_area_code IS NOT NULL AND product_species_id IS NULL")
    ).scalar_one()
    if count:
        raise RuntimeError(
            "downgrade 0021: найдены тарифы области без вида продукции "
            f"({count}); перенесите или удалите их перед откатом."
        )
    op.drop_index("ix_tariffs_area", table_name="tariffs")
    op.drop_index("uq_tariff_lab_area_code_unit", table_name="tariffs")
    op.drop_column("tariffs", "product_area_code")
    op.alter_column("bulk_price_jobs", "product_species_id", existing_type=sa.UUID(), nullable=False)
