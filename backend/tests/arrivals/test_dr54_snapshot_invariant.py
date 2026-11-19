"""ТЗ DR54 Task 2 tests: the bidirectional fair pricing preview and the
coherent public pricing snapshot.

Named plan assertions:

- two preview POSTs in one session (``fair=true`` then ``fair=false``) return
  the zero total and then the ordinary total: no server-side caching;
- an incomplete re-save after an old ``fair=true`` snapshot never publishes a
  mismatched ``fair``/``pricing.fair`` pair (the snapshot is cleared);
- a complete save with ``fair=false`` after ``fair=true`` independently
  recomputes and freezes the ordinary total;
- the view returned by a plain GET of a row stored with the diverging legacy
  snapshot keeps ``fair`` and ``pricing.fair`` consistent.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from backend.src.modules.arrivals.models import Reconciliation
from backend.tests.arrivals.check_pricing_seed import seed_check_pricing
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_dr53_pricing_preview import SPECIES, _import_party, full_body, headers

pytestmark = pytest.mark.integration


@pytest.fixture(name="vet_env")
async def _vet_env_fixture(arrivals_vet_env: object) -> object:  # noqa: F811
    return arrivals_vet_env


async def _save(http: object, party: object, body: dict[str, object], revision: int) -> object:
    return await http.put(  # type: ignore[attr-defined]
        f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
        json=body,
        headers={
            "idempotency-key": str(uuid.uuid4()),
            "if-match": f'"{revision}"',
        },
    )


async def test_preview_fair_flip_is_not_cached(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        fair = await http.post(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers=headers(identity),
        )
        ordinary = await http.post(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(fair=False),
            headers=headers(identity),
        )
        fair_again = await http.post(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers=headers(identity),
        )
    assert fair.status_code == ordinary.status_code == fair_again.status_code == 200
    assert fair.json()["fair"] is True
    assert fair.json()["total"] == "0.00"
    # The second answer of the same session is the ordinary pricing: no cache.
    assert ordinary.json()["fair"] is False
    assert ordinary.json()["total"] != "0.00"
    assert fair_again.json()["fair"] is True
    assert fair_again.json()["total"] == "0.00"


async def test_incomplete_save_never_publishes_mismatched_fair_pair(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        first = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers={
                "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert first.status_code == 200, first.text
        saved = first.json()
        assert saved["fair"] is True
        assert saved["pricing"]["fair"] is True
        assert saved["pricing"]["total"] == "0.00"

        # An incomplete re-save with the flipped fair flag: the old zero fair
        # snapshot must not be published under fair=false.
        incomplete = dict(full_body(fair=False))
        incomplete["checks"] = {}
        incomplete["inspection"] = {"compartment": None, "joint_carriage": None}
        second = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers={
                "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert second.status_code == 200, second.text
        body = second.json()
        assert body["fair"] is False
        assert body["pricing"] is None

        # The plain GET keeps the invariant too.
        read = await http.get(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
        )
        assert read.status_code == 200
        assert read.json()["fair"] is False
        assert read.json()["pricing"] is None


async def test_complete_save_after_fair_freezes_ordinary_total(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        # Preview of the fair draft (never a ready total for the save).
        preview = await http.post(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation-pricing-preview",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers=headers(identity),
        )
        assert preview.json()["total"] == "0.00"
        first = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers={
                "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert first.status_code == 200
        assert first.json()["pricing"]["total"] == "0.00"
        second = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=full_body(fair=False),
            headers={
                "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert second.status_code == 200, second.text
        body = second.json()
        assert body["fair"] is False
        assert body["pricing"]["fair"] is False
        assert body["pricing"]["total"] != "0.00"


async def test_legacy_diverging_snapshot_is_not_published_on_read(vet_env: object) -> None:
    """A row stored by the old code with a zero fair snapshot under
    ``row.fair=false`` keeps ``fair``/``pricing.fair`` consistent on GET."""
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        saved = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=full_body(fair=True),
            headers={
                "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert saved.status_code == 200
        # Simulate the legacy diverging row WITHOUT a manual write in the
        # production flow: the stored snapshot keeps fair=true while the row
        # itself flips to fair=false (the old defect shape).
        row = (
            await env.db.execute(  # type: ignore[attr-defined]
                select(Reconciliation).where(Reconciliation.party_id == party.id)  # type: ignore[attr-defined]
            )
        ).scalar_one()
        assert isinstance(row.pricing_snapshot, dict) and row.pricing_snapshot["fair"] is True
        row.fair = False
        await env.db.commit()  # type: ignore[attr-defined]
        read = await http.get(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
        )
        assert read.status_code == 200
        body = read.json()
        assert body["fair"] is False
        assert body["pricing"] is None
