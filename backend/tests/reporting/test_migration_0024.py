"""DR49 §2.5 migration 0024 tests on real PostgreSQL.

The tests drive the actual Alembic commands in a subprocess against a fresh
database inside the testcontainers instance: an empty installation is seeded
with exactly 28 rows of one canonical version, an installation with exactly
one operator version is left untouched, two versions stop the migration with
a diagnostic, and the downgrade removes only the seeded rows / stops before
the destructive DDL when unsupported rows exist.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION_ID = "0024_report_classification_seed"
CANONICAL_VERSION = "meat-mvp-2026-11-18"


def _alembic(url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["DATABASE_URL"] = url
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "-c", str(REPO_ROOT / "backend" / "alembic.ini"), *args],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


async def _fresh_db_url(pg_container, test_db_url: str, name: str) -> str:
    from sqlalchemy.ext.asyncio import create_async_engine

    admin = test_db_url.rsplit("/", 1)[0]
    engine = create_async_engine(admin, isolation_level="AUTOCOMMIT")
    async with engine.begin() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await conn.execute(text(f'CREATE DATABASE "{name}"'))
    await engine.dispose()
    return f"{admin}/{name}"


@pytest.fixture
async def state_db(pg_container, test_db_url: str):
    """A fresh database inside the testcontainer, cleaned up afterwards."""
    import uuid

    from sqlalchemy.ext.asyncio import create_async_engine

    name = f"dr49_m24_{uuid.uuid4().hex[:8]}"
    url = await _fresh_db_url(pg_container, test_db_url, name)
    result = _alembic(url, "upgrade", "0023_report_date_ranges")
    assert result.returncode == 0, result.stderr
    yield url
    engine = create_async_engine(test_db_url.rsplit("/", 1)[0], isolation_level="AUTOCOMMIT")
    async with engine.begin() as conn:
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    await engine.dispose()


def _sync_url(url: str) -> str:
    for prefix in ("postgresql+asyncpg://",):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def _versions(url: str) -> tuple[list[str], int]:
    import sqlalchemy

    engine = sqlalchemy.create_engine(_sync_url(url))
    with engine.connect() as conn:
        versions = list(
            conn.execute(
                text("SELECT DISTINCT version FROM report_classifications ORDER BY version")
            ).scalars()
        )
        count = conn.execute(text("SELECT count(*) FROM report_classifications")).scalar_one()
    engine.dispose()
    return versions, int(count)


def _seed_version(url: str, version: str, rows: int = 2) -> None:
    import sqlalchemy

    engine = sqlalchemy.create_engine(_sync_url(url))
    with engine.begin() as conn:
        for index in range(rows):
            conn.execute(
                text(
                    "INSERT INTO report_classifications (version, mercury_species_id, supported,"
                    " animal_column, material_kind) VALUES (:v, :s, true, 'CATTLE', 'MEAT')"
                ),
                {"v": version, "s": f"00000000-0000-0000-0000-{index:012d}"},
            )
    engine.dispose()


@pytest.mark.integration
async def test_upgrade_seeds_empty_installation_with_28_rows(state_db: str) -> None:
    result = _alembic(state_db, "upgrade", "head")
    assert result.returncode == 0, result.stderr
    versions, count = _versions(state_db)
    assert versions == [CANONICAL_VERSION]
    assert count == 28
    # Upgrade is idempotent on the state after the migration.
    again = _alembic(state_db, "upgrade", "head")
    assert again.returncode == 0, again.stderr
    versions_after, count_after = _versions(state_db)
    assert versions_after == [CANONICAL_VERSION] and count_after == 28


@pytest.mark.integration
async def test_upgrade_keeps_the_single_operator_version(state_db: str) -> None:
    _seed_version(state_db, "operator-1")
    result = _alembic(state_db, "upgrade", "head")
    assert result.returncode == 0, result.stderr
    versions, count = _versions(state_db)
    assert versions == ["operator-1"]
    assert count == 2


@pytest.mark.integration
async def test_upgrade_stops_on_two_versions_with_diagnostic(state_db: str) -> None:
    _seed_version(state_db, "legacy-1")
    _seed_version(state_db, "legacy-2")
    result = _alembic(state_db, "upgrade", "head")
    assert result.returncode != 0
    assert "несколько версий классификации" in result.stderr or "несколько версий классификации" in result.stdout
    versions, _count = _versions(state_db)
    assert set(versions) == {"legacy-1", "legacy-2"}


@pytest.mark.integration
async def test_downgrade_removes_only_seeded_rows(state_db: str) -> None:
    assert _alembic(state_db, "upgrade", "head").returncode == 0
    result = _alembic(state_db, "downgrade", "0023_report_date_ranges")
    assert result.returncode == 0, result.stderr
    versions, count = _versions(state_db)
    assert versions == [] and count == 0


@pytest.mark.integration
async def test_downgrade_stops_before_destructive_ddl_with_unsupported_rows(state_db: str) -> None:
    assert _alembic(state_db, "upgrade", "head").returncode == 0
    # A hand-written unsupported row (operator made it) blocks the downgrade.
    import sqlalchemy

    engine = sqlalchemy.create_engine(_sync_url(state_db))
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO report_classifications (version, mercury_species_id, supported) "
                "VALUES ('handmade', '11111111-1111-1111-1111-111111111111', false)"
            )
        )
    engine.dispose()
    result = _alembic(state_db, "downgrade", "0023_report_date_ranges")
    assert result.returncode != 0
    assert "Downgrade" in result.stderr or "Downgrade" in result.stdout
