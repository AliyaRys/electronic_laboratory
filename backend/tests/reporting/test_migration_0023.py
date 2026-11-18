"""Migration 0023: the 5-вет period year/half → arbitrary date range (DR48).

The upgrade backfills every legacy snapshot without loss of meaning
(``half=1`` → ``01-01..06-30``, ``half=2`` → ``07-01..12-31``), enforces
``date_from <= date_to`` and the new uniqueness, and drops the legacy
columns. The downgrade restores ``year/half`` ONLY for exact half-year
ranges and fails loudly before any destructive DDL for an arbitrary range.
This test runs the real migration on a real PostgreSQL (ADR-001).
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]


def _alembic(test_db_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "-c", str(REPO_ROOT / "backend" / "alembic.ini"), *args],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


def _sync_url(test_db_url: str) -> str:
    return test_db_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _seed_actor(cursor: psycopg.Cursor) -> tuple[uuid.UUID, uuid.UUID]:
    user_id = uuid.uuid4()
    laboratory_id = uuid.uuid4()
    cursor.execute(
        "INSERT INTO territories (id, name) VALUES (%s, %s)",
        (str(uuid.uuid4()), "Территория"),
    )
    cursor.execute(
        "INSERT INTO laboratories (id, territory_id, name, address, organization) VALUES (%s, %s, %s, %s, %s)",
        (
            str(laboratory_id),
            cursor.execute("SELECT id FROM territories ORDER BY name DESC LIMIT 1").fetchone()[0],
            "Лаборатория",
            "Адрес",
            "Организация",
        ),
    )
    cursor.execute(
        "INSERT INTO users (id, login, full_name, email, password_hash, role, active)"
        " VALUES (%s, %s, %s, %s, %s, 'HEAD', true)",
        (str(user_id), f"head-{user_id}", "Руководитель", f"{user_id}@example.test", "x" * 60),
    )
    return laboratory_id, user_id


def _insert_legacy_snapshot(
    cursor: psycopg.Cursor, laboratory: uuid.UUID, actor: uuid.UUID, year: int, half: int, report_type: str
) -> uuid.UUID:
    snapshot_id = uuid.uuid4()
    cursor.execute(
        "INSERT INTO report_snapshots (id, report_type, laboratory_id, year, half, payload, codes,"
        " source_count, preview_generated_at, saved_at, saved_by, key_id, signature, rev)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s, 1, now(), now(), %s, 'k', 's', 1)",
        (
            str(snapshot_id),
            report_type,
            str(laboratory),
            year,
            half,
            "{}",
            "{}",
            str(actor),
        ),
    )
    return snapshot_id


@pytest.mark.integration
def test_0023_backfills_half_years_and_drops_legacy_columns(test_db_url: str) -> None:
    down = _alembic(test_db_url, "downgrade", "0022_journal_service_facts")
    assert down.returncode == 0, down.stdout + down.stderr
    laboratory = actor = None
    legacy: list[uuid.UUID] = []
    try:
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            laboratory, actor = _seed_actor(cursor)
            first = _insert_legacy_snapshot(cursor, laboratory, actor, 2026, 1, "5VET_SECTION_III")
            second = _insert_legacy_snapshot(cursor, laboratory, actor, 2026, 2, "5VET_SECTION_III")
            other = _insert_legacy_snapshot(cursor, laboratory, actor, 2026, 2, "OTHER_KIND")
            connection.commit()
            legacy = [first, second, other]

        up = _alembic(test_db_url, "upgrade", "head")
        assert up.returncode == 0, up.stdout + up.stderr

        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT date_from, date_to FROM report_snapshots WHERE id = %s", (str(legacy[0]),))
            row = cursor.fetchone()
            assert (row[0].isoformat(), row[1].isoformat()) == ("2026-01-01", "2026-06-30")
            cursor.execute("SELECT date_from, date_to FROM report_snapshots WHERE id = %s", (str(legacy[1]),))
            row = cursor.fetchone()
            assert (row[0].isoformat(), row[1].isoformat()) == ("2026-07-01", "2026-12-31")
            cursor.execute(
                "SELECT column_name FROM information_schema.columns"
                " WHERE table_name = 'report_snapshots' AND column_name IN ('year', 'half')"
            )
            assert cursor.fetchall() == []  # the legacy columns are gone
            # An arbitrary range (November 2026) is storable at head.
            cursor.execute(
                "INSERT INTO report_snapshots (id, report_type, laboratory_id, date_from, date_to,"
                " payload, codes, source_count, preview_generated_at, saved_at, saved_by, key_id,"
                " signature, rev)"
                " VALUES (%s, '5VET_SECTION_III', %s, DATE '2026-11-01', DATE '2026-11-18', '{}', '{}',"
                " 0, now(), now(), %s, 'k', 's', 1)",
                (str(uuid.uuid4()), str(laboratory), str(actor)),
            )
            connection.commit()

        # The downgrade refuses an arbitrary range BEFORE destructive DDL.
        down2 = _alembic(test_db_url, "downgrade", "0022_journal_service_facts")
        assert down2.returncode != 0
        assert "произвольный период" in (down2.stdout + down2.stderr)
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM report_snapshots WHERE date_from = DATE '2026-11-01'")
            assert cursor.fetchone()[0] == 1  # nothing was destroyed
    finally:
        restored = _alembic(test_db_url, "upgrade", "head")
        assert restored.returncode == 0, restored.stdout + restored.stderr


@pytest.mark.integration
def test_0023_downgrade_restores_exact_half_years(test_db_url: str) -> None:
    down = _alembic(test_db_url, "downgrade", "0022_journal_service_facts")
    assert down.returncode == 0, down.stdout + down.stderr
    try:
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            laboratory, actor = _seed_actor(cursor)
            _insert_legacy_snapshot(cursor, laboratory, actor, 2025, 2, "5VET_SECTION_III")
            connection.commit()

        _alembic(test_db_url, "upgrade", "head")
        back = _alembic(test_db_url, "downgrade", "0022_journal_service_facts")
        assert back.returncode == 0, back.stdout + back.stderr
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT year, half FROM report_snapshots")
            assert cursor.fetchall() == [(2025, 2)]
    finally:
        restored = _alembic(test_db_url, "upgrade", "head")
        assert restored.returncode == 0, restored.stdout + restored.stderr
