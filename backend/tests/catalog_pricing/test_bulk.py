"""Bulk price jobs (Task C02): scope prevalidation, partial retry, independence.

Named plan tests:

- ``test_scope_prevalidation`` — one foreign laboratory among the targets makes
  the WHOLE command 403 ACCESS_DENIED with zero rows written;
- ``test_partial_retry`` — retry re-applies only the FAILED targets with the
  original intent and a new command key; SUCCEEDED targets are never repeated;
- ``test_independent_lab_prices`` — after a bulk run A=B=100, editing A to 150
  leaves B at 100: no laboratory inheritance (AT-21/SC-096).
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import backend.src.modules.catalog_pricing.bulk as bulk
from backend.src.core.database import async_session
from backend.src.modules.catalog_pricing.models import BulkPriceJob, BulkPriceTarget, Tariff
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.models import (
    CommandRecord,
    DelegationGrant,
    Laboratory,
    Territory,
    User,
    UserRole,
    UserScope,
)
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

PASSWORD = "correct horse battery"
SPECIES = uuid.uuid4()


# --- seed helpers -----------------------------------------------------------------


async def _seed_analyst(db: AsyncSession) -> SimpleNamespace:
    """One district with two laboratories; an ANALYST scoped to lab A only."""
    root = Territory(name="Республика Татарстан")
    district = Territory(name="Первый район", parent_id=root.id)
    db.add_all([root, district])
    await db.flush()
    lab_a = Laboratory(territory_id=district.id, name="Лаборатория А", address="ул. А, 1", organization="ГБУ")
    lab_b = Laboratory(territory_id=district.id, name="Лаборатория Б", address="ул. Б, 2", organization="ГБУ")
    db.add_all([lab_a, lab_b])
    await db.flush()
    analyst = User(
        login="analyst",
        full_name="Аналитик Аналитиков",
        email="analyst@example.test",
        password_hash=hash_password(PASSWORD),
        role=UserRole.ANALYST,
        active=True,
    )
    db.add(analyst)
    await db.flush()
    db.add(UserScope(user_id=analyst.id, laboratory_id=lab_a.id, product_scope_id=SPECIES))
    await db.commit()
    return SimpleNamespace(db=db, lab_a=lab_a, lab_b=lab_b, analyst=analyst, user=analyst, district=district)


async def _seed_admin(db: AsyncSession) -> SimpleNamespace:
    """One district with three laboratories; an ADMIN delegated over it."""
    root = Territory(name="Республика Татарстан")
    district = Territory(name="Второй район", parent_id=root.id)
    db.add_all([root, district])
    await db.flush()
    labs = [
        Laboratory(territory_id=district.id, name=name, address=f"ул. {name}, 1", organization="ГБУ")
        for name in ("Альфа", "Бета", "Гамма")
    ]
    db.add_all(labs)
    await db.flush()
    admin = User(
        login="chief",
        full_name="Администратор Административный",
        email="chief@example.test",
        password_hash=hash_password(PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    db.add(admin)
    await db.flush()
    db.add(DelegationGrant(grantor_id=admin.id, target_id=admin.id, role=UserRole.ADMIN, territory_id=district.id))
    await db.commit()
    return SimpleNamespace(db=db, labs=labs, admin=admin, user=admin, district=district)


# --- HTTP harness (the test_pricing.py pattern) ------------------------------------


@asynccontextmanager
async def _client_for(env: SimpleNamespace):
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.db.bind, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="bulk")
    app.dependency_overrides[async_session] = request_session
    app.dependency_overrides[get_session_transport] = lambda: transport
    app.dependency_overrides[get_authorizer] = lambda: Authorizer(InMemoryDecisionEngine())
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            token = str((await http.get("/api/v1/auth/csrf")).json()["csrf_token"])
            response = await http.post(
                "/api/v1/auth/login",
                json={"login": env.user.login, "password": PASSWORD},
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


def _bulk_payload(lab_ids: list[uuid.UUID], price: str = "100.00") -> dict[str, object]:
    return {
        "laboratory_ids": [str(item) for item in lab_ids],
        "product_species_id": str(SPECIES),
        "service_code": "trichinelloscopy",
        "unit_id": "kg",
        "price": price,
    }


async def _tariffs(db: AsyncSession) -> dict[uuid.UUID, Tariff]:
    db.expire_all()  # the identity map must not serve stale attribute values
    rows = (await db.execute(select(Tariff).order_by(Tariff.laboratory_id))).scalars().all()
    return {row.laboratory_id: row for row in rows}


# --- named tests -------------------------------------------------------------------


@pytest.mark.integration
async def test_scope_prevalidation(db_session: AsyncSession) -> None:
    """One foreign laboratory among the targets → whole command 403, zero writes."""
    env = await _seed_analyst(db_session)
    async with _client_for(env) as http:
        response = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([env.lab_a.id, env.lab_b.id]),
            headers=_csrf_headers(env),
        )
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "ACCESS_DENIED"
        # Nothing at all was written: no job, no targets, no tariff rows.
        assert (await db_session.execute(select(BulkPriceJob))).scalars().all() == []
        assert (await db_session.execute(select(BulkPriceTarget))).scalars().all() == []
        assert (await db_session.execute(select(Tariff))).scalars().all() == []

        # The same list scoped to the allowed laboratory alone succeeds.
        ok = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([env.lab_a.id]),
            headers=_csrf_headers(env),
        )
        assert ok.status_code == 202, ok.text
        body = ok.json()
        assert set(body) == {"operation_id", "state", "status_url"}


@pytest.mark.integration
async def test_partial_retry(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry re-applies only FAILED targets; SUCCEEDED targets are never repeated."""
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        lab_a, lab_b, lab_c = (item.id for item in env.labs)
        created = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([lab_a, lab_b, lab_c]),
            headers=_csrf_headers(env),
        )
        assert created.status_code == 202, created.text
        assert created.json()["state"] == "COMPLETED"  # nothing fails yet

        # Lab C's application fails inside its own transaction; A and B commit.
        real_upsert = bulk.upsert_tariff

        async def failing_upsert(db: AsyncSession, intent: bulk.BulkPriceWrite, laboratory_id: uuid.UUID) -> None:
            if laboratory_id == lab_c:
                raise RuntimeError("injected laboratory failure")
            await real_upsert(db, intent, laboratory_id)

        monkeypatch.setattr(bulk, "upsert_tariff", failing_upsert)
        failed_run = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([lab_a, lab_b, lab_c]),
            headers=_csrf_headers(env),
        )
        assert failed_run.status_code == 202, failed_run.text
        job_id = uuid.UUID(failed_run.json()["operation_id"])

        detail = await http.get(f"/api/v1/catalogs/bulk-prices/{job_id}")
        assert detail.status_code == 200, detail.text
        states = {item["lab_id"]: item["state"] for item in detail.json()["targets"]}
        assert states[str(lab_a)] == "SUCCEEDED"
        assert states[str(lab_b)] == "SUCCEEDED"
        assert states[str(lab_c)] == "FAILED"
        assert detail.json()["state"] == "PARTIAL"

        revs_before = {lab: row.rev for lab, row in (await _tariffs(db_session)).items()}

        # Retry with the original intent and a NEW command key.
        monkeypatch.setattr(bulk, "upsert_tariff", real_upsert)
        retry = await http.post(f"/api/v1/catalogs/bulk-prices/{job_id}/retry", headers=_csrf_headers(env))
        assert retry.status_code == 202, retry.text

        detail = await http.get(f"/api/v1/catalogs/bulk-prices/{job_id}")
        states = {item["lab_id"]: item["state"] for item in detail.json()["targets"]}
        assert states[str(lab_c)] == "SUCCEEDED"
        assert detail.json()["state"] == "COMPLETED"

        # A and B were not re-applied: their revisions are untouched.
        tariffs = await _tariffs(db_session)
        for lab in (lab_a, lab_b):
            assert tariffs[lab].rev == revs_before[lab]
        assert tariffs[lab_c].price == Decimal("100.00")

        # A second retry with nothing failed re-applies nobody.
        revs_before = {lab: row.rev for lab, row in tariffs.items()}
        again = await http.post(f"/api/v1/catalogs/bulk-prices/{job_id}/retry", headers=_csrf_headers(env))
        assert again.status_code == 202, again.text
        tariffs_after = await _tariffs(db_session)
        for lab in (lab_a, lab_b, lab_c):
            assert tariffs_after[lab].rev == revs_before[lab]


