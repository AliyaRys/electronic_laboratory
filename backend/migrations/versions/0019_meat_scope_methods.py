"""Methods catalog scope = laboratory + product area (owner decision DR31).

The active norm of the «Нормы исследований» catalog is keyed by
``laboratory_id + product_area_code('meat') + indicator_id``. The Mercury
species/state GUID pair (``product_species_id``/``product_state_id``) is NO
LONGER part of the applicability key: one norm set per laboratory serves every
«Мясо и мясопродукты» position (ТЗ 2026-11-16-methods-catalog-single-meat-scope).

Upgrade (NON-DESTRUCTIVE, repeatable):
- ``product_area_code`` is added NOT NULL with the ``'meat'`` default;
- the legacy species/state columns become NULLABLE (audit-only from now on);
- within every group of OLD active rows of one (laboratory, indicator):
  * rules equivalent by schema, unit and norm value → ONE active meat-area
    row (the newest by version/rev/id) survives, the others are DEACTIVATED
    and keep their legacy scope for audit (nothing is deleted);
  * rules that DIFFER → no value is chosen arbitrarily: ALL rows of the group
    are deactivated for audit and the laboratory's norm for the indicator
    stays «Не настроено» (the user must enter it explicitly);
- the old 4-column partial unique index is replaced by the new
  (laboratory, product_area_code, indicator) partial unique index;
- parties, examinations, pricing snapshots, tariffs and Mercury dictionaries
  are never touched; saved snapshots are never recalculated.

Downgrade restores the previous NOT NULL species/state semantics honestly: it
FAILS while meat-area rows with a NULL species/state exist (an honest error,
never a silent data rewrite), otherwise it restores the old 4-column index.

Revision ID: 0019_meat_scope_methods
Revises: 0018_vetis_reference_names
Create Date: 2026-11-16
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_meat_scope_methods"
down_revision: str | Sequence[str] | None = "0018_vetis_reference_names"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _norm_signature(row: sa.Row) -> tuple[str, str, str]:
    """Equivalence of a norm by result schema, unit and rule value (§8.2-1).

    ``version`` and provenance do NOT take part: two revisions of the same
    norm are equivalent; a differing rule value is a conflict.
    """
    return (row.result_schema, row.unit_id, json.dumps(row.rule, sort_keys=True, ensure_ascii=False))


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column(
        "method_rules",
        sa.Column("product_area_code", sa.String(16), nullable=False, server_default=sa.text("'meat'")),
    )
    # Legacy scope columns become audit-only: nullable, never written as scope.
    op.alter_column("method_rules", "product_species_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("method_rules", "product_state_id", existing_type=sa.UUID(), nullable=True)

    # --- merge old active rows per (laboratory, indicator) ---------------------
    old_active = bind.execute(
        sa.text(
            "SELECT id, laboratory_id, indicator_id, product_species_id, product_state_id,"
            " result_schema, unit_id, rule"
            " FROM method_rules WHERE active ORDER BY laboratory_id, indicator_id, version DESC, id DESC"
        )
    ).fetchall()

    groups: dict[tuple[object, object], list[sa.Row]] = {}
    for row in old_active:
        groups.setdefault((row.laboratory_id, row.indicator_id), []).append(row)

    merged_equivalent = 0
    conflicting_groups = 0
    to_fill = 0
    for (_laboratory_id, _indicator_id), rows in groups.items():
        signatures = {_norm_signature(row) for row in rows}
        if len(signatures) == 1:
            # Equivalent norms: keep the NEWEST row active (the group is
            # ordered newest-first), deactivate the rest — history preserved.
            for row in rows[1:]:
                bind.execute(
                    sa.text("UPDATE method_rules SET active = false WHERE id = :id").bindparams(id=row.id)
                )
                merged_equivalent += 1
            # The surviving row drops the legacy scope values: they are no
            # longer part of the applicability key of this norm.
            bind.execute(
                sa.text(
                    "UPDATE method_rules SET product_species_id = NULL, product_state_id = NULL"
                    " WHERE id = :id"
                ).bindparams(id=rows[0].id)
            )
        else:
            # Differing norms: NEVER pick one arbitrarily. Everything goes to
            # audit (deactivated, legacy scope kept) and the indicator stays
            # «Не настроено» until the user enters the norm explicitly.
            for row in rows:
                bind.execute(
                    sa.text("UPDATE method_rules SET active = false WHERE id = :id").bindparams(id=row.id)
                )
            conflicting_groups += 1
            to_fill += 1
    if merged_equivalent or conflicting_groups or to_fill:
        print(
            "0019: merged equivalent norms: "
            f"{merged_equivalent}; conflicting groups: {conflicting_groups}; to fill: {to_fill}"
        )

    # --- the new partial unique index of the active norm -----------------------
    op.drop_index("uq_method_rule_active", table_name="method_rules")
    op.drop_index("ix_method_rules_scope", table_name="method_rules")
    op.create_index(
        "uq_method_rule_active",
        "method_rules",
        ["laboratory_id", "product_area_code", "indicator_id"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.create_index(
        "ix_method_rules_scope",
        "method_rules",
        ["laboratory_id", "product_area_code", "indicator_id"],
    )


def downgrade() -> None:
    """Restore the species/state key honestly: fail while a meat-area row has
    no legacy scope values (they were merged away by the upgrade and cannot be
    reconstructed without inventing data)."""
    bind = op.get_bind()
    count = bind.execute(
        sa.text("SELECT count(*) FROM method_rules WHERE product_species_id IS NULL")
    ).scalar_one()
    if count:
        raise RuntimeError(
            "downgrade 0019: найдены активные нормы без вида/состояния продукции "
            f"({count}); переназначьте или деактивируйте их перед откатом."
        )
    op.drop_index("ix_method_rules_scope", table_name="method_rules")
    op.drop_index("uq_method_rule_active", table_name="method_rules")
    op.create_index(
        "uq_method_rule_active",
        "method_rules",
        ["laboratory_id", "product_species_id", "product_state_id", "indicator_id"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.create_index(
        "ix_method_rules_scope",
        "method_rules",
        ["laboratory_id", "product_species_id", "indicator_id"],
    )
    op.alter_column("method_rules", "product_state_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("method_rules", "product_species_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("method_rules", "product_area_code")
