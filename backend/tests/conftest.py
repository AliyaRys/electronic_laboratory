"""Pytest configuration for the backend platform tests.

The tests exercise the real PostgreSQL contract (ADR-001/ADR-003): a
``postgres:18.6`` container is started once per session and the schema is created
by running the actual Alembic migration, never ``create_all`` and never SQLite.
"""

import os
import subprocess
import sys
from pathlib import Path

# Configure the environment BEFORE importing anything from ``backend.src``:
# settings are read at import time.
os.environ.setdefault("ENVIRONMENT", "pytest")
os.environ.setdefault("SESSION_COOKIE_SECURE", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.postgres import PostgresContainer

from backend.src.core.database import async_session
from backend.src.interfaces.main import app

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Identity tables reset between tests (never ``alembic_version``).
_IDENTITY_TABLES = (
    "report_snapshots",
    "examination_tombstones",
    "outbox",
    "technical_events",
    "command_records",
    "casbin_rule",
    "user_events",
    "delegation_grants",
    "user_scopes",
    "users",
    "laboratories",
    "territories",
    # catalog_pricing configuration (Task C01)
    "bulk_price_targets",
    "bulk_price_jobs",
    "report_classifications",
    "check_service_rules",
    "tariffs",
    "method_rules",
    # arrivals (Task A01)
    "hidden_incoming",
    # VetIS sync journal (Task V02)
    "vetis_source_documents",
    "vetis_operations",
    "vetis_bindings",
    # purpose dictionary (DR5)
    "mercury_purpose_sync_state",
    "mercury_purpose_guid",
    # samples (Task S01)
    "sample_collections",
    "sample_disposals",
    "sample_baskets",
    "examination_samples",
    "examinations",
    "receipt_confirmations",
    "reconciliations",
    "parties",
    "incoming_documents",
)


def _async_url(pg: PostgresContainer) -> str:
    """The asyncpg URL for a testcontainers PostgreSQL instance."""
    url = pg.get_connection_url()
    for prefix in ("postgresql+psycopg2://", "postgresql+psycopg://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    raise RuntimeError(f"Unrecognized PostgreSQL URL from testcontainers: {url}")


def _run_migrations(url: str) -> None:
    """Run ``alembic upgrade head`` in a subprocess against the given database."""
    env = dict(os.environ)
    env["DATABASE_URL"] = url
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "-c", str(REPO_ROOT / "backend" / "alembic.ini"), "upgrade", "head"],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic upgrade failed:\n{result.stdout}\n{result.stderr}")


@pytest.fixture(scope="session")
def pg_container() -> PostgresContainer:
    with PostgresContainer("postgres:18.6") as pg:
        yield pg


@pytest.fixture(scope="session")
def test_db_url(pg_container: PostgresContainer) -> str:
    url = _async_url(pg_container)
    _run_migrations(url)
    return url


@pytest_asyncio.fixture
async def test_db_engine(test_db_url: str):
    engine = create_async_engine(test_db_url, echo=False)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_db_engine) -> AsyncSession:
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture(autouse=True)
async def _reset_identity_tables(test_db_engine) -> None:
    """Truncate identity tables after each test for isolation."""
    yield
    async with test_db_engine.begin() as conn:
        for table in _IDENTITY_TABLES:
            await conn.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncClient:
    """An ASGI client whose database dependency is the migrated test session."""
    app.dependency_overrides.clear()

    async def override_get_db():
        yield db_session

    app.dependency_overrides[async_session] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
