"""DR48 §3.3: the 5-вет period becomes an arbitrary calendar range.

The report snapshot moves from ``year/half`` to inclusive ``date_from/date_to``.
The migration is non-destructive for the data:

- add ``date_from DATE`` and ``date_to DATE`` (nullable);
- backfill every existing snapshot without loss of meaning:
  ``half=1`` → ``YYYY-01-01 .. YYYY-06-30``, ``half=2`` → ``YYYY-07-01 .. YYYY-12-31``;
- make both columns NOT NULL;
- replace ``half_valid`` with ``date_from <= date_to``;
- replace the uniqueness with ``(report_type, laboratory_id, date_from, date_to)``;
- drop the legacy ``year`` and ``half`` columns.

The downgrade is honest (DR48 §3.3): the legacy schema can represent only
exact half-year ranges. A downgrade that meets an arbitrary range raises a
loud error BEFORE any destructive DDL instead of silently rounding dates.

Revision ID: 0023_report_date_ranges
Revises: 0022_journal_service_facts
Create Date: 2026-11-18
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_report_date_ranges"
down_revision: str | Sequence[str] | None = "0022_journal_service_facts"  # type: ignore[name-defined]
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _backfill_ranges(conn: sa.Connection) -> None:
    """The idempotent data backfill of the legacy year/half pairs."""
    conn.execute(
        sa.text(
            "UPDATE report_snapshots SET date_from = make_date(year, 1, 1), "
            "date_to = make_date(year, 6, 30) WHERE half = 1"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE report_snapshots SET date_from = make_date(year, 7, 1), "
            "date_to = make_date(year, 12, 31) WHERE half = 2"
        )
    )


def upgrade() -> None:
    conn = op.get_bind()
    op.add_column("report_snapshots", sa.Column("date_from", sa.Date(), nullable=True))
    op.add_column("report_snapshots", sa.Column("date_to", sa.Date(), nullable=True))
    _backfill_ranges(conn)
    op.alter_column("report_snapshots", "date_from", nullable=False)
    op.alter_column("report_snapshots", "date_to", nullable=False)
    op.drop_constraint("report_snapshot_half_valid", "report_snapshots", type_="check")
    op.create_check_constraint("report_snapshot_period_valid", "report_snapshots", "date_from <= date_to")
    op.drop_constraint("uq_report_snapshot_period", "report_snapshots", type_="unique")
    op.create_unique_constraint(
        "uq_report_snapshot_period",
        "report_snapshots",
        ["report_type", "laboratory_id", "date_from", "date_to"],
    )
    op.drop_column("report_snapshots", "year")
    op.drop_column("report_snapshots", "half")


def downgrade() -> None:
    conn = op.get_bind()
    # Honest downgrade first: an arbitrary range cannot be represented by the
    # legacy year/half schema without losing meaning — fail loudly BEFORE any
    # destructive DDL, never silently round dates.
    arbitrary = conn.execute(
        sa.text(
            "SELECT count(*) FROM report_snapshots "
            "WHERE NOT ((date_from = make_date(date_part('year', date_from)::int, 1, 1) "
            "AND date_to = make_date(date_part('year', date_from)::int, 6, 30)) "
            "OR (date_from = make_date(date_part('year', date_from)::int, 7, 1) "
            "AND date_to = make_date(date_part('year', date_from)::int, 12, 31)))"
        )
    ).scalar_one()
    if arbitrary:
        raise RuntimeError(
            f"Downgrade 0023 → 0022 невозможен: {arbitrary} сохранённых отчётов "
            "имеют произвольный период, который нельзя представить годом/полугодием."
        )
    op.add_column("report_snapshots", sa.Column("year", sa.Integer(), nullable=True))
    op.add_column("report_snapshots", sa.Column("half", sa.Integer(), nullable=True))
    conn.execute(
        sa.text(
            "UPDATE report_snapshots SET year = date_part('year', date_from)::int, "
            "half = CASE WHEN date_to = make_date(date_part('year', date_from)::int, 6, 30) THEN 1 ELSE 2 END"
        )
    )
    op.alter_column("report_snapshots", "year", nullable=False)
    op.alter_column("report_snapshots", "half", nullable=False)
    op.drop_constraint("uq_report_snapshot_period", "report_snapshots", type_="unique")
    op.create_unique_constraint(
        "uq_report_snapshot_period", "report_snapshots", ["report_type", "laboratory_id", "year", "half"]
    )
    op.drop_constraint("report_snapshot_period_valid", "report_snapshots", type_="check")
    op.create_check_constraint("report_snapshot_half_valid", "report_snapshots", "half IN (1, 2)")
    op.drop_column("report_snapshots", "date_from")
    op.drop_column("report_snapshots", "date_to")