@pytest.mark.integration
async def test_independent_lab_prices(db_session: AsyncSession) -> None:
    """After bulk A=B=100, editing A to 150 leaves B at 100 (no inheritance)."""
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        lab_a, lab_b = env.labs[0].id, env.labs[1].id
        created = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([lab_a, lab_b], price="100.00"),
            headers=_csrf_headers(env),
        )
        assert created.status_code == 202, created.text
        tariffs = await _tariffs(db_session)
        assert tariffs[lab_a].price == Decimal("100.00")
        assert tariffs[lab_b].price == Decimal("100.00")

        # Edit A's tariff directly (a plain editor write, If-Match guarded).
        edit = await http.put(
            f"/api/v1/catalogs/tariffs/{tariffs[lab_a].id}",
            json={
                "laboratory_id": str(lab_a),
                "product_species_id": str(SPECIES),
                "service_code": "trichinelloscopy",
                "unit_id": "kg",
                "price": "150.00",
                "version": tariffs[lab_a].version,
                "source": {"name": "прейскурант"},
            },
            headers={**_csrf_headers(env), "If-Match": f'"{tariffs[lab_a].rev}"'},
        )
        assert edit.status_code == 200, edit.text

        tariffs = await _tariffs(db_session)
        assert tariffs[lab_a].price == Decimal("150.00")
        assert tariffs[lab_b].price == Decimal("100.00")


