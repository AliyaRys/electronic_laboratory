"""Migration 0021: the DR43 area-scope conversion of the VSE tariff rows.

The old species scope allowed one laboratory to hold VSE tariffs under
DIFFERENT species values (and the historical mis-scoped rows with the
laboratory UUID as the species). The upgrade converts EXACTLY ONE row per
(laboratory, code, unit) group — the NEWEST (version, rev, id) — to the meat
area, keeps the species values of ALL rows as audit data, deletes nothing and
leaves the CHECK tariffs untouched. This test reproduces the variety at
revision 0020, runs the real migration and asserts the survivor prices.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.src.core.commands import UnitOfWork
from backend.src.modules.catalog_pricing.schemas import PricingRequest
from backend.src.modules.catalog_pricing.service import evaluate_and_price

REPO_ROOT = Path(__file__).resolve().parents[3]
NEWEST_PRICE = "250.00"


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


def _insert_vse_tariff(
    cursor: psycopg.Cursor, laboratory: uuid.UUID, species: uuid.UUID, code: uuid.UUID, version: int
) -> None:
    cursor.execute(
        "INSERT INTO tariffs (laboratory_id, product_species_id, service_code, unit_id, price, version, source)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            str(laboratory),
            str(species),
            str(code),
            "RUB",
            "100.00" if version == 1 else NEWEST_PRICE if version == 5 else "150.00",
            version,
            '{"name": "прейскурант"}',
        ),
    )


def test_check_codes_sql_is_generated_from_the_canonical_set() -> None:
    """The 0021 SQL literals are generated from CHECK_SERVICE_CODES: the exact
    two CHECK codes and nothing else may enter the SQL IN-list."""
    import importlib.util  # noqa: PLC0415
    import re  # noqa: PLC0415

    spec = importlib.util.spec_from_file_location(
        "m0021_tariff_area_scope",
        REPO_ROOT / "backend" / "migrations" / "versions" / "0021_tariff_area_scope.py",
    )
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    literals = re.findall(r"'([A-Z_]+)'", migration.CHECK_CODES_SQL)
    assert set(literals) == set(migration.CHECK_SERVICE_CODES)
    assert sorted(migration.CHECK_SERVICE_CODES) == ["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"]


@pytest.mark.integration
def test_0021_converts_the_newest_vse_row_per_group(test_db_url: str) -> None:
    laboratory = uuid.uuid4()
    microscopy = uuid.uuid4()

    downgraded = _alembic(test_db_url, "downgrade", "0020_dr35_specialist")
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
    try:
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            # Three microscopy tariffs of ONE laboratory under different
            # species (the DR14/DR42 species contract); the newest (version 5)
            # must become the area row. One of the rows is the historical
            # mis-scoped kind: species == laboratory UUID.
            _insert_vse_tariff(cursor, laboratory, uuid.uuid4(), microscopy, 1)
            _insert_vse_tariff(cursor, laboratory, laboratory, microscopy, 5)
            _insert_vse_tariff(cursor, laboratory, uuid.uuid4(), microscopy, 3)
            # The pricing needs an active meat-area norm of the indicator.
            cursor.execute(
                "INSERT INTO method_rules (laboratory_id, product_area_code, indicator_id, version,"
                " result_schema, unit_id, rule, source, active)"
                " VALUES (%s, 'meat', %s, 1, 'DECIMAL', 'RUB', %s, %s, true)",
                (
                    str(laboratory),
                    str(microscopy),
                    '{"type": "interval", "lower": "0", "upper": "100"}',
                    '{"name": "методика"}',
                ),
            )
            # An untouched CHECK row of the same laboratory keeps its scope.
            cursor.execute(
                "INSERT INTO tariffs (laboratory_id, product_species_id, service_code,"
                " unit_id, price, version, source)"
                " VALUES (%s, NULL, 'PRODUCT_IDENTIFICATION', 'RUB', 70.00, 1, %s)",
                (str(laboratory), '{"name": "прейскурант"}'),
            )
            connection.commit()

        upgraded = _alembic(test_db_url, "upgrade", "head")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr

        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT product_area_code, product_species_id, price FROM tariffs"
                " WHERE laboratory_id = %s AND service_code = %s AND unit_id = 'RUB'"
                " ORDER BY version DESC",
                (str(laboratory), str(microscopy)),
            )
            microscopy_rows = cursor.fetchall()
            assert len(microscopy_rows) == 3  # nothing is deleted
            area_rows = [row for row in microscopy_rows if row[0] == "meat"]
            assert len(area_rows) == 1  # exactly one area row per group
            assert area_rows[0][1] == laboratory  # the mis-scoped row was the newest: it was converted
            assert area_rows[0][2] == pytest.approx(250.00)  # the NEWEST price
            # The other rows keep their species audit data and no area value.
            for row in microscopy_rows:
                if row[0] != "meat":
                    assert row[0] is None and row[1] is not None
            cursor.execute(
                "SELECT product_area_code FROM tariffs WHERE laboratory_id = %s AND service_code = 'NO_SUCH_SEED'",
                (str(laboratory),),
            )
            assert cursor.fetchall() == []  # no unexpected extra rows
            cursor.execute(
                "SELECT product_area_code, product_species_id FROM tariffs"
                " WHERE laboratory_id = %s AND service_code = 'PRODUCT_IDENTIFICATION'",
                (str(laboratory),),
            )
            check_row = cursor.fetchone()
            assert check_row[0] is None and check_row[1] is None  # CHECK is never touched

        # The survivor prices a VSE calculation correctly (area scope, species
        # of the party never enters the lookup).
        import asyncio  # noqa: PLC0415

        from sqlalchemy.ext.asyncio import AsyncSession  # noqa: PLC0415

        async def _price() -> str:
            engine = create_async_engine(test_db_url, echo=False)
            factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            try:
                async with factory() as session:
                    request = PricingRequest.model_validate(
                        {
                            "party_id": str(uuid.uuid4()),
                            "laboratory_id": str(laboratory),
                            "context": "VSE",
                            "performed": [],
                            "results": [
                                {"indicator_id": str(microscopy), "performed": True, "value": "2.5"},
                            ],
                            "fair": False,
                            "product_species_id": str(uuid.uuid4()),
                            "accepted_quantity": "1",
                            "accepted_unit_id": "kg",
                        }
                    )
                    snapshot = await evaluate_and_price(UnitOfWork(session), request, None)
                    return snapshot.lines[0].unit_price
            finally:
                await engine.dispose()

        assert asyncio.run(_price()) == NEWEST_PRICE
    finally:
        # Keep the shared test database at head even when an assertion fails.
        _alembic(test_db_url, "upgrade", "head")


@pytest.mark.integration
def test_0021_downgrade_survives_null_bulk_echo(test_db_url: str) -> None:
    """The bulk_price_jobs NULL species echo (created after 0021) must NOT
    block the downgrade: the echo is redundant metadata — the column simply
    stays nullable instead of inventing or deleting values."""

    up = _alembic(test_db_url, "upgrade", "head")
    assert up.returncode == 0, up.stdout + up.stderr
    try:
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO bulk_price_jobs (actor_id, product_species_id, service_code, unit_id, price)"
                " VALUES (%s, NULL, 'trichinelloscopy', 'kg', 100.00)",
                (str(uuid.uuid4()),),
            )
            connection.commit()

        down = _alembic(test_db_url, "downgrade", "0020_dr35_specialist")
        assert down.returncode == 0, down.stdout + down.stderr
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM bulk_price_jobs WHERE product_species_id IS NULL")
            assert cursor.fetchone()[0] == 1  # the echo was never invented or deleted
    finally:
        restored = _alembic(test_db_url, "upgrade", "head")
        assert restored.returncode == 0, restored.stdout + restored.stderr
