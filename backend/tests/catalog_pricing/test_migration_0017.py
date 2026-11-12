"""Migration 0017 pre-check (fix round 1): the duplicate CHECK rows case.

The old unique constraint allowed a laboratory to hold CHECK tariffs under
DIFFERENT species values. NULLing the species makes them identical keys, so
0017 must resolve the collision BEFORE creating the partial unique index: it
keeps exactly one row per (laboratory, code, unit) — the newest (version, rev,
id) — and deletes the superseded duplicates. This test reproduces the collision
at revision 0016, runs the real migration and asserts the survivor prices.
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


def _insert_tariff(cursor: psycopg.Cursor, laboratory: uuid.UUID, species: uuid.UUID, code: str, version: int) -> None:
    cursor.execute(
        "INSERT INTO tariffs (laboratory_id, product_species_id, service_code, unit_id, price, version, source)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            str(laboratory),
            str(species),
            code,
            "RUB",
            "100.00" if version == 1 else NEWEST_PRICE if version == 5 else "150.00",
            version,
            '{"name": "прейскурант"}',
        ),
    )


@pytest.mark.integration
def test_0017_deduplicates_superseded_check_tariffs(test_db_url: str) -> None:
    laboratory = uuid.uuid4()
    identification_species_a, identification_species_b, identification_species_c = (
        uuid.uuid4(),
        uuid.uuid4(),
        uuid.uuid4(),
    )
    transport_species_a, transport_species_b = uuid.uuid4(), uuid.uuid4()

    downgraded = _alembic(test_db_url, "downgrade", "0016_reconciliation_pricing")
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
    try:
        # The collision the old schema allowed: THREE identification tariffs and
        # TWO transport tariffs of the SAME laboratory + unit under different
        # species; the newest identification row (version 5) must survive.
        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            _insert_tariff(cursor, laboratory, identification_species_a, "PRODUCT_IDENTIFICATION", 1)
            _insert_tariff(cursor, laboratory, identification_species_b, "PRODUCT_IDENTIFICATION", 5)
            _insert_tariff(cursor, laboratory, identification_species_c, "PRODUCT_IDENTIFICATION", 3)
            _insert_tariff(cursor, laboratory, transport_species_a, "TRANSPORT_INSPECTION", 1)
            _insert_tariff(cursor, laboratory, transport_species_b, "TRANSPORT_INSPECTION", 2)
            # An untouched VSE row of the same laboratory keeps its species.
            cursor.execute(
                "INSERT INTO tariffs (laboratory_id, product_species_id, service_code, unit_id, price, version, source)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (str(laboratory), str(uuid.uuid4()), str(uuid.uuid4()), "kg", "10.00", 1, '{"name": "прейскурант"}'),
            )
            connection.commit()

        upgraded = _alembic(test_db_url, "upgrade", "head")
        assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr

        with psycopg.connect(_sync_url(test_db_url)) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT product_species_id, price FROM tariffs"
                " WHERE laboratory_id = %s AND service_code = 'PRODUCT_IDENTIFICATION' AND unit_id = 'RUB'",
                (str(laboratory),),
            )
            identification = cursor.fetchall()
            assert len(identification) == 1  # exactly the newest row survived
            assert identification[0][0] is None  # the CHECK scope is laboratory only
            assert identification[0][1] == pytest.approx(250.00)  # the NEWEST price, not the oldest
            cursor.execute(
                "SELECT product_species_id, price FROM tariffs"
                " WHERE laboratory_id = %s AND service_code = 'TRANSPORT_INSPECTION' AND unit_id = 'RUB'",
                (str(laboratory),),
            )
            transport = cursor.fetchall()
            assert len(transport) == 1 and transport[0][0] is None
            cursor.execute(
                "SELECT count(*) FROM tariffs WHERE laboratory_id = %s AND product_species_id IS NOT NULL",
                (str(laboratory),),
            )
            assert cursor.fetchone()[0] == 1  # the VSE row is untouched

        # The survivor prices a reconciliation correctly.
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
                            "context": "CHECK",
                            "performed": ["PRODUCT_IDENTIFICATION"],
                            "fair": False,
                            "decision": "ACCEPT_ALL",
                        }
                    )
                    snapshot = await evaluate_and_price(UnitOfWork(session), request, None)
                    return snapshot.total
            finally:
                await engine.dispose()

        assert asyncio.run(_price()) == NEWEST_PRICE
    finally:
        # Keep the shared test database at head even when an assertion fails.
        _alembic(test_db_url, "upgrade", "head")