# --- rights matrix, contract details ------------------------------------------------


@pytest.mark.integration
async def test_head_role_forbidden_on_bulk(db_session: AsyncSession) -> None:
    """catalog:bulk-price is ADMIN/ANALYST only (permissions.md): HEAD → 403."""
    env = await _seed_admin(db_session)
    head = User(
        login="head",
        full_name="Заведующий Главный",
        email="head@example.test",
        password_hash=hash_password(PASSWORD),
        role=UserRole.HEAD,
        active=True,
    )
    db_session.add(head)
    await db_session.flush()
    db_session.add(UserScope(user_id=head.id, laboratory_id=env.labs[0].id, product_scope_id=SPECIES))
    await db_session.commit()
    env.user = head
    async with _client_for(env) as http:
        response = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([env.labs[0].id]),
            headers=_csrf_headers(env),
        )
        assert response.status_code == 403
        assert response.json()["code"] == "ACCESS_DENIED"


@pytest.mark.integration
async def test_bulk_requires_idempotency_key(db_session: AsyncSession) -> None:
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        response = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([env.labs[0].id]),
            headers={"Origin": "http://test", "X-CSRF-Token": env.csrf},
        )
        assert response.status_code == 422
        assert response.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED"


@pytest.mark.integration
async def test_bulk_replay_returns_same_job(db_session: AsyncSession) -> None:
    """The same Idempotency-Key replays the same outcome without new writes."""
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        headers = _csrf_headers(env)
        first = await http.post("/api/v1/catalogs/bulk-prices", json=_bulk_payload([env.labs[0].id]), headers=headers)
        assert first.status_code == 202
        replay = await http.post("/api/v1/catalogs/bulk-prices", json=_bulk_payload([env.labs[0].id]), headers=headers)
        assert replay.status_code == 202
        assert replay.json()["operation_id"] == first.json()["operation_id"]
        assert replay.json()["state"] == first.json()["state"]


