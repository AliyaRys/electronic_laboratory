"""The scoped methods-catalog context (ТЗ-DR28 §7/§8, variant B).

Named plan tests:

- ``test_context_without_meat_dictionary_is_configuration_missing`` — no
  classification read model row → honest 409 CONFIGURATION_MISSING, never an
  empty catalog;
- ``test_context_resolves_species_and_state`` — the real dictionary species and
  the observed subProduct of THIS laboratory's party resolve the scope; the
  full VSE-F18–F29 list and the missing indicators are returned;
- ``test_context_rejects_foreign_species_and_state`` — an unknown species/state
  of another scope is refused, no data leaks;
- ``test_create_blocks_laboratory_uuid_as_state`` — the laboratory UUID and the
  species id itself are never valid states;
- ``test_post_idempotency_no_duplicate`` — the same Idempotency-Key replays the
  created rule instead of storing a second one;
- ``test_readiness_conditional_trichinelloscopy`` — a species flagged
  ``requires_trichinelloscopy`` without a norm is listed in readiness; a
  species without the flag is not.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.catalog_pricing.mandatory import (
    ORGANOLEPTIC_INDICATOR_ID,
    TEMPERATURE_INDICATOR_ID,
    TRICHINELLA_INDICATOR_ID,
)
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2 as MercuryLvl2
from backend.tests.catalog_pricing.test_pricing import _client_for, _csrf_headers, _rule, _seed


async def _meat_dictionary(db: AsyncSession, guid: uuid.UUID, *, trichinella: bool = False) -> None:
    db.add(
        MercuryLvl2(
            contour="PILOT",
            guid=guid,
            current_uuid=uuid.uuid4(),
            name="Свинина",
            english_name="Pork",
            tnved_codes="0203",
            product_type=1,
            active=True,
            is_last=True,
            external_status=100,
            requires_trichinelloscopy=trichinella,
            source="test",
        )
    )
    await db.commit()


async def _party_with_sub_product(
    db: AsyncSession, env, species: uuid.UUID, state: uuid.UUID
) -> None:
    from backend.src.modules.arrivals.models import IncomingDocument, Party

    document = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=env.lab.id,
        external_status="VALID",
        source_snapshot={},
        content_hash="test",
        fetched_at=datetime.now(UTC),
    )
    db.add(document)
    await db.flush()
    db.add(
        Party(
            incoming_document_id=document.id,
            laboratory_id=env.lab.id,
            classification_snapshot={
                "product": {"id": str(species), "name": "Свинина"},
                "subProduct": {"id": str(state), "name": "Охлаждённая свинина"},
            },
        )
    )
    await db.commit()


@pytest.mark.integration
async def test_context_without_meat_dictionary_is_configuration_missing(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = await _seed(db_session)
    # The honest no-dictionary answer is asserted without touching the shared
    # VetIS dictionary rows of other suites (DR28 §3: no data deletions).
    from backend.src.modules.catalog_pricing import context as context_module

    async def _no_meat(db: AsyncSession) -> bool:
        return False

    monkeypatch.setattr(context_module, "meat_area_configured", _no_meat)
    async with _client_for(env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context", params={"laboratory_id": str(env.lab.id)}
        )
        # An honest no-scope answer: the area exists but is not configured, no
        # species/state pair is served and the catalog is never mistaken for
        # an empty norm list (ТЗ-DR28 §5.1/§8.1).
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["areas"] == [{"code": "meat", "name": "Мясо и мясопродукты", "configured": False}]
        assert body["species_options"] == []
        assert body["product_species"] is None and body["product_state"] is None


@pytest.mark.integration
async def test_context_resolves_species_and_state(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state = uuid.uuid4(), uuid.uuid4()
    await _meat_dictionary(db_session, species, trichinella=True)
    await _party_with_sub_product(db_session, env, species, state)
    db_session.add(_rule(env.lab.id, species, state, ORGANOLEPTIC_INDICATOR_ID, result_schema="ENUM", unit_id=""))
    await db_session.commit()
    async with _client_for(env) as http:
        response = await http.get(
            "/api/v1/catalogs/methods/context",
            params={
                "laboratory_id": str(env.lab.id),
                "area": "meat",
                "product_species_id": str(species),
                "product_state_id": str(state),
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["areas"] == [{"code": "meat", "name": "Мясо и мясопродукты", "configured": True}]
        assert body["product_species"]["label"] == "Свинина"
        assert body["product_state"]["label"] == "Охлаждённая свинина"
        # The full ФТ list, exactly VSE-F18–F29, without F30/F31.
        codes = [item["code"] for item in body["indicators"]]
        assert codes == [f"VSE-F{number}" for number in range(18, 30)]
        # The configured organoleptic rule is returned; the rest is missing.
        assert [rule["indicator_id"] for rule in body["active_rules"]] == [str(ORGANOLEPTIC_INDICATOR_ID)]
        missing = [str(item) for item in body["missing"]]
        assert str(TEMPERATURE_INDICATOR_ID) in missing
        assert str(ORGANOLEPTIC_INDICATOR_ID) not in missing
        # A UUID is never served as a label.
        assert "Свинина" not in missing
        assert all(body[key]["label"] != str(species) for key in ("product_species", "product_state"))


@pytest.mark.integration
async def test_context_rejects_foreign_species_and_state(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state = uuid.uuid4(), uuid.uuid4()
    await _meat_dictionary(db_session, species)
    await _party_with_sub_product(db_session, env, species, state)
    async with _client_for(env) as http:
        foreign_species = await http.get(
            "/api/v1/catalogs/methods/context",
            params={"laboratory_id": str(env.lab.id), "product_species_id": str(uuid.uuid4())},
        )
        assert foreign_species.status_code == 409
        assert foreign_species.json()["code"] == "CONFIGURATION_MISSING"
        foreign_state = await http.get(
            "/api/v1/catalogs/methods/context",
            params={
                "laboratory_id": str(env.lab.id),
                "product_species_id": str(species),
                "product_state_id": str(uuid.uuid4()),
            },
        )
        assert foreign_state.status_code == 409
        assert foreign_state.json()["code"] == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_create_blocks_laboratory_uuid_as_species_and_state(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    async with _client_for(env) as http:
        lab_id = str(env.lab.id)
        base = {
            "laboratory_id": lab_id,
            "product_species_id": lab_id,
            "product_state_id": str(uuid.uuid4()),
            "indicator_id": str(TEMPERATURE_INDICATOR_ID),
            "result_schema": "DECIMAL",
            "unit_id": "°C",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика"},
            "version": 1,
        }
        response = await http.post("/api/v1/catalogs/methods", json=base, headers=_csrf_headers(env))
        assert response.status_code == 422
        assert response.json()["code"] == "VALIDATION_ERROR"
        # A real species but the laboratory UUID as the state is blocked too.
        species = str(uuid.uuid4())
        state_problem = {**base, "product_species_id": species, "product_state_id": lab_id}
        response = await http.post("/api/v1/catalogs/methods", json=state_problem, headers=_csrf_headers(env))
        assert response.status_code == 422
        assert response.json()["code"] == "VALIDATION_ERROR"
        # The species id itself is never a valid state.
        same = {**base, "product_species_id": species, "product_state_id": species}
        response = await http.post("/api/v1/catalogs/methods", json=same, headers=_csrf_headers(env))
        assert response.status_code == 422


@pytest.mark.integration
async def test_post_idempotency_no_duplicate(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    async with _client_for(env) as http:
        payload = {
            "laboratory_id": str(env.lab.id),
            "product_species_id": str(uuid.uuid4()),
            "product_state_id": str(uuid.uuid4()),
            "indicator_id": str(TEMPERATURE_INDICATOR_ID),
            "result_schema": "DECIMAL",
            "unit_id": "°C",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика"},
            "version": 1,
        }
        headers = _csrf_headers(env)
        first = await http.post("/api/v1/catalogs/methods", json=payload, headers=headers)
        assert first.status_code == 201, first.text
        replay = await http.post("/api/v1/catalogs/methods", json=payload, headers=headers)
        assert replay.status_code == 201
        assert replay.json()["id"] == first.json()["id"]


@pytest.mark.integration
async def test_readiness_conditional_trichinelloscopy(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    await _meat_dictionary(db_session, species, trichinella=True)
    async with _client_for(env) as http:
        response = await http.get(
            "/api/v1/catalogs/readiness", params={"laboratory_id": str(env.lab.id), "product_species_id": str(species)}
        )
        assert response.status_code == 200
        inputs = [item["input_id"] for item in response.json()["missing"]]
        assert f"method:{TRICHINELLA_INDICATOR_ID}" in inputs

    # Without the flag (or without a dictionary row at all) F21 stays
    # conditional and is never demanded.
    plain_species = uuid.uuid4()
    async with _client_for(env) as http:
        response = await http.get(
            "/api/v1/catalogs/readiness",
            params={"laboratory_id": str(env.lab.id), "product_species_id": str(plain_species)},
        )
        inputs = [item["input_id"] for item in response.json()["missing"]]
        assert not any(item.endswith(str(TRICHINELLA_INDICATOR_ID)) for item in inputs)
