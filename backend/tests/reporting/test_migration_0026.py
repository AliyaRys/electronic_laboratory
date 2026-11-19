"""Migration 0026: report_snapshots.codes is dropped (DR51 §6.2).

The seven organizational codes are cancelled by the owner decision of
2026-11-18: the upgrade drops the column without touching ``payload`` (the
printed table lives there, so existing reports keep opening and exporting),
and the downgrade restores a nullable ``codes`` column that deliberately does
NOT restore the removed values. Runs on the real PostgreSQL.
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
    cursor.execute("INSERT INTO territories (id, name) VALUES (%s, %s)", (str(uuid.uuid4()), "Территория"))
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


def _codes_column(cursor: psycopg.Cursor) -> bool:
    cursor.execute(
        "SELECT count(*) FROM information_schema.columns"
        " WHERE table_name = 'report_snapshots' AND column_name = 'codes'"
    )
    return cursor.fetchone()[0] == 1


@pytest.mark.integration
def test_0026_drops_codes_keeps_payload_and_opens_reports(test_db_url: str) -> None:
    down = _alembic(test_db_url, "downgrade", "0024_report_classification_seed")
    assert down.returncode == 0, down.stdout + down.stderr
    laboratory = actor = snapshot_id = None
    try:
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            laboratory, actor = _seed_actor(cursor)
            snapshot_id = uuid.uuid4()
            # A populated legacy snapshot with the full payload.
            cursor.execute(
                "INSERT INTO report_snapshots (id, report_type, laboratory_id, date_from, date_to,"
                " payload, codes, source_count, preview_generated_at, saved_at, saved_by, key_id,"
                " signature, rev)"
                " VALUES (%s, '5VET_SECTION_III', %s, DATE '2026-01-01', DATE '2026-06-30', %s, %s,"
                " 1, now(), now(), %s, 'k', 's', 1)",
                (
                    str(snapshot_id),
                    str(laboratory),
                    '{"row_codes": ["166"], "matrix": [["1", null, null, null, null, null, null, null]]}',
                    '{"okud": "001"}',
                    str(actor),
                ),
            )
            connection.commit()
            assert _codes_column(cursor) is True

        up = _alembic(test_db_url, "upgrade", "head")
        assert up.returncode == 0, up.stdout + down.stderr

        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            assert _codes_column(cursor) is False
            # The payload (the printed table) is untouched: the report opens.
            cursor.execute("SELECT payload FROM report_snapshots WHERE id = %s", (str(snapshot_id),))
            payload = cursor.fetchone()[0]
            assert payload["row_codes"] == ["166"]

        # The downgrade restores the nullable column without the values.
        back = _alembic(test_db_url, "downgrade", "0024_report_classification_seed")
        assert back.returncode == 0, back.stdout + back.stderr
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            assert _codes_column(cursor) is True
            cursor.execute("SELECT codes FROM report_snapshots WHERE id = %s", (str(snapshot_id),))
            assert cursor.fetchone()[0] in (None, {})
    finally:
        restored = _alembic(test_db_url, "upgrade", "head")
        assert restored.returncode == 0, restored.stdout + restored.stderr
