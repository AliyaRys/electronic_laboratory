"""ТЗ DR11 tests: server-side pricing of the two CHECK reconciliation services.

Named plan assertions (§9):

- a full valid save computes the TWO exact CHECK lines server-side and stores
  the frozen snapshot atomically with the facts (R-DR11-3);
- the snapshot carries the exact codes, the unified Russian names, quantity,
  unit, tariff, amount and total;
- a missing tariff is ``CONFIGURATION_MISSING`` naming the service — never an
  empty invoice or a silent zero (R-DR11-2);
- a foreign species/laboratory tariff is never used (exact scope only);
- ``applicable_decisions`` gate the decision (ACCEPT_ALL/PARTIAL/RETURN_ALL);
- ONE_SERVICE / ACCEPTED_QUANTITY / DELIVERED_QUANTITY multiply correctly;
- ``fair=true`` stores honest zeros without a hidden ordinary price;
- a re-save is idempotent and never duplicates lines;
- a later tariff change never recalculates the frozen snapshot;
- a stale concurrent save is a 409 conflict and commits nothing.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import UnitOfWork
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.models import Reconciliation
from backend.src.modules.catalog_pricing.models import CheckServiceRule, Tariff
from backend.src.modules.catalog_pricing.schemas import PricingRequest
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.tests.arrivals.check_pricing_seed import (
    CHECK_RULE_SOURCE,
    TARIFF_SOURCE,
    seed_check_pricing,
)
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_import_and_queues import PILOT_BEEF, UNIT_KG, document

SPECIES = PILOT_BEEF  # «говядина» (0005 seed) — the party's exact species scope
UNIT = str(UNIT_KG)
LABORATORY_SCOPE = "2812e437-facc-432f-9242-5162c9d9f49f"  # the live target party laboratory


@pytest.fixture(name="vet_env")
async def _vet_env_fixture(arrivals_vet_env: object) -> object:  # noqa: F811 - fixture re-export
    return arrivals_vet_env


def full_body(**overrides: object) -> dict[str, object]:
    """A fully valid ACCEPT_ALL body against the default beef fixture."""
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


def headers(identity: object, revision: str = "1") -> dict[str, str]:
    return {
        "x-csrf-token": identity.csrf_token,  # type: ignore[attr-defined]
        "origin": "http://test",
        "idempotency-key": str(uuid.uuid4()),
        "if-match": f'"{revision}"',
    }


async def _import_party(env: object, **document_kwargs: object):
    party = await commands.upsert_incoming(
        env.db,  # type: ignore[attr-defined]
        document(uuid.uuid4(), env.own.id, **document_kwargs),  # type: ignore[attr-defined]
    )
    await env.db.commit()  # type: ignore[attr-defined]
    return party


async def saved_row(db: AsyncSession, party_id: uuid.UUID) -> Reconciliation | None:
    return (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party_id))
    ).scalar_one_or_none()


# --- §9-1/§9-2: the full save prices BOTH services server-side -------------------


@pytest.mark.integration
async def test_full_save_prices_two_check_services_and_stores_snapshot(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert response.status_code == 200, response.text
        view = response.json()
        pricing = view["pricing"]
        assert pricing is not None
        assert pricing["currency"] == "RUB"
        assert pricing["fair"] is False
        codes = [line["service_code"] for line in pricing["lines"]]
        # ТЗ DR11 §2/§4.1: exactly the two exact codes, in the fixed order.
        assert codes == ["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"]
        names = [line["name"] for line in pricing["lines"]]
        assert names == [
            "Идентификация продукции по наименованию и визуальным осмотром",
            "Ветеринарно-санитарная оценка и идентификация транспорта",
        ]
        # ONE_SERVICE lineage default (no configured rule): quantity 1, the
        # explicit honest mark is kept in method_snapshot.
        for line in pricing["lines"]:
            assert line["quantity"] == "1"
            assert line["unit_id"] == "service"
            assert line["method_snapshot"]["multiplier_basis"] is None
            assert line["method_snapshot"]["source"]["name"] == "Правило услуги не задано"
        assert [line["unit_price"] for line in pricing["lines"]] == ["100.00", "130.00"]
        assert [line["amount"] for line in pricing["lines"]] == ["100.00", "130.00"]
        assert pricing["total"] == "230.00"
        # The old field stays a performed-service fact, never the invoice.
        assert view["services"] == []

        # The snapshot is stored atomically with the facts and returns on a
        # plain GET (the same server projection).
        fetched = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")
        assert fetched.json()["pricing"]["total"] == "230.00"

    row = await saved_row(env.db, party.id)  # type: ignore[attr-defined]
    assert row.pricing_snapshot is not None
    assert row.pricing_snapshot["total"] == "230.00"


# --- §9-3: a missing tariff is CONFIGURATION_MISSING, not zero -------------------


@pytest.mark.integration
async def test_missing_tariff_is_configuration_missing_with_service_name(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    from sqlalchemy import delete  # noqa: PLC0415

    # The party's own scope has no configured tariff; nothing fictive is saved.
    await env.db.execute(delete(Tariff).where(Tariff.laboratory_id == env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert response.status_code == 422, response.text
        problem = response.json()
        assert problem["code"] == "CONFIGURATION_MISSING"
        # The missing SERVICE is named: the problem item carries the exact
        # service path (performed.<CODE>), not a generic banner.
        items = problem.get("errors", [])
        assert any(item.get("path") == "performed.PRODUCT_IDENTIFICATION" for item in items), problem
        assert all(item.get("field_id") == "CHECK" for item in items)

    row = await saved_row(env.db, party.id)  # type: ignore[attr-defined]
    assert row is None  # nothing was committed: no empty or fictive snapshot


# --- §9-4: a foreign scope tariff is never used -----------------------------------


@pytest.mark.integration
async def test_foreign_species_tariff_is_never_used(db_session: AsyncSession) -> None:
    """Only the laboratory-scoped (species NULL) CHECK rows answer.

    Owner decision DR14: a tariff of the same laboratory that carries a
    species (a VSE row) and a laboratory-scoped row of a FOREIGN laboratory
    are never used for the CHECK pricing.
    """
    laboratory_id = uuid.uuid4()
    db_session.add(
        Tariff(
            laboratory_id=laboratory_id,
            product_species_id=uuid.uuid4(),  # a species-set row of the same laboratory
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="RUB",
            price=Decimal("777.00"),
            version=1,
            source=TARIFF_SOURCE,
        )
    )
    db_session.add(
        Tariff(
            laboratory_id=uuid.uuid4(),  # a foreign laboratory
            product_species_id=None,
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="RUB",
            price=Decimal("777.00"),
            version=1,
            source=TARIFF_SOURCE,
        )
    )
    await db_session.commit()
    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(laboratory_id),
            "context": "CHECK",
            "performed": ["PRODUCT_IDENTIFICATION"],
            "fair": False,
            "decision": "ACCEPT_ALL",
        }
    )
    with pytest.raises(ProblemError) as raised:
        await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert raised.value.code == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_party_species_differences_never_change_the_price(db_session: AsyncSession) -> None:
    """Owner decision DR14: the price applies to reconciliations of EVERY
    species — the lookup consults the laboratory only."""
    from backend.tests.arrivals.check_pricing_seed import seed_check_pricing

    laboratory_id = uuid.uuid4()
    await seed_check_pricing(db_session, laboratory_id)
    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(laboratory_id),
            "context": "CHECK",
            "performed": ["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"],
            "fair": False,
            "product_species_id": str(uuid.uuid4()),  # any species of the party
            "decision": "ACCEPT_ALL",
        }
    )
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert [line["unit_price"] for line in snapshot.model_dump()["lines"]] == ["100.00", "130.00"]

    without_species = request.model_copy(update={"product_species_id": None})
    snapshot = await evaluate_and_price(UnitOfWork(db_session), without_species, None)
    assert snapshot.total == "230.00"


@pytest.mark.integration
async def test_foreign_laboratory_tariff_is_never_used(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    # The FOREIGN laboratory has the exact species tariff, the party's own
    # laboratory has none: the foreign price is never used.
    from sqlalchemy import delete  # noqa: PLC0415

    await env.db.execute(delete(Tariff).where(Tariff.laboratory_id == env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    party = await _import_party(env)  # imported into env.own
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert response.status_code == 422
        assert response.json()["code"] == "CONFIGURATION_MISSING"


# --- §9-5: applicable decisions gate the calculation ------------------------------


@pytest.mark.integration
async def test_applicable_decisions_gate_the_save(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(
        env.db,  # type: ignore[attr-defined]
        env.own.id,  # type: ignore[attr-defined]
        SPECIES,
        rules={
            "PRODUCT_IDENTIFICATION": {"multiplier_basis": "ONE_SERVICE", "applicable_decisions": ["ACCEPT_ALL"]},
            "TRANSPORT_INSPECTION": {"multiplier_basis": "ONE_SERVICE", "applicable_decisions": ["ACCEPT_ALL"]},
        },
    )
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        ok = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert ok.status_code == 200, ok.text

        partial = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(
                decision="PARTIAL",
                return_reason={"code": "DEFECTIVE_GOODS"},
                accepted={"mass_kg": "100", "quantity": "3", "unit_id": UNIT},
                returned={"mass_kg": "20", "quantity": "1", "unit_id": UNIT},
                checks={
                    **full_body()["checks"],  # type: ignore[index]
                    "CHK-F21": {"matches": False, "actual": "100", "reason": "Недостача при доставке"},
                },
            ),
            headers=headers(identity, revision=str(ok.json()["revision"])),
        )
        assert partial.status_code == 422
        assert partial.json()["code"] == "CONFIGURATION_MISSING"
        assert "Решение сверки не входит в применимые" in partial.json()["detail"]


# --- §9-6: the three multiplier bases multiply correctly --------------------------


@pytest.mark.integration
@pytest.mark.parametrize(
    ("basis", "expected_quantity", "expected_amount"),
    [
        ("ONE_SERVICE", "1", "100.00"),
        ("ACCEPTED_QUANTITY", "4", "400.00"),
        ("DELIVERED_QUANTITY", "4", "400.00"),
    ],
)
async def test_multiplier_bases_multiply_correctly(
    db_session: AsyncSession,
    basis: str,
    expected_quantity: str,
    expected_amount: str,
) -> None:
    """The rule basis decides the multiplier; the tariff scope is exact."""
    laboratory_id = uuid.uuid4()
    db_session.add(
        CheckServiceRule(
            service_code="PRODUCT_IDENTIFICATION",
            unit_id=UNIT,
            multiplier_basis=basis,
            applicable_decisions=["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
            version=1,
            source=CHECK_RULE_SOURCE,
        )
    )
    db_session.add(
        Tariff(
            laboratory_id=laboratory_id,
            product_species_id=None,
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="RUB",
            price=Decimal("100.00"),
            version=1,
            source=TARIFF_SOURCE,
        )
    )
    await db_session.commit()

    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(laboratory_id),
            "context": "CHECK",
            "performed": ["PRODUCT_IDENTIFICATION"],
            "fair": False,
            "decision": "ACCEPT_ALL",
            "accepted_quantity": "4",
            "accepted_unit_id": UNIT,
            "delivered_quantity": "4",
            "delivered_unit_id": UNIT,
        }
    )
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    line = snapshot.lines[0]
    assert line.quantity == expected_quantity
    assert line.unit_id == UNIT
    assert line.amount == expected_amount
    assert snapshot.total == expected_amount


# --- §9-7: fair keeps honest zeros ------------------------------------------------


@pytest.mark.integration
async def test_fair_stores_zero_without_hidden_price(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        response = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(fair=True),
            headers=headers(identity),
        )
        assert response.status_code == 200, response.text
        pricing = response.json()["pricing"]
        assert pricing["fair"] is True
        assert pricing["total"] == "0.00"
        for line in pricing["lines"]:
            # Both services stay performed rows; no tariff is stored as an
            # ordinary amount and no hidden price survives.
            assert line["quantity"] == "1"
            assert line["unit_price"] == "0.00"
            assert line["amount"] == "0.00"
        assert len(pricing["lines"]) == 2


# --- §9-8: an idempotent re-save never duplicates lines ---------------------------


@pytest.mark.integration
async def test_resave_is_idempotent_and_never_duplicates(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        first = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert first.status_code == 200, first.text
        revision = first.json()["revision"]
        second = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity, revision=str(revision)),
        )
        assert second.status_code == 200, second.text
        pricing = second.json()["pricing"]
        assert [line["service_code"] for line in pricing["lines"]] == [
            "PRODUCT_IDENTIFICATION",
            "TRANSPORT_INSPECTION",
        ]
        assert pricing["total"] == "230.00"

    rows = (
        (await env.db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id)))  # type: ignore[attr-defined]
        .scalars()
        .all()
    )
    assert len(rows) == 1


# --- §9-9: a later tariff change never recalculates the frozen snapshot -----------


@pytest.mark.integration
async def test_tariff_change_keeps_the_saved_snapshot(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        saved = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert saved.status_code == 200, saved.text
        frozen_total = saved.json()["pricing"]["total"]
        assert frozen_total == "230.00"

    # The catalog price moves AFTER the save.
    tariff = (
        await env.db.execute(  # type: ignore[attr-defined]
            select(Tariff).where(
                Tariff.laboratory_id == env.own.id,  # type: ignore[attr-defined]
                Tariff.product_species_id.is_(None),
                Tariff.service_code == "PRODUCT_IDENTIFICATION",
            )
        )
    ).scalar_one_or_none()
    tariff.price = Decimal("999.00")
    await env.db.commit()  # type: ignore[attr-defined]

    async with _client_for(env) as (http, _identity):  # type: ignore[operator]
        fetched = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")
        assert fetched.status_code == 200
        assert fetched.json()["pricing"]["total"] == frozen_total
        assert fetched.json()["pricing"]["total"] == "230.00"
        unit_prices = [line["unit_price"] for line in fetched.json()["pricing"]["lines"]]
        assert unit_prices == ["100.00", "130.00"]


# --- §9-10: a stale concurrent save is a conflict and commits nothing -------------


@pytest.mark.integration
async def test_stale_save_conflicts_and_loses_nothing(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    await seed_check_pricing(env.db, env.own.id, SPECIES)  # type: ignore[attr-defined]
    party = await _import_party(env)
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        first = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert first.status_code == 200, first.text

        stale = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(decision="PARTIAL", return_reason={"code": "DEFECTIVE_GOODS"}),
            headers=headers(identity, revision="9"),  # stale after the first save
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "REVISION_CONFLICT"

        row = await saved_row(env.db, party.id)  # type: ignore[attr-defined]
        assert row.decision == "ACCEPT_ALL"  # the stale save committed nothing
        assert row.pricing_snapshot["total"] == "230.00"
