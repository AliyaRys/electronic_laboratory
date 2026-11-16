"""The methods-catalog context and write flow (DR31 meat scope).

The context is resolved by laboratory + product area ONLY: no Mercury species
dictionary, no observed party subProducts, no species/state parameters. The
write contract carries the stable indicator code; technical fields are filled
server-side. Roles, idempotency and If-Match behavior are preserved.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import async_session
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.tests.catalog_pricing.test_pricing import PASSWORD, _seed
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

# --- fixtures ---------------------------------------------------------------------


@asynccontextmanager
async def _client_for(env: SimpleNamespace):
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.db.bind, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="context")
    app.dependency_overrides[async_session] = request_session
    app.dependency_overrides[get_session_transport] = lambda: transport
    app.dependency_overrides[get_authorizer] = lambda: Authorizer(InMemoryDecisionEngine())
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            token = str((await http.get("/api/v1/auth/csrf")).json()["csrf_token"])
            response = await http.post(
                "/api/v1/auth/login",
                json={"login": "chief", "password": PASSWORD},
                headers={"Origin": "http://test", "X-CSRF-Token": token},
            )
            assert response.status_code == 200, response.text
            env.csrf = response.json()["csrf_token"]
            yield http
    finally:
        for key in (async_session, get_session_transport, get_authorizer):
            app.dependency_overrides.pop(key, None)


def _csrf_headers(env: SimpleNamespace) -> dict[str, str]:
    return {"Origin": "http://test", "X-CSRF-Token": env.csrf, "Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture
async def api_env(db_session: AsyncSession) -> SimpleNamespace:
    return await _seed(db_session)


@pytest_asyncio.fixture(autouse=True)
async def _clean_seeded_dictionary(test_db_engine):
    yield
    async with test_db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM mercury_product_guid_lvl_2 WHERE source = 'test'"))


# --- scenarios --------------------------------------------------------------------


@pytest.mark.integration
async def test_context_lists_full_registry_with_missing(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={"laboratory_id": str(api_env.lab.id), "area": "meat"},
        )
        assert response.status_code == 200, response.text
        context = response.json()
        assert context["laboratory"]["id"] == str(api_env.lab.id)
        assert [item["code"] for item in context["indicators"]] == [f"VSE-F{n}" for n in range(18, 30)]
        assert {item["code"] for item in context["indicators"]}.isdisjoint({"VSE-F30", "VSE-F31"})


@pytest.mark.integration
async def test_unknown_area_is_configuration_missing(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={"laboratory_id": str(api_env.lab.id), "area": "milk"},
        )
        assert response.status_code == 409
        assert response.json()["code"] == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_create_idempotency_and_if_match_flow(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        payload = {
            "laboratory_id": str(api_env.lab.id),
            "code": "VSE-F20",
            "rule": {"type": "interval", "lower": "0", "upper": "6"},
        }
        headers = _csrf_headers(api_env)
        created = await http.post("/api/v1/catalogs/methods", json=payload, headers=headers)
        assert created.status_code == 201, created.text
        rule = created.json()

        # Create idempotency: the same key replays the same row.
        replay_headers = dict(headers)
        replay = await http.post("/api/v1/catalogs/methods", json=payload, headers=replay_headers)
        assert replay.status_code in (200, 201)
        assert replay.json()["id"] == rule["id"]

        # A different key for the same payload: a second version is blocked by
        # nothing at the API level, but the unique index keeps exactly one
        # active norm — the server deactivates the previous one on create.
        second = await http.post(
            "/api/v1/catalogs/methods",
            json=payload,
            headers=_csrf_headers(api_env),
        )
        assert second.status_code == 201, second.text

        # Update honors If-Match: a stale revision is a 409 conflict.
        stale = await http.put(
            f"/api/v1/catalogs/methods/{rule['id']}",
            json=payload,
            headers={**_csrf_headers(api_env), "If-Match": '"999"'},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "REVISION_CONFLICT"

        fresh = await http.put(
            f"/api/v1/catalogs/methods/{rule['id']}",
            json=payload,
            headers={**_csrf_headers(api_env), "If-Match": f'"{rule["revision"]}"'},
        )
        assert fresh.status_code == 200, fresh.text
        assert fresh.json()["revision"] == rule["revision"] + 1

        # Delete is idempotent and honors If-Match as well.
        deleted = await http.delete(
            f"/api/v1/catalogs/methods/{fresh.json()['id']}",
            headers={**_csrf_headers(api_env), "If-Match": f'"{fresh.json()["revision"]}"'},
        )
        assert deleted.status_code == 204


@pytest.mark.integration
async def test_readiness_is_meat_scoped(api_env: SimpleNamespace) -> None:
    """Readiness reports the missing mandatory norms of the single meat set,
    never per-species duplicates; F21 stays a party-level rule."""
    from backend.src.modules.catalog_pricing.queries import readiness

    report = await readiness(api_env.db, api_env.lab.id)
    inputs = {item.input_id for item in report.missing}
    assert f"method:{_mandatory.ORGANOLEPTIC_INDICATOR_ID}" in inputs
    assert f"method:{_mandatory.IDENTIFICATION_INDICATOR_ID}" in inputs
    assert f"method:{_mandatory.TEMPERATURE_INDICATOR_ID}" in inputs
    assert f"method:{_mandatory.TRICHINELLA_INDICATOR_ID}" not in inputs
