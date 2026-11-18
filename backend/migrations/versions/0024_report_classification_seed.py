"""DR49 §2.5: the canonical 5-вет classification seed and nullable mapping.

The product classification becomes honest about ambiguity:

- ``animal_column`` and ``material_kind`` become NULLABLE;
- a new check enforces the shape: a supported row requires BOTH values,
  an unsupported row requires BOTH NULL;
- an installation with ZERO classification versions is seeded with exactly
  28 rows of the canonical version ``meat-mvp-2026-11-18`` (22 supported
  meat/offal rows + 6 explicitly unsupported ambiguous rows);
- an installation with EXACTLY ONE version is left untouched — the operator
  configuration is never overwritten by a migration;
- an installation with MORE THAN ONE version stops the migration with a
  loud diagnostic listing the versions — no «latest» is ever picked.

The downgrade removes only the rows the upgrade seeded (when it seeded) and
restores the old NOT NULL constraints only when no nullable (unsupported)
rows exist — otherwise it stops BEFORE the destructive DDL.

Revision ID: 0024_report_classification_seed
Revises: 0023_report_date_ranges
Create Date: 2026-11-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_report_classification_seed"
down_revision: str | Sequence[str] | None = "0023_report_date_ranges"  # type: ignore[name-defined]
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CANONICAL_VERSION = "meat-mvp-2026-11-18"

# (mercury_species_id, supported, animal_column, material_kind). The Russian
# names live in the spec/tests as explanations only — the runtime key is the
# stable Mercury second-level GUID.
CANONICAL_ROWS: tuple[tuple[str, bool, str | None, str | None], ...] = (
    # --- 22 supported rows ---------------------------------------------------
    ("74269863-8169-ca83-e48e-37fc80e8c0a9", True, "SHEEP_GOAT", "MEAT"),
    ("e84f3cb2-0fd9-403e-8abf-9a2c7f1aa71f", True, "CATTLE", "MEAT"),
    ("362aa885-9b9f-ae95-05d0-f9570f4fbdc6", True, "CATTLE", "MEAT"),
    ("13581a3b-c7c0-915e-62eb-fa9fc897573b", True, "SHEEP_GOAT", "MEAT"),
    ("64930556-cbb2-13db-bcdc-572eb188e45e", True, "OTHER_ANIMALS", "MEAT"),
    ("15a3d1e7-36d7-4749-b27f-568de76f612e", True, "OTHER_ANIMALS", "MEAT"),
    ("ae99803f-c580-5b1d-80ce-a5139f74d71c", True, "OTHER_ANIMALS", "MEAT"),
    ("207e346e-5a62-4396-b696-d154ad3bded9", True, "OTHER_BIRDS", "MEAT"),
    ("eab73d6b-b24d-5164-1c45-f9a39c2db9c7", True, "OTHER_ANIMALS", "MEAT"),
    ("cbd9f7c4-4033-75e2-d187-ee21a2a10246", True, "OTHER_ANIMALS", "MEAT"),
    ("ce9828e8-1b07-f094-8eb9-8b450994153d", True, "RABBIT_NUTRIA", "MEAT"),
    ("527a0f5a-e880-e3ca-d41f-65aa63cc6313", True, "OTHER_ANIMALS", "MEAT"),
    ("1e648587-4cb3-4369-8d1b-bbd200506164", True, "RABBIT_NUTRIA", "MEAT"),
    ("e302358c-258a-93a4-3eb5-4385b30ff1d2", True, "OTHER_ANIMALS", "MEAT"),
    ("62160578-dc4d-1934-b6bc-5dfa7a2ad4d1", True, "OTHER_ANIMALS", "MEAT"),
    ("57a674fd-ca2b-c523-6853-72d27b4ae32c", True, "PIG", "MEAT"),
    ("f97d8683-89d2-d7f7-5015-cdeaab4be98f", True, "CATTLE", "OFFAL"),
    ("16d9f824-a5f3-6837-3073-e54c4ed5d74d", True, "OTHER_ANIMALS", "OFFAL"),
    ("40dd45d4-75aa-b984-4fdb-291f84afad03", True, "PIG", "OFFAL"),
    ("0afdd23b-6fbb-ce96-669f-b0922b9efb85", True, "SHEEP_GOAT", "OFFAL"),
    ("39157e2a-457a-f275-4bdb-c927f640be01", True, "SHEEP_GOAT", "OFFAL"),
    ("ada4ca0a-1698-27c2-fbb6-64c158b74677", True, "CATTLE", "MEAT"),
    # --- 6 explicitly unsupported ambiguous rows -----------------------------
    ("2482379d-fd70-d125-cd74-030244f62d28", False, None, None),
    ("337f79dc-4376-6e33-dabe-d5447913b97d", False, None, None),
    ("bd1bb8ca-6e18-4062-8e7c-32b95b1b1354", False, None, None),
    ("9351133c-b114-9cb1-3cdd-84a89c1b9138", False, None, None),
    ("d7a44d7a-1863-dbff-2581-c03fae1ab447", False, None, None),
    ("2f055312-2167-4716-bb95-d541ca9cb54a", False, None, None),
)


def _versions(conn: sa.Connection) -> list[str]:
    return list(conn.execute(sa.text("SELECT DISTINCT version FROM report_classifications")).scalars())


def upgrade() -> None:
    conn = op.get_bind()
    # 1. Relax the columns before any seed: unsupported rows carry NULLs.
    op.alter_column("report_classifications", "animal_column", existing_type=sa.String(32), nullable=True)
    op.alter_column("report_classifications", "material_kind", existing_type=sa.String(16), nullable=True)
    if _has_constraint(conn, "report_classifications", "classification_mapping_shape"):
        op.drop_constraint("classification_mapping_shape", "report_classifications", type_="check")
    op.create_check_constraint(
        "classification_mapping_shape",
        "report_classifications",
        "(supported AND animal_column IS NOT NULL AND material_kind IS NOT NULL) "
        "OR (NOT supported AND animal_column IS NULL AND material_kind IS NULL)",
    )

    # 2. The version gate: seed only a truly empty installation.
    versions = _versions(conn)
    if len(versions) > 1:
        listing = ", ".join(sorted(versions))
        raise RuntimeError(
            "Миграция 0024 остановлена: обнаружено несколько версий классификации "
            f"({listing}); требуется ручное исправление конфигурации отчёта."
        )
    if not versions:
        for species_id, supported, column, kind in CANONICAL_ROWS:
            conn.execute(
                sa.text(
                    "INSERT INTO report_classifications "
                    "(version, mercury_species_id, product_type_id, product_state_id, "
                    "supported, animal_column, material_kind) "
                    "VALUES (:version, :species, '1', NULL, :supported, :column, :kind)"
                ).bindparams(
                    version=CANONICAL_VERSION,
                    species=species_id,
                    supported=supported,
                    column=column,
                    kind=kind,
                )
            )


def _has_constraint(conn: sa.Connection, table: str, name: str) -> bool:
    row = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.table_constraints "
            "WHERE table_name = :table AND constraint_name = :name"
        ).bindparams(table=table, name=name)
    ).first()
    return row is not None


def downgrade() -> None:
    conn = op.get_bind()
    existing = _versions(conn)
    seeded = existing == [CANONICAL_VERSION] and (
        conn.execute(
            sa.text("SELECT count(*) FROM report_classifications WHERE version = :v").bindparams(v=CANONICAL_VERSION)
        ).scalar_one()
        == len(CANONICAL_ROWS)
        and conn.execute(
            sa.text(
                "SELECT count(*) FROM report_classifications "
                "WHERE version = :v AND NOT supported AND animal_column IS NULL"
            ).bindparams(v=CANONICAL_VERSION)
        ).scalar_one()
        == 6
    )
    if seeded:
        # Only the rows the upgrade created are removed by the downgrade.
        conn.execute(
            sa.text("DELETE FROM report_classifications WHERE version = :v").bindparams(v=CANONICAL_VERSION)
        )
    unsupported = conn.execute(
        sa.text("SELECT count(*) FROM report_classifications WHERE NOT supported OR animal_column IS NULL")
    ).scalar_one()
    if unsupported:
        raise RuntimeError(
            f"Downgrade 0024 → 0023 невозможен: {unsupported} строк классификации без "
            "animal_column/material_kind; старая схема NOT NULL не может их хранить."
        )
    op.drop_constraint("classification_mapping_shape", "report_classifications", type_="check")
    op.alter_column("report_classifications", "animal_column", existing_type=sa.String(32), nullable=False)
    op.alter_column("report_classifications", "material_kind", existing_type=sa.String(16), nullable=False)
