"""The scoped methods-catalog context (ТЗ-DR28 §8 backend scenarios).

Named scenarios:

- no configured meat dictionary → honest 409 CONFIGURATION_MISSING (never an
  empty catalog page, never the laboratory UUID as a species);
- a valid species/state pair returns ONLY its own scoped active rules;
- a species of another scope is refused with CONFIGURATION_MISSING;
- POST creates a rule with the REAL species/state/indicator of the context;
- product_state_id equal to the laboratory UUID or the species is blocked;
- readiness lists the missing mandatory F18–F20 (and never F30/F31).
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import async_session
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.context import MEAT_PRODUCT_TYPE
from backend.src.modules.catalog_pricing.models import MethodRule
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2
from backend.tests.catalog_pricing.test_pricing import PASSWORD, _seed
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

# --- fixtures ---------------------------------------------------------------------


def _meat_record(guid: uuid.UUID, name: str, *, trichinella: bool = False) -> MercuryProductGuidLvl2:
    return MercuryProductGuidLvl2(
        contour="PILOT",
        guid=guid,
        current_uuid=uuid.uuid4(),
        name=name,
        english_name=name,
        tnved_codes="0201",
        product_type=MEAT_PRODUCT_TYPE,
        active=True,
        is_last=True,
        external_status=100,
        requires_trichinelloscopy=trichinella,
        source="test",
        synchronized_at=datetime.now(UTC),
    )


async def _party(db: AsyncSession, lab_id: uuid.UUID, species: uuid.UUID, state: uuid.UUID) -> None:
    document = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=lab_id,
        external_status="CONFIRMED",
        source_snapshot={},
        content_hash=uuid.uuid4().hex,
        fetched_at=datetime.now(UTC),
    )
    db.add(document)
    await db.flush()
    db.add(
        Party(
            incoming_document_id=document.id,
            laboratory_id=lab_id,
            classification_snapshot={
                "product": {"id": str(species), "name": "Свинина"},
                "subProduct": {"id": str(state), "name": "Охлаждённое"},
            },
        )
    )


def _context_species(context: dict) -> uuid.UUID:
    return uuid.UUID(context["product_species"]["id"])


# --- HTTP layer -------------------------------------------------------------------


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
    """Remove ONLY the rows seeded by this module from the shared dictionary
    read model (source='test'), so the migration-owned 28-row snapshot and the
    four trichinelloscopy names stay intact for the other suites."""
    yield
    async with test_db_engine.begin() as conn:
        await conn.execute(text("DELETE FROM mercury_product_guid_lvl_2 WHERE source = 'test'"))


# --- scenarios --------------------------------------------------------------------


@pytest.mark.integration
async def test_no_dictionary_is_honest_configuration_missing(api_env: SimpleNamespace) -> None:
    """Scenario 1 (§5.1/R-DR28-1): the legacy laboratory-UUID fallback is never
    a product species — a context request with it answers with the honest
    CONFIGURATION_MISSING problem, never a catalog page and never fabricated
    scope data."""
    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={
                "laboratory_id": str(api_env.lab.id),
                "product_species_id": str(api_env.lab.id),
            },
        )
        assert response.status_code == 409
        assert response.json()["code"] == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_valid_pair_scopes_only_its_own_rules(api_env: SimpleNamespace) -> None:
    """Scenario 2: the resolved pair returns only ITS scoped active rules, the
    full VSE-F18–F29 list and the missing indicators (honest «Не настроено»)."""
    db = api_env.db
    species, state = uuid.uuid4(), uuid.uuid4()
    db.add(_meat_record(species, "Свинина"))
    await _party(db, api_env.lab.id, species, state)
    other_species, other_state = uuid.uuid4(), uuid.uuid4()
    db.add(
        MethodRule(
            laboratory_id=api_env.lab.id,
            product_species_id=other_species,
            product_state_id=other_state,
            indicator_id=_mandatory.TEMPERATURE_INDICATOR_ID,
            version=1,
            result_schema="DECIMAL",
            unit_id="°C",
            rule={"type": "interval", "lower": "0", "upper": "6"},
            source={"name": "чужая область"},
            active=True,
        )
    )
    mine = MethodRule(
        laboratory_id=api_env.lab.id,
        product_species_id=species,
        product_state_id=state,
        indicator_id=_mandatory.MICROSCOPY_INDICATOR_ID,
        version=1,
        result_schema="INTEGER_NONNEGATIVE",
        unit_id="ед.",
        rule={"type": "interval", "lower": "0", "upper": "10"},
        source={"name": "методика"},
        active=True,
    )
    db.add(mine)
    await db.commit()

    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={"laboratory_id": str(api_env.lab.id), "area": "meat", "product_species_id": str(species)},
        )
        assert response.status_code == 200, response.text
        context = response.json()
        # The area is resolved with its human-readable name.
        assert context["areas"][0]["name"] == "Мясо и мясопродукты"
        assert context["product_species"]["label"] == "Свинина"
        assert context["product_state"]["label"] == "Охлаждённое"
        # Full VSE-F18–F29 catalog, F30/F31 never appear.
        codes = [item["code"] for item in context["indicators"]]
        assert codes == [f"VSE-F{number}" for number in range(18, 30)]
        # Only the scoped rule of THIS pair; the other scope stays invisible.
        assert [rule["id"] for rule in context["active_rules"]] == [str(mine.id)]
        missing = [str(item) for item in context["missing"]]
        assert str(_mandatory.ORGANOLEPTIC_INDICATOR_ID) in missing
        assert str(_mandatory.MICROSCOPY_INDICATOR_ID) not in missing


@pytest.mark.integration
async def test_foreign_species_is_configuration_missing(api_env: SimpleNamespace) -> None:
    """Scenario 3: a species outside the allowed classification read model is
    refused honestly — never another scope's data."""
    db = api_env.db
    species = uuid.uuid4()
    db.add(_meat_record(species, "Говядина"))
    await db.commit()
    async with _client_for(api_env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={
                "laboratory_id": str(api_env.lab.id),
                "product_species_id": str(uuid.uuid4()),
            },
        )
        assert response.status_code == 409
        assert response.json()["code"] == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_create_uses_real_context_pair_and_idempotency(api_env: SimpleNamespace) -> None:
    """Scenarios 4/6: POST with the REAL context pair creates the rule; a replay
    with the same Idempotency-Key does not create a duplicate."""
    db = api_env.db
    species, state = uuid.uuid4(), uuid.uuid4()
    db.add(_meat_record(species, "Конина", trichinella=True))
    await _party(db, api_env.lab.id, species, state)
    await db.commit()

    async with _client_for(api_env) as http:
        context = (
            await http.get(
                "/api/v1/catalogs/methods/context",
                params={"laboratory_id": str(api_env.lab.id), "product_species_id": str(species)},
            )
        ).json()
        resolved_species = _context_species(context)
        resolved_state = uuid.UUID(context["product_state"]["id"])
        payload = {
            "laboratory_id": str(api_env.lab.id),
            "product_species_id": str(resolved_species),
            "product_state_id": str(resolved_state),
            "indicator_id": str(_mandatory.ORGANOLEPTIC_INDICATOR_ID),
            "result_schema": "ENUM",
            "unit_id": "ед.",
            "rule": {"type": "qualitative", "accepted_values": ["Соответствует"]},
            "source": {"name": "методика"},
            "version": 1,
        }
        headers = _csrf_headers(api_env)
        created = await http.post("/api/v1/catalogs/methods", json=payload, headers=headers)
        assert created.status_code == 201, created.text
        replay = await http.post("/api/v1/catalogs/methods", json=payload, headers=headers)
        # The same Idempotency-Key replays the SAME rule — never a duplicate.
        assert replay.status_code in (200, 201), replay.text
        assert replay.json()["id"] == created.json()["id"]
        listed = await http.get(
            "/api/v1/catalogs/methods",
            params={"laboratory_id": str(api_env.lab.id), "product_species_id": str(resolved_species)},
        )
        assert listed.json()["total"] == 1


