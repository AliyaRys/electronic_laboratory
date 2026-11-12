"""Decimal pricing, snapshots and fair mode (Task C01, ADR-020 / API-03).

Named plan tests:

- ``test_three_units_at_100_10`` — 3 × 100.10 → 300.30 exactly (Decimal, no float);
- ``test_half_cent_rounds_up`` — 0.005 → 0.01 (ROUND_HALF_UP to 0.01);
- ``test_four_units_two_performed`` — 4 units × 100 × 2 performed → 800.00;
- ``test_fair_all_zero_and_no_ordinary_price`` — fair: every saved charge is 0
  and the ordinary tariff is not present in the snapshot;
- ``test_missing_price_configuration_missing`` / ``test_explicit_zero_price_allowed``;
- ``test_previous_snapshot_survives_catalog_delete`` — the old indicator stays
  priced at 100 from the snapshot, the new one takes the current 150;
- ``test_deviation_does_not_assign_outcome`` — the engine reports a deviation,
  the doctor chooses the outcome;
- missing norm blocks the fair calculation too; UNKNOWN of a mandatory
  indicator blocks; CHECK services keep their own context.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.commands import UnitOfWork
from backend.src.core.database import async_session
from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing.models import CheckServiceRule, MethodRule, Tariff
from backend.src.modules.catalog_pricing.schemas import PricingRequest, PricingSnapshot, ResearchValue
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.models import DelegationGrant, Laboratory, Territory, User, UserRole
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

PASSWORD = "correct horse battery"


# --- fixtures ---------------------------------------------------------------------


async def _seed(db: AsyncSession) -> SimpleNamespace:
    root = Territory(name="Республика Татарстан")
    district = Territory(name="Первый район", parent_id=root.id)
    db.add_all([root, district])
    await db.flush()
    lab = Laboratory(territory_id=district.id, name="Лаборатория один", address="ул. Первая, 1", organization="ГБУ")
    db.add(lab)
    await db.flush()
    chief = User(
        login="chief",
        full_name="Главный администратор",
        email="chief@example.test",
        password_hash=hash_password(PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    db.add(chief)
    await db.flush()
    db.add(DelegationGrant(grantor_id=chief.id, target_id=chief.id, role=UserRole.ADMIN, territory_id=district.id))
    await db.commit()
    return SimpleNamespace(db=db, lab=lab, district=district, chief=chief)


def _rule(
    lab: uuid.UUID, species: uuid.UUID, state: uuid.UUID, indicator: uuid.UUID, **overrides: object
) -> MethodRule:
    defaults: dict[str, object] = {
        "laboratory_id": lab,
        "product_species_id": species,
        "product_state_id": state,
        "indicator_id": indicator,
        "version": 1,
        "result_schema": "DECIMAL",
        "unit_id": "kg",
        "rule": {"type": "interval", "lower": "0", "upper": "100", "lower_inclusive": True, "upper_inclusive": True},
        "source": {"name": "методика", "edition": "2023", "reference": "п.4"},
        "active": True,
    }
    defaults.update(overrides)
    return MethodRule(**defaults)  # type: ignore[arg-type]


def _tariff(lab: uuid.UUID, species: uuid.UUID | None, code: str, price: str, unit: str = "kg") -> Tariff:
    return Tariff(
        laboratory_id=lab,
        product_species_id=species,
        service_code=code,
        unit_id=unit,
        price=price,
        version=1,
        source={"name": "прейскурант"},
    )


def _vse_request(
    lab: uuid.UUID,
    species: uuid.UUID,
    state: uuid.UUID,
    results: list[ResearchValue],
    *,
    fair: bool = False,
    quantity: str = "1",
) -> PricingRequest:
    return PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(lab),
            "context": "VSE",
            "performed": [],
            "results": [
                {"indicator_id": str(r.indicator_id), "performed": r.performed, "value": r.value} for r in results
            ],
            "fair": fair,
            "product_species_id": str(species),
            "product_state_id": str(state),
            "accepted_quantity": quantity,
            "accepted_unit_id": "kg",
        }
    )


def _prev_snapshot(
    species: uuid.UUID, state: uuid.UUID, indicator: uuid.UUID, price: str, rule: MethodRule
) -> PricingSnapshot:
    """A previously priced snapshot whose method snapshot pins the old rule."""
    return PricingSnapshot.model_validate(
        {
            "lines": [
                {
                    "service_code": str(indicator),
                    "name": "старая методика",
                    "unit_id": rule.unit_id,
                    "quantity": "4",
                    "unit_price": price,
                    "amount": "400.00",
                    "method_snapshot": {
                        "indicator_id": str(indicator),
                        "method_version": rule.version,
                        "result_schema": rule.result_schema,
                        "unit_id": rule.unit_id,
                        "rule": rule.rule,
                        "source": rule.source,
                    },
                    "evaluation": {"status": "IN_NORM"},
                }
            ],
            "total": "400.00",
            "currency": "RUB",
            "fair": False,
        }
    )


# --- named decimal tests ----------------------------------------------------------


@pytest.mark.integration
async def test_three_units_at_100_10(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    # The method measures a result in kg while the independently configured
    # monetary tariff carries RUB. Pricing joins them by stable service code.
    db_session.add(_tariff(env.lab.id, species, str(indicator), "100.10", unit="RUB"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True, "value": "10"})],
            quantity="3",
        ),
        None,
    )
    assert len(snapshot.lines) == 1
    assert snapshot.lines[0].unit_price == "100.10"
    assert snapshot.lines[0].quantity == "3"
    assert snapshot.lines[0].amount == "300.30"
    assert snapshot.total == "300.30"
    assert snapshot.currency == "RUB"


@pytest.mark.integration
async def test_half_cent_rounds_up(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "0.01"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True})],
            quantity="0.5",
        ),
        None,
    )
    # 0.5 × 0.01 = 0.005 → ROUND_HALF_UP → 0.01, never 0.00
    assert snapshot.lines[0].amount == "0.01"
    assert snapshot.total == "0.01"


@pytest.mark.integration
async def test_four_units_two_performed(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state = uuid.uuid4(), uuid.uuid4()
    first, second = uuid.uuid4(), uuid.uuid4()
    db_session.add_all([_rule(env.lab.id, species, state, first), _rule(env.lab.id, species, state, second)])
    db_session.add_all(
        [_tariff(env.lab.id, species, str(first), "100.00"), _tariff(env.lab.id, species, str(second), "100.00")]
    )
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [
                ResearchValue.model_validate({"indicator_id": str(first), "performed": True}),
                ResearchValue.model_validate({"indicator_id": str(second), "performed": True}),
            ],
            quantity="4",
        ),
        None,
    )
    assert [line.amount for line in snapshot.lines] == ["400.00", "400.00"]
    assert snapshot.total == "800.00"


@pytest.mark.integration
async def test_fair_all_zero_and_no_ordinary_price(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "250.00"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True})],
            fair=True,
            quantity="4",
        ),
        None,
    )
    assert snapshot.fair is True
    assert snapshot.total == "0.00"
    for line in snapshot.lines:
        assert line.unit_price == "0.00"
        assert line.amount == "0.00"
        # the ordinary tariff must not leak into the fair working snapshot
        assert "price" not in line.method_snapshot
        assert "tariff" not in line.method_snapshot


@pytest.mark.integration
async def test_missing_price_configuration_missing(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    await db_session.commit()

    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                state,
                [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True})],
                quantity="3",
            ),
            None,
        )
    assert excinfo.value.code == "CONFIGURATION_MISSING"
    assert excinfo.value.status == 422


@pytest.mark.integration
async def test_explicit_zero_price_allowed(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "0.00"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True})],
            quantity="3",
        ),
        None,
    )
    assert snapshot.lines[0].unit_price == "0.00"
    assert snapshot.lines[0].amount == "0.00"
    assert snapshot.total == "0.00"


@pytest.mark.integration
async def test_previous_snapshot_survives_catalog_delete(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, old_indicator, new_indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    old_rule = _rule(env.lab.id, species, state, old_indicator)
    db_session.add(old_rule)
    db_session.add(_tariff(env.lab.id, species, str(old_indicator), "100.00"))
    await db_session.commit()
    previous = _prev_snapshot(species, state, old_indicator, "100.00", old_rule)

    # The catalog changes under the working record: the old rule row is deleted
    # and the current tariff becomes 150.
    await db_session.execute(MethodRule.__table__.delete().where(MethodRule.indicator_id == old_indicator))
    db_session.add(_rule(env.lab.id, species, state, new_indicator))
    db_session.add(_tariff(env.lab.id, species, str(new_indicator), "150.00"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [
                ResearchValue.model_validate({"indicator_id": str(old_indicator), "performed": True}),
                ResearchValue.model_validate({"indicator_id": str(new_indicator), "performed": True}),
            ],
            quantity="4",
        ),
        previous,
    )
    amounts = {line.service_code: line.amount for line in snapshot.lines}
    assert amounts[str(old_indicator)] == "400.00"  # 4 × 100 pinned in the snapshot
    assert amounts[str(new_indicator)] == "600.00"  # 4 × 150 current tariff
    assert snapshot.total == "1000.00"


@pytest.mark.integration
async def test_deviation_does_not_assign_outcome(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "100.00"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True, "value": "1000"})],
        ),
        None,
    )
    assert snapshot.lines[0].evaluation["status"] == "DEVIATION"
    # The engine never chooses the outcome; it is not even a field of the snapshot.
    assert "outcome" not in snapshot.model_dump()
    assert all("outcome" not in line.evaluation for line in snapshot.lines)


@pytest.mark.integration
async def test_missing_norm_blocks_fair_too(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_tariff(env.lab.id, species, str(indicator), "100.00"))
    await db_session.commit()

    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                state,
                [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True})],
                fair=True,
                quantity="3",
            ),
            None,
        )
    assert excinfo.value.code == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_unknown_mandatory_blocks(db_session: AsyncSession) -> None:
    """A universally mandatory FT indicator blocks UNKNOWN or unperformed."""
    env = await _seed(db_session)
    species, state = uuid.uuid4(), uuid.uuid4()
    from backend.src.modules.catalog_pricing.mandatory import ORGANOLEPTIC_INDICATOR_ID

    indicator = ORGANOLEPTIC_INDICATOR_ID
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "100.00"))
    await db_session.commit()

    # An unparseable value is UNKNOWN: for a mandatory indicator this blocks.
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                state,
                [
                    ResearchValue.model_validate(
                        {"indicator_id": str(indicator), "performed": True, "value": "не число"}
                    )
                ],
            ),
            None,
        )
    assert excinfo.value.code == "CONFIGURATION_MISSING"
    # A non-performed mandatory indicator also blocks.
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                state,
                [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": False})],
            ),
            None,
        )
    assert excinfo.value.code == "CONFIGURATION_MISSING"
    # The same gap does not block the fair calculation of an optional indicator.
    other = uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, other))
    db_session.add(_tariff(env.lab.id, species, str(other), "0.00"))
    await db_session.commit()
    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(other), "performed": True, "value": "abc"})],
            fair=True,
        ),
        None,
    )
    assert snapshot.lines[0].evaluation["status"] == "UNKNOWN"


# --- CHECK services: separate context, performed fact, decision applicability ------


@pytest.mark.integration
async def test_check_one_service_basis(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    db_session.add(
        CheckServiceRule(
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="piece",
            multiplier_basis="ONE_SERVICE",
            applicable_decisions=["ACCEPT_ALL"],
            version=1,
            source={"name": "прейскурант"},
        )
    )
    # Owner decision DR14: the CHECK tariff is laboratory-scoped only.
    db_session.add(_tariff(env.lab.id, None, "PRODUCT_IDENTIFICATION", "50.00", unit="piece"))
    await db_session.commit()

    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(env.lab.id),
            "context": "CHECK",
            "performed": ["PRODUCT_IDENTIFICATION"],
            "results": [],
            "fair": False,
            "decision": "ACCEPT_ALL",
        }
    )
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert snapshot.lines[0].service_code == "PRODUCT_IDENTIFICATION"
    assert snapshot.lines[0].quantity == "1"
    assert snapshot.lines[0].amount == "50.00"
    assert snapshot.total == "50.00"


@pytest.mark.integration
async def test_check_delivered_quantity_basis(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    db_session.add(
        CheckServiceRule(
            service_code="TRANSPORT_INSPECTION",
            unit_id="kg",
            multiplier_basis="DELIVERED_QUANTITY",
            applicable_decisions=["ACCEPT_ALL", "PARTIAL"],
            version=1,
            source={"name": "прейскурант"},
        )
    )
    db_session.add(_tariff(env.lab.id, None, "TRANSPORT_INSPECTION", "10.00", unit="kg"))
    await db_session.commit()

    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(env.lab.id),
            "context": "CHECK",
            "performed": ["TRANSPORT_INSPECTION"],
            "results": [],
            "fair": False,
            "decision": "PARTIAL",
            "delivered_quantity": "2",
            "delivered_unit_id": "kg",
        }
    )
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert snapshot.lines[0].amount == "20.00"


@pytest.mark.integration
async def test_check_without_rule_records_honest_snapshot(db_session: AsyncSession) -> None:
    """An absent CheckServiceRule keeps the default math but records an honest
    lineage marker — no invented version/basis (DR7 fix round)."""
    env = await _seed(db_session)
    db_session.add(_tariff(env.lab.id, None, "PRODUCT_IDENTIFICATION", "50.00"))
    await db_session.commit()

    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(env.lab.id),
            "context": "CHECK",
            "performed": ["PRODUCT_IDENTIFICATION"],
            "results": [],
            "fair": False,
            "decision": "ACCEPT_ALL",
        }
    )
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    line = snapshot.lines[0]
    # The amount/quantity math is unchanged (one service, tariff price).
    assert line.quantity == "1"
    assert line.amount == "50.00"
    assert line.method_snapshot is not None
    assert line.method_snapshot["multiplier_basis"] is None
    assert line.method_snapshot["method_version"] is None
    assert line.method_snapshot["source"]["name"] == "Правило услуги не задано"


@pytest.mark.integration
async def test_check_inapplicable_decision_and_unit_block(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    db_session.add(
        CheckServiceRule(
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="piece",
            multiplier_basis="ACCEPTED_QUANTITY",
            applicable_decisions=["ACCEPT_ALL"],
            version=1,
            source={"name": "прейскурант"},
        )
    )
    db_session.add(_tariff(env.lab.id, None, "PRODUCT_IDENTIFICATION", "50.00", unit="piece"))
    db_session.add(_tariff(env.lab.id, None, "TRANSPORT_INSPECTION", "70.00", unit="RUB"))
    await db_session.commit()

    base = {
        "party_id": str(uuid.uuid4()),
        "laboratory_id": str(env.lab.id),
        "context": "CHECK",
        "performed": ["PRODUCT_IDENTIFICATION"],
        "results": [],
        "fair": False,
        "decision": "RETURN_ALL",
        "accepted_quantity": "3",
        "accepted_unit_id": "piece",
    }
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(UnitOfWork(db_session), PricingRequest.model_validate(base), None)
    assert excinfo.value.code == "CONFIGURATION_MISSING"

    request = PricingRequest.model_validate({**base, "decision": "ACCEPT_ALL", "accepted_unit_id": "kg"})
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert excinfo.value.code == "CONFIGURATION_MISSING"

    # Without an optional multiplier rule the paid service is charged once.
    request = PricingRequest.model_validate({**base, "performed": ["TRANSPORT_INSPECTION"]})
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert snapshot.lines[0].quantity == "1"
    assert snapshot.lines[0].amount == "70.00"


# --- HTTP layer -------------------------------------------------------------------


@asynccontextmanager
async def _client_for(env: SimpleNamespace):
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.db.bind, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="pricing")
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


@pytest.mark.integration
async def test_catalog_crud_and_etag(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species, state, indicator = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        payload = {
            "laboratory_id": lab_id,
            "product_species_id": species,
            "product_state_id": state,
            "indicator_id": indicator,
            "result_schema": "DECIMAL",
            "unit_id": "kg",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика", "edition": "2023", "reference": "п.4"},
            "version": 1,
        }
        response = await http.post("/api/v1/catalogs/methods", json=payload, headers=_csrf_headers(api_env))
        assert response.status_code == 201, response.text
        created = response.json()
        rule_id = created["id"]
        assert response.headers["ETag"] == '"1"'
        assert created["active"] is True

        listed = await http.get(
            "/api/v1/catalogs/methods", params={"laboratory_id": lab_id, "product_species_id": species}
        )
        assert listed.status_code == 200
        assert listed.json()["total"] == 1

        fetched = await http.get(f"/api/v1/catalogs/methods/{rule_id}")
        assert fetched.status_code == 200
        assert fetched.headers["ETag"] == '"1"'

        updated = await http.put(
            f"/api/v1/catalogs/methods/{rule_id}",
            json={**payload, "unit_id": "piece"},
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["unit_id"] == "piece"
        assert updated.headers["ETag"] == '"2"'

        stale = await http.put(
            f"/api/v1/catalogs/methods/{rule_id}",
            json={**payload, "unit_id": "piece"},
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "REVISION_CONFLICT"

        deleted = await http.delete(
            f"/api/v1/catalogs/methods/{rule_id}", headers={**_csrf_headers(api_env), "If-Match": '"2"'}
        )
        assert deleted.status_code == 204
        missing = await http.get(f"/api/v1/catalogs/methods/{rule_id}")
        assert missing.status_code == 404


@pytest.mark.integration
async def test_method_version_turnover_keeps_one_active(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species, state, indicator = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        base = {
            "laboratory_id": lab_id,
            "product_species_id": species,
            "product_state_id": state,
            "indicator_id": indicator,
            "result_schema": "DECIMAL",
            "unit_id": "kg",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика"},
            "version": 1,
        }
        first = await http.post("/api/v1/catalogs/methods", json=base, headers=_csrf_headers(api_env))
        assert first.status_code == 201
        second = await http.post(
            "/api/v1/catalogs/methods", json={**base, "version": 2}, headers=_csrf_headers(api_env)
        )
        assert second.status_code == 201, second.text
        listed = (
            await http.get("/api/v1/catalogs/methods", params={"laboratory_id": lab_id, "product_species_id": species})
        ).json()
        active = [item for item in listed["items"] if item["active"]]
        assert len(active) == 1 and active[0]["version"] == 2


@pytest.mark.integration
async def test_tariff_and_check_service_and_classification_endpoints(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        tariff = await http.post(
            "/api/v1/catalogs/tariffs",
            json={
                "laboratory_id": lab_id,
                "service_code": "PRODUCT_IDENTIFICATION",
                "unit_id": "piece",
                "price": "50.00",
                "version": 1,
                "source": {"name": "прейскурант"},
            },
            headers=_csrf_headers(api_env),
        )
        assert tariff.status_code == 201, tariff.text
        tariff_id = tariff.json()["id"]
        # Owner decision DR14: a CHECK tariff is laboratory-scoped — the species
        # is never persisted.
        assert tariff.json()["product_species_id"] is None

        listed = (await http.get("/api/v1/catalogs/tariffs", params={"laboratory_id": lab_id})).json()
        assert listed["total"] == 1

        # A VSE code without a species is refused honestly.
        vse_missing_species = await http.post(
            "/api/v1/catalogs/tariffs",
            json={
                "laboratory_id": lab_id,
                "service_code": str(uuid.uuid4()),
                "unit_id": "piece",
                "price": "50.00",
                "version": 1,
                "source": {"name": "прейскурант"},
            },
            headers=_csrf_headers(api_env),
        )
        assert vse_missing_species.status_code == 422
        assert vse_missing_species.json()["code"] == "VALIDATION_ERROR"

        check_rule = await http.post(
            "/api/v1/catalogs/check-services",
            json={
                "service_code": "PRODUCT_IDENTIFICATION",
                "unit_id": "piece",
                "multiplier_basis": "ONE_SERVICE",
                "applicable_decisions": ["ACCEPT_ALL"],
                "version": 1,
                "source": {"name": "прейскурант"},
            },
            headers=_csrf_headers(api_env),
        )
        assert check_rule.status_code == 201, check_rule.text

        classifications = await http.post(
            "/api/v1/catalogs/classifications",
            json={
                "version": "2023.1",
                "items": [
                    {
                        "mercury_species_id": str(uuid.uuid4()),
                        "supported": True,
                        "animal_column": "CATTLE",
                        "material_kind": "MEAT",
                    }
                ],
            },
            headers=_csrf_headers(api_env),
        )
        assert classifications.status_code == 201, classifications.text
        version = classifications.json()["items"][0]["version"]

        class_list = (await http.get("/api/v1/catalogs/classifications", params={"version": version})).json()
        assert class_list["total"] == 1

        fetched_tariff = await http.get(f"/api/v1/catalogs/tariffs/{tariff_id}")
        assert fetched_tariff.status_code == 200
        assert fetched_tariff.headers["ETag"] == '"1"'


@pytest.mark.integration
async def test_readiness_lists_missing_configuration(api_env: SimpleNamespace) -> None:
    """Readiness applies the ФТ mandatory registry and the pricing tariff match."""
    from backend.src.modules.catalog_pricing.mandatory import MANDATORY_INDICATOR_IDS

    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species = str(uuid.uuid4())
        state = str(uuid.uuid4())
        indicators = sorted(MANDATORY_INDICATOR_IDS, key=str)

        def method_payload(indicator: str) -> dict[str, object]:
            return {
                "laboratory_id": lab_id,
                "product_species_id": species,
                "product_state_id": state,
                "indicator_id": indicator,
                "result_schema": "DECIMAL",
                "unit_id": "kg",
                "rule": {
                    "type": "interval",
                    "lower": "0",
                    "upper": "14",
                    "lower_inclusive": True,
                    "upper_inclusive": True,
                },
                "source": {"name": "методика"},
                "version": 1,
            }

        first = str(indicators[0])
        await http.post("/api/v1/catalogs/methods", json=method_payload(first), headers=_csrf_headers(api_env))
        ready = (
            await http.get(
                "/api/v1/catalogs/readiness", params={"laboratory_id": lab_id, "product_species_id": species}
            )
        ).json()
        assert ready["ready"] is False
        assert ready["missing"], "a method without a price must be reported"
        assert any(item["input_id"] == f"tariff:{first}" for item in ready["missing"])

        await http.post(
            "/api/v1/catalogs/tariffs",
            json={
                "laboratory_id": lab_id,
                "product_species_id": species,
                "service_code": first,
                "unit_id": "kg",
                "price": "10.00",
                "version": 1,
                "source": {"name": "прейскурант"},
            },
            headers=_csrf_headers(api_env),
        )
        ready = (
            await http.get(
                "/api/v1/catalogs/readiness", params={"laboratory_id": lab_id, "product_species_id": species}
            )
        ).json()
        assert ready["ready"] is False  # the remaining mandatory indicators are unconfigured

        for indicator in indicators[1:]:
            code = str(indicator)
            await http.post("/api/v1/catalogs/methods", json=method_payload(code), headers=_csrf_headers(api_env))
            await http.post(
                "/api/v1/catalogs/tariffs",
                json={
                    "laboratory_id": lab_id,
                    "product_species_id": species,
                    "service_code": code,
                    "unit_id": "kg",
                    "price": "12.00",
                    "version": 1,
                    "source": {"name": "прейскурант"},
                },
                headers=_csrf_headers(api_env),
            )
        ready = (
            await http.get(
                "/api/v1/catalogs/readiness", params={"laboratory_id": lab_id, "product_species_id": species}
            )
        ).json()
        assert ready["ready"] is True
        assert ready["missing"] == []


@pytest.mark.integration
async def test_readiness_and_pricing_do_not_bind_money_to_measurement_unit(api_env: SimpleNamespace) -> None:
    """A RUB tariff is valid for a method whose measured result uses another unit."""
    from backend.src.modules.catalog_pricing.mandatory import MANDATORY_INDICATOR_IDS

    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species = str(uuid.uuid4())
        state = str(uuid.uuid4())

        def method_payload(indicator: str) -> dict[str, object]:
            return {
                "laboratory_id": lab_id,
                "product_species_id": species,
                "product_state_id": state,
                "indicator_id": indicator,
                "result_schema": "DECIMAL",
                "unit_id": "kg",
                "rule": {
                    "type": "interval",
                    "lower": "0",
                    "upper": "14",
                    "lower_inclusive": True,
                    "upper_inclusive": True,
                },
                "source": {"name": "методика"},
                "version": 1,
            }

        def tariff_payload(indicator: str, unit: str) -> dict[str, object]:
            return {
                "laboratory_id": lab_id,
                "product_species_id": species,
                "service_code": indicator,
                "unit_id": unit,
                "price": "10.00",
                "version": 1,
                "source": {"name": "прейскурант"},
            }

        indicators = sorted(MANDATORY_INDICATOR_IDS, key=str)
        for indicator in indicators:
            code = str(indicator)
            await http.post("/api/v1/catalogs/methods", json=method_payload(code), headers=_csrf_headers(api_env))
            await http.post(
                "/api/v1/catalogs/tariffs",
                json=tariff_payload(code, "RUB"),
                headers=_csrf_headers(api_env),
            )
        ready = (
            await http.get(
                "/api/v1/catalogs/readiness", params={"laboratory_id": lab_id, "product_species_id": species}
            )
        ).json()
        assert ready["ready"] is True
        assert ready["missing"] == []


@pytest.mark.integration
async def test_pricing_preview_endpoint(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species, state, indicator = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        await http.post(
            "/api/v1/catalogs/methods",
            json={
                "laboratory_id": lab_id,
                "product_species_id": species,
                "product_state_id": state,
                "indicator_id": indicator,
                "result_schema": "DECIMAL",
                "unit_id": "kg",
                "rule": {
                    "type": "interval",
                    "lower": "0",
                    "upper": "100",
                    "lower_inclusive": True,
                    "upper_inclusive": True,
                },
                "source": {"name": "методика"},
                "version": 1,
            },
            headers=_csrf_headers(api_env),
        )
        await http.post(
            "/api/v1/catalogs/tariffs",
            json={
                "laboratory_id": lab_id,
                "product_species_id": species,
                "service_code": indicator,
                "unit_id": "kg",
                "price": "100.10",
                "version": 1,
                "source": {"name": "прейскурант"},
            },
            headers=_csrf_headers(api_env),
        )
        response = await http.post(
            "/api/v1/pricing/preview",
            json={
                "party_id": str(uuid.uuid4()),
                "laboratory_id": lab_id,
                "context": "VSE",
                "performed": [],
                "results": [{"indicator_id": indicator, "performed": True, "value": "3"}],
                "fair": False,
                "product_species_id": species,
                "product_state_id": state,
                "accepted_quantity": "3",
                "accepted_unit_id": "kg",
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["lines"][0]["amount"] == "300.30"
        assert body["total"] == "300.30"

        # A missing price is surfaced as a stable problem, never guessed.
        bad = await http.post(
            "/api/v1/pricing/preview",
            json={
                "party_id": str(uuid.uuid4()),
                "laboratory_id": lab_id,
                "context": "VSE",
                "performed": [],
                "results": [{"indicator_id": str(uuid.uuid4()), "performed": True}],
                "fair": False,
                "product_species_id": species,
                "product_state_id": state,
                "accepted_quantity": "3",
                "accepted_unit_id": "kg",
            },
        )
        assert bad.status_code == 422
        assert bad.json()["code"] == "CONFIGURATION_MISSING"

        # The client cannot inject a price: the request schema forbids extras.
        injected = await http.post(
            "/api/v1/pricing/preview",
            json={
                "party_id": str(uuid.uuid4()),
                "laboratory_id": lab_id,
                "context": "VSE",
                "performed": [],
                "results": [{"indicator_id": indicator, "performed": True}],
                "fair": False,
                "product_species_id": species,
                "product_state_id": state,
                "accepted_quantity": "3",
                "accepted_unit_id": "kg",
                "unit_price": "0.00",
            },
        )
        assert injected.status_code == 422


@pytest.mark.integration
async def test_tariff_update_delete_and_conflicts(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species = str(uuid.uuid4())
        base = {
            "laboratory_id": lab_id,
            "product_species_id": species,
            "service_code": "PRODUCT_IDENTIFICATION",
            "unit_id": "piece",
            "price": "50.00",
            "version": 1,
            "source": {"name": "прейскурант"},
        }
        tariff = await http.post("/api/v1/catalogs/tariffs", json=base, headers=_csrf_headers(api_env))
        tariff_id = tariff.json()["id"]

        duplicate = await http.post("/api/v1/catalogs/tariffs", json=base, headers=_csrf_headers(api_env))
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "ALREADY_EXISTS"

        updated = await http.put(
            f"/api/v1/catalogs/tariffs/{tariff_id}",
            json={**base, "price": "60.00"},
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["price"] == "60.00"

        stale = await http.put(
            f"/api/v1/catalogs/tariffs/{tariff_id}",
            json={**base, "price": "70.00"},
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert stale.status_code == 409

        deleted = await http.delete(
            f"/api/v1/catalogs/tariffs/{tariff_id}", headers={**_csrf_headers(api_env), "If-Match": '"2"'}
        )
        assert deleted.status_code == 204
        again = await http.delete(
            f"/api/v1/catalogs/tariffs/{tariff_id}", headers={**_csrf_headers(api_env), "If-Match": '"2"'}
        )
        assert again.status_code == 204

        # A tariff update that would take another existing pricing key conflicts.
        keeper = await http.post(
            "/api/v1/catalogs/tariffs",
            json={**base, "service_code": "TRANSPORT_INSPECTION"},
            headers=_csrf_headers(api_env),
        )
        assert keeper.status_code == 201
        mover = await http.post(
            "/api/v1/catalogs/tariffs",
            json={**base, "service_code": "ANOTHER_SERVICE"},
            headers=_csrf_headers(api_env),
        )
        assert mover.status_code == 201
        collided = await http.put(
            f"/api/v1/catalogs/tariffs/{mover.json()['id']}",
            json={**base, "service_code": "TRANSPORT_INSPECTION", "price": "70.00"},
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert collided.status_code == 409


@pytest.mark.integration
async def test_check_service_conflict_and_get(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        payload = {
            "service_code": "TRANSPORT_INSPECTION",
            "unit_id": "kg",
            "multiplier_basis": "ONE_SERVICE",
            "applicable_decisions": ["ACCEPT_ALL", "PARTIAL"],
            "version": 1,
            "source": {"name": "прейскурант"},
        }
        created = await http.post("/api/v1/catalogs/check-services", json=payload, headers=_csrf_headers(api_env))
        rule_id = created.json()["id"]
        conflict = await http.post("/api/v1/catalogs/check-services", json=payload, headers=_csrf_headers(api_env))
        assert conflict.status_code == 409
        fetched = await http.get(f"/api/v1/catalogs/check-services/{rule_id}")
        assert fetched.status_code == 200
        assert fetched.json()["multiplier_basis"] == "ONE_SERVICE"
        missing = await http.get(f"/api/v1/catalogs/check-services/{uuid.uuid4()}")
        assert missing.status_code == 404

        # An update that would collide with the other service code is rejected.
        identification = {
            "service_code": "PRODUCT_IDENTIFICATION",
            "unit_id": "piece",
            "multiplier_basis": "ONE_SERVICE",
            "applicable_decisions": ["ACCEPT_ALL"],
            "version": 1,
            "source": {"name": "прейскурант"},
        }
        other = await http.post("/api/v1/catalogs/check-services", json=identification, headers=_csrf_headers(api_env))
        assert other.status_code == 201
        collided = await http.put(
            f"/api/v1/catalogs/check-services/{rule_id}",
            json=identification,
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert collided.status_code == 409
        updated = await http.put(
            f"/api/v1/catalogs/check-services/{rule_id}",
            json={**payload, "multiplier_basis": "DELIVERED_QUANTITY"},
            headers={**_csrf_headers(api_env), "If-Match": '"1"'},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["multiplier_basis"] == "DELIVERED_QUANTITY"
        deleted = await http.delete(
            f"/api/v1/catalogs/check-services/{rule_id}", headers={**_csrf_headers(api_env), "If-Match": '"2"'}
        )
        assert deleted.status_code == 204


@pytest.mark.integration
async def test_classification_replace_and_delete(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        item = {
            "mercury_species_id": str(uuid.uuid4()),
            "supported": True,
            "animal_column": "PIG",
            "material_kind": "MEAT",
        }
        payload = {"version": "2024.1", "items": [item]}
        created = await http.post("/api/v1/catalogs/classifications", json=payload, headers=_csrf_headers(api_env))
        assert created.status_code == 201
        # Rewriting the same version replaces its items instead of duplicating.
        replaced = await http.post(
            "/api/v1/catalogs/classifications",
            json={"version": "2024.1", "items": [{**item, "animal_column": "CATTLE"}]},
            headers=_csrf_headers(api_env),
        )
        assert replaced.status_code == 201
        listed = (await http.get("/api/v1/catalogs/classifications", params={"version": "2024.1"})).json()
        assert listed["total"] == 1
        assert listed["items"][0]["animal_column"] == "CATTLE"

        deleted = await http.delete("/api/v1/catalogs/classifications/2024.1", headers=_csrf_headers(api_env))
        assert deleted.status_code == 204
        gone = await http.delete("/api/v1/catalogs/classifications/2024.1", headers=_csrf_headers(api_env))
        assert gone.status_code == 404


@pytest.mark.integration
async def test_idempotency_and_revision_requirements(api_env: SimpleNamespace) -> None:
    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species, state, indicator = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        payload = {
            "laboratory_id": lab_id,
            "product_species_id": species,
            "product_state_id": state,
            "indicator_id": indicator,
            "result_schema": "DECIMAL",
            "unit_id": "kg",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика"},
            "version": 1,
        }
        key = str(uuid.uuid4())
        key_headers = {**_csrf_headers(api_env), "Idempotency-Key": key}
        first = await http.post("/api/v1/catalogs/methods", json=payload, headers=key_headers)
        assert first.status_code == 201
        replay = await http.post("/api/v1/catalogs/methods", json=payload, headers=key_headers)
        assert replay.status_code == 201
        assert replay.json()["id"] == first.json()["id"]

        no_key = await http.post(
            "/api/v1/catalogs/methods", json=payload, headers={"Origin": "http://test", "X-CSRF-Token": api_env.csrf}
        )
        assert no_key.status_code == 422
        assert no_key.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED"

        no_etag = await http.put(
            f"/api/v1/catalogs/methods/{first.json()['id']}",
            json=payload,
            headers=_csrf_headers(api_env),
        )
        assert no_etag.status_code == 422
        assert no_etag.json()["code"] == "REVISION_REQUIRED"


@pytest.mark.integration
async def test_unperformed_optional_indicator_is_skipped(db_session: AsyncSession) -> None:
    """An optional result left unperformed produces no line and no charge."""
    env = await _seed(db_session)
    species, state = uuid.uuid4(), uuid.uuid4()
    first, second = uuid.uuid4(), uuid.uuid4()
    db_session.add_all([_rule(env.lab.id, species, state, first), _rule(env.lab.id, species, state, second)])
    db_session.add_all(
        [_tariff(env.lab.id, species, str(first), "100.00"), _tariff(env.lab.id, species, str(second), "100.00")]
    )
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            state,
            [
                ResearchValue.model_validate({"indicator_id": str(first), "performed": True}),
                ResearchValue.model_validate({"indicator_id": str(second), "performed": False}),
            ],
            quantity="2",
        ),
        None,
    )
    assert len(snapshot.lines) == 1
    assert snapshot.lines[0].service_code == str(first)
    assert snapshot.total == "200.00"


@pytest.mark.integration
async def test_vse_without_accepted_quantity_blocks(db_session: AsyncSession) -> None:
    """The VSE multiplier is only the confirmed accepted quantity (INPUT-03)."""
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "100.00"))
    await db_session.commit()

    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(env.lab.id),
            "context": "VSE",
            "performed": [],
            "results": [{"indicator_id": str(indicator), "performed": True}],
            "fair": False,
            "product_species_id": str(species),
            "product_state_id": str(state),
        }
    )
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert excinfo.value.code == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_missing_laboratory_or_species_scope_blocks(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db_session.add(_rule(env.lab.id, species, state, indicator))
    db_session.add(_tariff(env.lab.id, species, str(indicator), "100.00"))
    await db_session.commit()

    base = {
        "party_id": str(uuid.uuid4()),
        "context": "VSE",
        "performed": [],
        "results": [{"indicator_id": str(indicator), "performed": True}],
        "fair": False,
        "product_species_id": str(species),
        "product_state_id": str(state),
        "accepted_quantity": "1",
        "accepted_unit_id": "kg",
    }
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(UnitOfWork(db_session), PricingRequest.model_validate(base), None)
    assert excinfo.value.code == "CONFIGURATION_MISSING"

    no_species = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(env.lab.id),
            "context": "VSE",
            "performed": [],
            "results": [],
            "fair": False,
            "accepted_quantity": "1",
        }
    )
    with pytest.raises(ProblemError) as excinfo:
        await evaluate_and_price(UnitOfWork(db_session), no_species, None)
    assert excinfo.value.code == "CONFIGURATION_MISSING"


@pytest.mark.integration
async def test_check_prices_without_species(db_session: AsyncSession) -> None:
    """Owner decision DR14: the species is neither required nor consulted.

    A CHECK tariff of the laboratory prices a reconciliation of any species —
    including a party without a species at all.
    """
    env = await _seed(db_session)
    db_session.add(_tariff(env.lab.id, None, "PRODUCT_IDENTIFICATION", "50.00"))
    db_session.add(_tariff(env.lab.id, None, "TRANSPORT_INSPECTION", "140.00"))
    await db_session.commit()
    request = PricingRequest.model_validate(
        {
            "party_id": str(uuid.uuid4()),
            "laboratory_id": str(env.lab.id),
            "context": "CHECK",
            "performed": ["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"],
            "results": [],
            "fair": False,
            "decision": "ACCEPT_ALL",
        }
    )
    snapshot = await evaluate_and_price(UnitOfWork(db_session), request, None)
    assert snapshot.total == "190.00"
    # A differing species value never changes the laboratory-scoped price.
    other = request.model_copy(update={"product_species_id": uuid.uuid4()})
    snapshot = await evaluate_and_price(UnitOfWork(db_session), other, None)
    assert snapshot.total == "190.00"


@pytest.mark.integration
async def test_parallel_puts_same_if_match_conflict(api_env: SimpleNamespace) -> None:
    """Two concurrent PUTs with the same If-Match: one 200, one 409 (SPEC-04).

    The mutation path re-reads the target row ``FOR UPDATE``, so the second
    writer serializes behind the first and sees the bumped revision.
    """
    import asyncio

    async with _client_for(api_env) as http:
        lab_id = str(api_env.lab.id)
        species, state, indicator = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        payload = {
            "laboratory_id": lab_id,
            "product_species_id": species,
            "product_state_id": state,
            "indicator_id": indicator,
            "result_schema": "DECIMAL",
            "unit_id": "kg",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика"},
            "version": 1,
        }
        created = await http.post("/api/v1/catalogs/methods", json=payload, headers=_csrf_headers(api_env))
        assert created.status_code == 201
        rule_id = created.json()["id"]

        results = await asyncio.gather(
            http.put(
                f"/api/v1/catalogs/methods/{rule_id}",
                json={**payload, "unit_id": "piece"},
                headers={**_csrf_headers(api_env), "If-Match": '"1"'},
            ),
            http.put(
                f"/api/v1/catalogs/methods/{rule_id}",
                json={**payload, "unit_id": "gram"},
                headers={**_csrf_headers(api_env), "If-Match": '"1"'},
            ),
        )
        statuses = sorted(response.status_code for response in results)
        assert statuses == [200, 409]
        conflict = next(response for response in results if response.status_code == 409)
        assert conflict.json()["code"] == "REVISION_CONFLICT"


@pytest.mark.integration
async def test_read_only_role_cannot_edit_catalog(api_env: SimpleNamespace) -> None:
    """A VET doctor without catalog edit rights gets 403 (INPUT-05 matrix)."""
    async with api_env.db.begin():
        vet = User(
            login="vetdoctor",
            full_name="Ветеринарный врач",
            email="vet@example.test",
            password_hash=hash_password(PASSWORD),
            role=UserRole.VET,
            active=True,
        )
        api_env.db.add(vet)
        await api_env.db.flush()
        from backend.src.modules.identity.models import UserScope

        api_env.db.add(UserScope(user_id=vet.id, laboratory_id=api_env.lab.id, product_scope_id=uuid.uuid4()))
    await api_env.db.commit()

    async with _client_for(api_env) as http:
        token = str((await http.get("/api/v1/auth/csrf")).json()["csrf_token"])
        response = await http.post(
            "/api/v1/auth/login",
            json={"login": "vetdoctor", "password": PASSWORD},
            headers={"Origin": "http://test", "X-CSRF-Token": token},
        )
        assert response.status_code == 200
        env = SimpleNamespace(**{**api_env.__dict__, "csrf": response.json()["csrf_token"]})
        payload = {
            "laboratory_id": str(api_env.lab.id),
            "product_species_id": str(uuid.uuid4()),
            "product_state_id": str(uuid.uuid4()),
            "indicator_id": str(uuid.uuid4()),
            "result_schema": "DECIMAL",
            "unit_id": "kg",
            "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
            "source": {"name": "методика"},
            "version": 1,
        }
        denied = await http.post("/api/v1/catalogs/methods", json=payload, headers=_csrf_headers(env))
        assert denied.status_code == 403, denied.text


@pytest.mark.integration
async def test_decimal_never_floats_in_snapshot(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species, state, indicator = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    env.db.add(_rule(env.lab.id, species, state, indicator))
    env.db.add(_tariff(env.lab.id, species, str(indicator), "0.10"))
    await env.db.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(env.db),
        _vse_request(
            env.lab.id,
            species,
            state,
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True})],
            quantity="0.3",
        ),
        None,
    )
    # 0.3 × 0.10 = 0.030 exactly in Decimal; a float path would give 0.030000000000000002.
    assert Decimal(snapshot.lines[0].amount) == Decimal("0.03")
    assert isinstance(snapshot.lines[0].amount, str)
