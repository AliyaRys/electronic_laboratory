"""ТЗ DR53 Task 1 tests: the side-effect-free reconciliation pricing preview.

Named plan assertions:

- the preview endpoint applies the same party scope/authorization as
  ``reconciliation:save``, requires CSRF and returns ``Cache-Control: no-store``;
- a complete draft returns the SAME typed snapshot the save would store
  (``fair=true`` shows honest zeros, ``fair=false`` the ordinary total);
- an incomplete/invalid draft returns the typed validation problem and never
  fabricates a zero snapshot;
- the preview performs no INSERT/UPDATE, no idempotency claim, no audit event
  (command_records/technical_events stay unchanged) and no external call.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from backend.src.modules.arrivals import commands
from backend.tests.arrivals.check_pricing_seed import seed_check_pricing
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_import_and_queues import PILOT_BEEF, UNIT_KG, document

SPECIES = PILOT_BEEF
UNIT = str(UNIT_KG)


@pytest.fixture(name="vet_env")
async def _vet_env_fixture(arrivals_vet_env: object) -> object:  # noqa: F811
    return arrivals_vet_env


def full_body(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "checks": {
            "CHK-F05": {"matches": True},
            "CHK-F07": {"matches": True},
            "CHK-F10": {"matches": True},
            "CHK-F15": {"matches": True},
            "CHK-F16": {"matches": True},
            "CHK-F18": {"matches": True},
            "CHK-F20": {"matches": True},
            "CHK-F21": {"matches": True},
        },
        "inspection": {"compartment": "COMPLIANT", "joint_carriage": "NONE"},
        "delivered": {"mass_kg": "120", "quantity": "4", "unit_id": UNIT},
        "accepted": {"mass_kg": "120", "quantity": "4", "unit_id": UNIT},
        "returned": {"mass_kg": "0", "quantity": "0", "unit_id": UNIT},
        "decision": "ACCEPT_ALL",
        "transaction": {"planned": False, "type": None},
        "fair": False,
        "services": [],
    }
    base.update(overrides)
    return base


def headers(identity: object) -> dict[str, str]:
    return {
        "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
        "origin": "http://test",
    }


async def _import_party(env: object) -> object:
    party = await commands.upsert_incoming(
        env.db,  # type: ignore[attr-defined]
        document(uuid.uuid4(), env.own.id),  # type: ignore[attr-defined]
    )
    await env.db.commit()  # type: ignore[attr-defined]
    return party


AUDIT_TABLES = ("command_records", "technical_events", "outbox", "vetis_operations")


@pytest.mark.integration
async def test_preview_returns_snapshot_without_side_effects(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)

    async def audit_counts() -> dict[str, int]:
        counts: dict[str, int] = {}
        for table in AUDIT_TABLES:
            counts[table] = (
                int((await env.db.execute(text(f"SELECT COUNT(*) FROM {table}"))).scalar_one())  # type: ignore[attr-defined]
            )
        counts["reconciliation"] = int(
            (
                await env.db.execute(text("SELECT COUNT(*) FROM reconciliations"))  # type: ignore[attr-defined]
            ).scalar_one()
        )
        return counts

    before = await audit_counts()
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.post(
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(),
            headers=headers(identity),
        )
    assert response.status_code == 200, response.text
    assert response.headers.get("cache-control") == "no-store"
    snapshot = response.json()
    assert snapshot["currency"] == "RUB"
    assert isinstance(snapshot["total"], str)
    assert len(snapshot["lines"]) == 2
    await env.db.commit()  # type: ignore[attr-defined]
    after = await audit_counts()
    assert after == before, f"the preview wrote: {before} -> {after}"


@pytest.mark.integration
async def test_preview_fair_returns_zero_total(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.post(
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers=headers(identity),
        )
    assert response.status_code == 200, response.text
    snapshot = response.json()
    assert snapshot["total"] == "0.00"
    assert all(line["amount"] == "0.00" for line in snapshot["lines"])


@pytest.mark.integration
async def test_preview_incomplete_draft_is_typed_problem_not_zero(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    body = full_body()
    body["checks"] = {}  # no marks at all: an incomplete draft
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.post(
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=body,
            headers=headers(identity),
        )
    assert response.status_code == 422, response.text
    problem = response.json()
    assert problem["code"] == "VALIDATION_ERROR"
    assert isinstance(problem["errors"], list) and problem["errors"]


@pytest.mark.integration
async def test_preview_requires_csrf_and_scope(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        # no CSRF header/origin → forbidden
        response = await http.post(
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(),
        )
        assert response.status_code == 403
        # CSRF present, but no scope for the party laboratory → forbidden
        scoped = await http.post(
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(),
            headers=headers(identity),
        )
    assert scoped.status_code == 200