@pytest.mark.integration
async def test_invalid_state_scope_is_blocked(api_env: SimpleNamespace) -> None:
    """Scenario 5: the laboratory UUID or the species id is never accepted as a
    product state."""
    db = api_env.db
    species = uuid.uuid4()
    db.add(_meat_record(species, "Свинина"))
    await db.commit()
    async with _client_for(api_env) as http:
        for bad_state in (str(api_env.lab.id), str(species)):
            payload = {
                "laboratory_id": str(api_env.lab.id),
                "product_species_id": str(species),
                "product_state_id": bad_state,
                "indicator_id": str(_mandatory.TEMPERATURE_INDICATOR_ID),
                "result_schema": "DECIMAL",
                "unit_id": "°C",
                "rule": {"type": "interval", "lower": "0", "upper": "6"},
                "source": {"name": "методика"},
                "version": 1,
            }
            response = await http.post("/api/v1/catalogs/methods", json=payload, headers=_csrf_headers(api_env))
            assert response.status_code == 422, response.text
            assert response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.integration
async def test_readiness_lists_missing_mandatory_f18_f20(api_env: SimpleNamespace) -> None:
    """Scenario 9: readiness enumerates the missing mandatory F18–F20; the
    conditional F21 stays a party rule and F30/F31 never appear."""
    from backend.src.modules.catalog_pricing.queries import readiness

    db = api_env.db
    species, state = uuid.uuid4(), uuid.uuid4()
    db.add(
        MethodRule(
            laboratory_id=api_env.lab.id,
            product_species_id=species,
            product_state_id=state,
            indicator_id=_mandatory.TEMPERATURE_INDICATOR_ID,
            version=1,
            result_schema="DECIMAL",
            unit_id="°C",
            rule={"type": "interval", "lower": "0", "upper": "6"},
            source={"name": "методика"},
            active=True,
        )
    )
    await db.commit()
    report = await readiness(db, api_env.lab.id, species)
    inputs = {item.input_id for item in report.missing}
    assert f"method:{_mandatory.ORGANOLEPTIC_INDICATOR_ID}" in inputs
    assert f"method:{_mandatory.IDENTIFICATION_INDICATOR_ID}" in inputs
    assert f"method:{_mandatory.TEMPERATURE_INDICATOR_ID}" not in inputs
    assert not any("F30" in item or "F31" in item for item in inputs)