@pytest.mark.integration
async def test_job_get_and_operations_state(db_session: AsyncSession) -> None:
    """GET job → targets detail; GET /operations/:id → CommandState (API-01)."""
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        created = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([env.labs[0].id, env.labs[1].id]),
            headers=_csrf_headers(env),
        )
        assert created.status_code == 202, created.text
        operation_id = created.json()["operation_id"]
        assert created.json()["status_url"] == f"/api/v1/operations/{operation_id}"
        assert created.json()["state"] == "COMPLETED"

        state = await http.get(f"/api/v1/operations/{operation_id}")
        assert state.status_code == 200, state.text
        command_state = state.json()
        assert command_state["kind"] == "catalog"
        assert command_state["state"] == "SUCCESS"
        assert command_state["result_id"] is not None

        detail = await http.get(f"/api/v1/catalogs/bulk-prices/{command_state['result_id']}")
        assert detail.status_code == 200
        assert detail.json()["state"] == "COMPLETED"
        assert [item["state"] for item in detail.json()["targets"]] == ["SUCCEEDED", "SUCCEEDED"]

        # A different actor has no right to read this job.
        stranger = User(
            login="stranger",
            full_name="Чужой Администратор",
            email="stranger@example.test",
            password_hash=hash_password(PASSWORD),
            role=UserRole.ADMIN,
            active=True,
        )
        db_session.add(stranger)
        await db_session.flush()
        db_session.add(
            DelegationGrant(
                grantor_id=stranger.id, target_id=stranger.id, role=UserRole.ADMIN, territory_id=env.district.id
            )
        )
        await db_session.commit()
        env.user = stranger
        async with _client_for(env) as stranger_http:
            foreign_job = await stranger_http.get(f"/api/v1/catalogs/bulk-prices/{command_state['result_id']}")
            assert foreign_job.status_code == 403
            foreign_operation = await stranger_http.get(f"/api/v1/operations/{operation_id}")
            assert foreign_operation.status_code == 403


@pytest.mark.integration
async def test_operations_state_deterministic_after_retry(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """GET /operations/:id stays 200 after a retry (no MultipleResultsFound 500).

    The create record and the retry record share the same result_id; the
    status URL must resolve to the job's current outcome in both phases.
    """
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        lab_a, lab_b = (item.id for item in env.labs[:2])
        lab_c = env.labs[2].id

        # Phase 1: the create command with one failing target.
        real_upsert = bulk.upsert_tariff

        async def failing_upsert(db: AsyncSession, intent: bulk.BulkPriceWrite, laboratory_id: uuid.UUID) -> None:
            if laboratory_id == lab_c:
                raise RuntimeError("injected laboratory failure")
            await real_upsert(db, intent, laboratory_id)

        monkeypatch.setattr(bulk, "upsert_tariff", failing_upsert)
        failed_run = await http.post(
            "/api/v1/catalogs/bulk-prices",
            json=_bulk_payload([lab_a, lab_b, lab_c]),
            headers=_csrf_headers(env),
        )
        assert failed_run.status_code == 202, failed_run.text
        operation_id = failed_run.json()["operation_id"]

        state = await http.get(f"/api/v1/operations/{operation_id}")
        assert state.status_code == 200, state.text  # one record so far
        assert state.json()["state"] == "SUCCESS"  # the command itself succeeded (partial job)

        # Phase 2: retry creates a SECOND record with the same result_id.
        monkeypatch.setattr(bulk, "upsert_tariff", real_upsert)
        retry = await http.post(f"/api/v1/catalogs/bulk-prices/{operation_id}/retry", headers=_csrf_headers(env))
        assert retry.status_code == 202, retry.text

        state = await http.get(f"/api/v1/operations/{operation_id}")
        assert state.status_code == 200, state.text  # was a 500 before the fix
        command_state = state.json()
        assert command_state["result_id"] == operation_id
        detail = await http.get(f"/api/v1/catalogs/bulk-prices/{operation_id}")
        assert detail.status_code == 200
        assert detail.json()["state"] == "COMPLETED"  # the retried outcome is reflected

        # The resolution picked the retry record deterministically.
        records = (
            (await db_session.execute(select(CommandRecord).where(CommandRecord.result_id == uuid.UUID(operation_id))))
            .scalars()
            .all()
        )
        assert {record.action for record in records} == {
            "catalogs.bulk-prices",
            "catalogs.bulk-prices.retry",
        }


@pytest.mark.integration
async def test_retry_unknown_job_404(db_session: AsyncSession) -> None:
    env = await _seed_admin(db_session)
    async with _client_for(env) as http:
        response = await http.post(f"/api/v1/catalogs/bulk-prices/{uuid.uuid4()}/retry", headers=_csrf_headers(env))
        assert response.status_code == 404
