"""A01 API tests (API-04): scoped list semantics, hide, honest sync."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import async_session
from backend.src.modules.arrivals import commands
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.tests.arrivals.test_import_and_queues import document
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

PLAYER = "correct horse battery"


@asynccontextmanager
async def _client_for(env: SimpleNamespace):
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.engine, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[async_session] = request_session
    app.dependency_overrides[get_session_transport] = lambda: env.transport
    app.dependency_overrides[get_authorizer] = lambda: env.authorizer
    try:
        identity = await env.transport.create(env.vet.id)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            http.cookies.set(SessionTransport.COOKIE_NAME, identity.session_id)
            http.cookies.set(SessionTransport.CSRF_COOKIE_NAME, identity.csrf_token)
            yield http, identity
    finally:
        app.dependency_overrides.pop(async_session, None)
        app.dependency_overrides.pop(get_session_transport, None)
        app.dependency_overrides.pop(get_authorizer, None)


@pytest.fixture
async def vet_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="arrivals")
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    own = Laboratory(territory_id=territory.id, name="Своя лаборатория", address="ул. Первая, 1", organization="ГБУ")
    foreign = Laboratory(
        territory_id=territory.id, name="Чужая лаборатория", address="ул. Вторая, 2", organization="ГБУ"
    )
    db_session.add_all([own, foreign])
    vet = User(
        login="arrvet",
        full_name="Ветеринарный врач",
        email="arr@example.test",
        password_hash=PLAYER,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(vet)
    await db_session.flush()
    db_session.add(UserScope(user_id=vet.id, laboratory_id=own.id, product_scope_id=uuid.uuid4()))
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=transport,
        authorizer=Authorizer(InMemoryDecisionEngine()),
        csrf="csrf-token",
        own=own,
        foreign=foreign,
        vet=vet,
    )


async def test_arrival_list_is_scoped_paged_and_searchable(vet_env: SimpleNamespace) -> None:
    env = vet_env
    for index in range(22):
        await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id, issue_number=f"A-0{index:05d}"))
    await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.foreign.id, issue_number="B-000001"))
    await env.db.commit()

    async with _client_for(env) as (http, identity):
        scoped = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED"})
        assert scoped.status_code == 200
        page_one = scoped.json()
        assert page_one["total"] == 22 and len(page_one["items"]) == 20
        assert page_one["page_size"] == 20
        # Stable ordering: created_at DESC / id DESC.
        page_two = (
            await http.get(
                "/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "page": 2}
            )
        ).json()
        assert page_two["total"] == 22 and len(page_two["items"]) == 2
        ids = [item["party_id"] for item in page_one["items"]]
        assert len(set(ids)) == 20
        assert not set(ids) & {item["party_id"] for item in page_two["items"]}

        # Search within the scope only.
        found = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "q": "A-000007"})
        assert found.json()["total"] == 1
        foreign_hit = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "q": "B-000001"})
        assert foreign_hit.json()["total"] == 0

        # A foreign laboratory is refused before any data is read.
        denied = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.foreign.id)})
        assert denied.status_code == 403
        assert denied.json()["code"] == "ACCESS_DENIED"


async def test_hide_endpoint_and_honest_sync(vet_env: SimpleNamespace) -> None:
    env = vet_env
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()

    async with _client_for(env) as (http, identity):
        # The sync button is honest: the disabled adapter answers 503.
        sync = await http.post(
            "/api/v1/arrivals/sync",
            json={"laboratory_id": str(env.own.id)},
            headers={"x-csrf-token": identity.csrf_token, "origin": "http://test"},
        )
        assert sync.status_code == 503, sync.text
        assert sync.json()["code"] == "INTEGRATION_NOT_CONFIGURED"

        hidden = await http.delete(
            f"/api/v1/arrivals/{party.id}",
            headers={
                "x-csrf-token": identity.csrf_token,
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert hidden.status_code == 204

        after = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED"})
        assert after.json()["total"] == 0


async def test_hide_requires_current_if_match(vet_env: SimpleNamespace) -> None:
    """SPEC-04: missing If-Match → 422 REVISION_REQUIRED, stale → 409 conflict."""
    env = vet_env
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()

    async with _client_for(env) as (http, identity):
        base_headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
        }

        missing = await http.delete(f"/api/v1/arrivals/{party.id}", headers=base_headers)
        assert missing.status_code == 422
        assert missing.json()["code"] == "REVISION_REQUIRED"

        stale = await http.delete(f"/api/v1/arrivals/{party.id}", headers={**base_headers, "if-match": '"9"'})
        assert stale.status_code == 409
        assert stale.json()["code"] == "REVISION_CONFLICT"

        still_there = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED"})
        assert still_there.json()["total"] == 1

        # The correct If-Match hides the arrival; an idempotent repeat with the
        # same command key still answers 204 (API-01 replay semantics).
        hidden = await http.delete(f"/api/v1/arrivals/{party.id}", headers={**base_headers, "if-match": '"1"'})
        assert hidden.status_code == 204
        repeat = await http.delete(f"/api/v1/arrivals/{party.id}", headers={**base_headers, "if-match": '"1"'})
        assert repeat.status_code == 204
        after = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED"})
        assert after.json()["total"] == 0


async def test_disabled_vetis_adapter_problem() -> None:
    """The disabled adapter raises the stable 503 INTEGRATION_NOT_CONFIGURED."""
    from backend.src.core.problems import ProblemError
    from backend.src.modules.integrations.vetis.contracts import VetisScope

    adapter = __import__(
        "backend.src.modules.integrations.vetis.ports", fromlist=["DisabledVetisAdapter"]
    ).DisabledVetisAdapter()

    with pytest.raises(ProblemError) as raised:
        await adapter.list_incoming(VetisScope(laboratory_id=uuid.uuid4(), contour="PILOT"), None, "")  # type: ignore[arg-type]
    assert raised.value.status == 503
    assert raised.value.code == "INTEGRATION_NOT_CONFIGURED"
