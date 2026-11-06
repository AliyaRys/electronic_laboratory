"""User administration, delegation and profile acceptance tests (Task I03).

Named plan tests (Review Focus):

- ``test_parallel_duplicate_login`` — exactly one 201 and one 409;
- ``test_cannot_delegate_republic_analyst`` — 403 and no record created;
- ``test_parallel_last_admin_delete`` — at least one empowered admin remains;
- ``test_linked_user_delete_blocked`` (AT-24) — 409, blocking works, the authored
  records keep their author;
- ``test_history_redacts_passwords`` — no password plaintext/hash in history and
  a no-op update creates no event.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import async_session
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.bootstrap import run_bootstrap
from backend.src.modules.identity.models import (
    DelegationGrant,
    Laboratory,
    Territory,
    User,
    UserEvent,
    UserRole,
    UserScope,
)
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

ADMIN_PASSWORD = "correct horse battery"
NEW_PASSWORD = "brand-new-secret-123"


@asynccontextmanager
async def _client_for(env: SimpleNamespace):
    """A client whose requests each use an independent database session."""
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.engine, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[async_session] = request_session
    app.dependency_overrides[get_session_transport] = lambda: env.transport
    app.dependency_overrides[get_authorizer] = lambda: env.authorizer
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield http
    finally:
        for key in (async_session, get_session_transport, get_authorizer):
            app.dependency_overrides.pop(key, None)


@pytest.fixture
async def admin_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A bootstrap-like administrator delegated over one district."""
    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="users")
    authorizer = Authorizer(InMemoryDecisionEngine())
    root = Territory(name="Республика Татарстан")
    district = Territory(name="Первый район", parent_id=root.id)
    foreign = Territory(name="Другой район", parent_id=root.id)
    db_session.add_all([root, district, foreign])
    await db_session.flush()
    own_lab = Laboratory(territory_id=district.id, name="Своя лаборатория", address="ул. Первая, 1", organization="ГБУ")
    foreign_lab = Laboratory(
        territory_id=foreign.id, name="Другая лаборатория", address="ул. Вторая, 2", organization="ГБУ"
    )
    db_session.add_all([own_lab, foreign_lab])
    await db_session.flush()
    product = uuid.uuid4()
    chief = User(
        login="chief",
        full_name="Главный администратор",
        email="chief@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    vet = User(
        login="vetuser",
        full_name="Ветеринарный врач",
        email="vet@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([chief, vet])
    await db_session.flush()
    db_session.add_all(
        [
            DelegationGrant(
                grantor_id=chief.id,
                target_id=chief.id,
                role=UserRole.ADMIN,
                territory_id=district.id,
                may_delegate=True,
            ),
            UserScope(user_id=vet.id, laboratory_id=own_lab.id, product_scope_id=product),
            # A record authored by the vet: the author must survive a block.
            UserEvent(target_user_id=chief.id, actor_id=vet.id, action="seed", changed_fields={}),
        ]
    )
    await db_session.commit()
    yield SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=transport,
        authorizer=authorizer,
        root=root,
        district=district,
        foreign=foreign,
        own_lab=own_lab,
        foreign_lab=foreign_lab,
        product=product,
        chief=chief,
        vet=vet,
    )


async def _login(client: AsyncClient, login: str = "chief", password: str = ADMIN_PASSWORD) -> AsyncClient:
    token = str((await client.get("/api/v1/auth/csrf")).json()["csrf_token"])
    response = await client.post(
        "/api/v1/auth/login",
        json={"login": login, "password": password},
        headers={"Origin": "http://test", "X-CSRF-Token": token},
    )
    assert response.status_code == 200, response.text
    return client


async def _login_response(client: AsyncClient, login: str, password: str) -> AsyncClient:
    token = str((await client.get("/api/v1/auth/csrf")).json()["csrf_token"])
    return await client.post(
        "/api/v1/auth/login",
        json={"login": login, "password": password},
        headers={"Origin": "http://test", "X-CSRF-Token": token},
    )


def _csrf(token: str) -> dict[str, str]:
    return {"Origin": "http://test", "X-CSRF-Token": token}


def _write(
    login: str,
    *,
    lab: uuid.UUID,
    product: uuid.UUID | None,
    role: str = "VET",
    password: str | None = NEW_PASSWORD,
    **extra: object,
) -> dict[str, object]:
    scope: dict[str, object] = {"laboratory_id": str(lab)}
    if product is not None:
        scope["product_scope_id"] = str(product)
    body: dict[str, object] = {
        "full_name": "Новый сотрудник",
        "login": login,
        "email": f"{login}@example.test",
        "role": role,
        "scopes": [scope],
    }
    if password is not None:
        body["password"] = password
        body["confirmation"] = password
    body.update(extra)
    return body


async def _count_users(db: AsyncSession, login: str) -> int:
    result = await db.execute(select(func.count()).select_from(User).where(User.login == login))
    return int(result.scalar_one())


# --- Review Focus: two parallel creations of one login -------------------------


async def test_parallel_duplicate_login(admin_env: SimpleNamespace) -> None:
    payload = _write("parallel-login", lab=admin_env.own_lab.id, product=admin_env.product)
    async with _client_for(admin_env) as first, _client_for(admin_env) as second:
        await _login(first)
        await _login(second)
        csrf_one = first.cookies.get("vse_csrf", "")
        csrf_two = second.cookies.get("vse_csrf", "")
        headers_one = {**_csrf(csrf_one), "Idempotency-Key": "create-1"}
        headers_two = {**_csrf(csrf_two), "Idempotency-Key": "create-2"}
        responses = await asyncio.gather(
            first.post("/api/v1/users", json=payload, headers=headers_one),
            second.post("/api/v1/users", json=payload, headers=headers_two),
        )
    statuses = sorted(item.status_code for item in responses)
    assert statuses == [201, 409], [item.text for item in responses]
    conflict = next(item for item in responses if item.status_code == 409)
    assert conflict.json()["code"] == "ALREADY_EXISTS"
    created = next(item for item in responses if item.status_code == 201)
    assert created.headers["location"] == f"/api/v1/users/{created.json()['id']}"
    assert await _count_users(admin_env.db, "parallel-login") == 1


# --- Review Focus: delegation stays inside the delegated territory -------------


async def test_cannot_delegate_republic_analyst(admin_env: SimpleNamespace) -> None:
    async with _client_for(admin_env) as http:
        await _login(http)
        payload = _write("republic-analyst", lab=admin_env.foreign_lab.id, product=None, role="ANALYST")
        response = await http.post(
            "/api/v1/users", json=payload, headers={**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "k"}
        )
        assert response.status_code == 403, response.text
        assert response.json()["code"] == "ACCESS_DENIED"
    assert await _count_users(admin_env.db, "republic-analyst") == 0
    grants = (await admin_env.db.execute(select(func.count()).select_from(DelegationGrant))).scalar_one()
    assert grants == 1, "делегирование не должно появиться"
    events = (await admin_env.db.execute(select(func.count()).select_from(UserEvent))).scalar_one()
    assert events == 1, "отклонённая команда не пишет историю"


# --- Review Focus: simultaneous deletion of the last administrators ------------


async def test_parallel_last_admin_delete(admin_env: SimpleNamespace) -> None:
    db = admin_env.db
    leaf = Territory(name="Отдалённый район", parent_id=admin_env.root.id)
    db.add(leaf)
    await db.flush()
    supervisor = User(
        login="supervisor",
        full_name="Супервизор",
        email="supervisor@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    admin_a = User(
        login="admin_a",
        full_name="Администратор А",
        email="a@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    admin_b = User(
        login="admin_b",
        full_name="Администратор Б",
        email="b@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    db.add_all([supervisor, admin_a, admin_b])
    await db.flush()
    db.add_all(
        [
            DelegationGrant(
                grantor_id=supervisor.id, target_id=supervisor.id, role=UserRole.ADMIN, territory_id=admin_env.root.id
            ),
            DelegationGrant(grantor_id=supervisor.id, target_id=admin_a.id, role=UserRole.ADMIN, territory_id=leaf.id),
            DelegationGrant(grantor_id=supervisor.id, target_id=admin_b.id, role=UserRole.ADMIN, territory_id=leaf.id),
        ]
    )
    await db.commit()
    target_a, target_b = admin_a.id, admin_b.id

    async with _client_for(admin_env) as first, _client_for(admin_env) as second:
        await _login(first, "supervisor")
        await _login(second, "supervisor")
        responses = await asyncio.gather(
            first.delete(
                f"/api/v1/users/{target_a}",
                headers={**_csrf(first.cookies.get("vse_csrf", "")), "Idempotency-Key": "del-1"},
            ),
            second.delete(
                f"/api/v1/users/{target_b}",
                headers={**_csrf(second.cookies.get("vse_csrf", "")), "Idempotency-Key": "del-2"},
            ),
        )
    statuses = sorted(item.status_code for item in responses)
    print("STATUS BODIES:", [item.text for item in responses])
    remaining_logins = (await db.execute(select(User.login).where(User.role == UserRole.ADMIN))).scalars().all()
    print("REMAINING ADMINS:", sorted(remaining_logins))
    assert statuses == [204, 409], [item.text for item in responses]
    conflict = next(item for item in responses if item.status_code == 409)
    assert conflict.json()["code"] == "LAST_ADMIN"

    # At least one empowered administrator of the district remains.
    empowered = (
        await db.execute(
            select(func.count())
            .select_from(DelegationGrant)
            .join(User, User.id == DelegationGrant.target_id)
            .where(DelegationGrant.territory_id == leaf.id, User.active.is_(True))
        )
    ).scalar_one()
    assert empowered >= 1
    admins_total = (
        await db.execute(select(func.count()).select_from(User).where(User.role == UserRole.ADMIN))
    ).scalar_one()
    assert admins_total == 3, "удалён ровно один из последних администраторов района (chief+supervisor остаются)"


# --- AT-24: linked user cannot be deleted, can be blocked ----------------------


async def test_linked_user_delete_blocked(admin_env: SimpleNamespace) -> None:
    db = admin_env.db
    async with _client_for(admin_env) as http:
        await _login(http)
        auth = _csrf(http.cookies.get("vse_csrf", ""))
        deleted = await http.delete(f"/api/v1/users/{admin_env.vet.id}", headers={**auth, "Idempotency-Key": "del-vet"})
        assert deleted.status_code == 409, deleted.text
        assert deleted.json()["code"] == "USER_HAS_REFERENCES"

        current = await http.get(f"/api/v1/users/{admin_env.vet.id}")
        assert current.status_code == 200
        etag = current.headers["etag"]
        blocked = await http.post(
            f"/api/v1/users/{admin_env.vet.id}/block", json={}, headers={**auth, "If-Match": etag}
        )
        assert blocked.status_code == 200, blocked.text
        assert blocked.json()["active"] is False

    await db.refresh(admin_env.vet)
    assert admin_env.vet.active is False
    scope = (await db.execute(select(UserScope).where(UserScope.user_id == admin_env.vet.id))).scalar_one_or_none()
    assert scope is not None, "назначение автора остаётся на месте"
    authorship = (
        await db.execute(
            select(UserEvent).where(UserEvent.target_user_id == admin_env.chief.id, UserEvent.action == "seed")
        )
    ).scalar_one()
    assert authorship.actor_id == admin_env.vet.id, "автор записи прежний после блокировки"

    async with _client_for(admin_env) as http:
        rejected = await _login_response(http, "vetuser", ADMIN_PASSWORD)
        assert rejected.status_code == 403
        assert rejected.json()["code"] == "ACCOUNT_BLOCKED"


# --- Review Focus: history never contains passwords or hashes ------------------


async def test_history_redacts_passwords(admin_env: SimpleNamespace) -> None:
    old_hash = admin_env.vet.password_hash
    async with _client_for(admin_env) as http:
        await _login(http)
        csrf = _csrf(http.cookies.get("vse_csrf", ""))
        reset = await http.post(
            f"/api/v1/users/{admin_env.vet.id}/reset-password",
            json={"new_password": NEW_PASSWORD, "confirmation": NEW_PASSWORD},
            headers={**csrf, "If-Match": '"1"'},
        )
        assert reset.status_code == 204, reset.text

        history = await http.get(f"/api/v1/users/{admin_env.vet.id}/history")
        assert history.status_code == 200, history.text
        items = history.json()["items"]
        assert any(item["action"] == "reset-password" for item in items)
        dump = json.dumps(items, ensure_ascii=False)
        assert ADMIN_PASSWORD not in dump
        assert NEW_PASSWORD not in dump
        assert "$argon2" not in dump
        assert old_hash not in dump
        event = next(item for item in items if item["action"] == "reset-password")
        assert set(event["changed_fields"]) == {"password_hash"}
        assert event["changed_fields"]["password_hash"] != old_hash

        # Reset does not change active or scopes.
        view = (await http.get(f"/api/v1/users/{admin_env.vet.id}")).json()
        assert view["active"] is True
        assert len(view["scopes"]) == 1
        assert view["revision"] == 2

        # A no-op update creates no event and does not bump the revision.
        payload = _write("vetuser", lab=admin_env.own_lab.id, product=admin_env.product, password=None)
        payload["full_name"] = view["full_name"]
        payload["email"] = view["email"]
        payload["position"] = view["position"]
        noop = await http.put(f"/api/v1/users/{admin_env.vet.id}", json=payload, headers={**csrf, "If-Match": '"2"'})
        assert noop.status_code == 200, noop.text
        assert noop.json()["revision"] == 2
        history_after = (await http.get(f"/api/v1/users/{admin_env.vet.id}/history")).json()
        assert len(history_after["items"]) == len(items)


# --- CRUD, ETag, scope listing and foreign UUID hiding -------------------------


async def test_user_lifecycle_crud(admin_env: SimpleNamespace) -> None:
    db = admin_env.db
    async with _client_for(admin_env) as http:
        await _login(http)
        auth = _csrf(http.cookies.get("vse_csrf", ""))

        created = await http.post(
            "/api/v1/users",
            json=_write("new-head", lab=admin_env.own_lab.id, product=None, role="HEAD"),
            headers={**auth, "Idempotency-Key": "k-head"},
        )
        assert created.status_code == 201, created.text
        assert created.headers["location"].startswith("/api/v1/users/")
        assert created.headers["etag"] == '"1"'
        head_id = uuid.UUID(str(created.json()["id"]))

        analyst = await http.post(
            "/api/v1/users",
            json=_write("new-analyst", lab=admin_env.own_lab.id, product=None, role="ANALYST"),
            headers={**auth, "Idempotency-Key": "k-analyst"},
        )
        assert analyst.status_code == 201, analyst.text

        listed = await http.get("/api/v1/users", params={"role": "HEAD", "q": "новый"})
        assert listed.status_code == 200
        assert listed.json()["total"] == 1
        assert listed.json()["items"][0]["login"] == "new-head"

        viewed = await http.get(f"/api/v1/users/{head_id}")
        assert viewed.status_code == 200
        assert viewed.headers["etag"] == '"1"'

        stale = await http.put(
            f"/api/v1/users/{head_id}",
            json=_write(
                "new-head", lab=admin_env.own_lab.id, product=None, role="HEAD", position="Старший", password=None
            ),
            headers={**auth, "If-Match": '"999"'},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "REVISION_CONFLICT"

        updated = await http.put(
            f"/api/v1/users/{head_id}",
            json=_write(
                "new-head", lab=admin_env.own_lab.id, product=None, role="HEAD", position="Старший", password=None
            ),
            headers={**auth, "If-Match": '"1"'},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 2
        assert updated.headers["etag"] == '"2"'
        assert updated.json()["position"] == "Старший"

        unlinked = await http.put(
            f"/api/v1/users/{head_id}",
            json=_write("new-head", lab=admin_env.own_lab.id, product=None, role="HEAD", scopes=[], password=None),
            headers={**auth, "If-Match": '"2"'},
        )
        assert unlinked.status_code == 200, unlinked.text

        removed = await http.delete(f"/api/v1/users/{head_id}", headers={**auth, "Idempotency-Key": "k-del"})
        assert removed.status_code == 204, removed.text
        assert (await http.get(f"/api/v1/users/{head_id}")).status_code == 404

    assert await _count_users(db, "new-head") == 0, "несвязанный пользователь удаляется физически"


async def test_foreign_uuid_is_hidden(admin_env: SimpleNamespace) -> None:
    stranger = uuid.uuid4()
    async with _client_for(admin_env) as http:
        await _login(http)
        auth = _csrf(http.cookies.get("vse_csrf", ""))
        assert (await http.get(f"/api/v1/users/{stranger}")).status_code == 404
        put = await http.put(
            f"/api/v1/users/{stranger}",
            json=_write("x", lab=admin_env.own_lab.id, product=None, password=None),
            headers={**auth, "If-Match": '"1"'},
        )
        assert put.status_code == 404
        deleted = await http.delete(f"/api/v1/users/{stranger}", headers={**auth, "Idempotency-Key": "k"})
        assert deleted.status_code == 404
        history = await http.get(f"/api/v1/users/{stranger}/history")
        assert history.status_code == 404


# --- Self-escalation is forbidden; role issuance stays in delegation -----------


async def test_self_protection_and_role_issuance(admin_env: SimpleNamespace) -> None:
    async with _client_for(admin_env) as http:
        await _login(http)
        auth = _csrf(http.cookies.get("vse_csrf", ""))

        self_delete = await http.delete(
            f"/api/v1/users/{admin_env.chief.id}", headers={**auth, "Idempotency-Key": "k-self"}
        )
        assert self_delete.status_code == 409
        assert self_delete.json()["code"] == "SELF_DELETE_FORBIDDEN"

        escalated = await http.put(
            f"/api/v1/users/{admin_env.chief.id}",
            json=_write("chief", lab=admin_env.own_lab.id, product=None, role="HEAD", password=None),
            headers={**auth, "If-Match": '"1"'},
        )
        assert escalated.status_code == 403, escalated.text

        new_admin = await http.post(
            "/api/v1/users",
            json=_write("api-admin", lab=admin_env.own_lab.id, product=None, role="ADMIN"),
            headers={**auth, "Idempotency-Key": "k-admin"},
        )
        assert new_admin.status_code == 403, new_admin.text
        assert await _count_users(admin_env.db, "api-admin") == 0

        head_created = await http.post(
            "/api/v1/users",
            json=_write("managing-head", lab=admin_env.own_lab.id, product=None, role="HEAD"),
            headers={**auth, "Idempotency-Key": "k-head-2"},
        )
        assert head_created.status_code == 201, head_created.text

    async with _client_for(admin_env) as http:
        await _login(http, "managing-head", NEW_PASSWORD)
        denied = await http.get("/api/v1/users")
        assert denied.status_code == 403
        denied_view = await http.get(f"/api/v1/users/{admin_env.vet.id}")
        assert denied_view.status_code == 403


# --- Viewing another user never changes the current one ------------------------


async def test_me_unchanged_when_viewing_other(admin_env: SimpleNamespace) -> None:
    async with _client_for(admin_env) as http:
        await _login(http)
        before = (await http.get("/api/v1/me")).json()
        other = await http.get(f"/api/v1/users/{admin_env.vet.id}")
        assert other.status_code == 200
        assert other.json()["id"] == str(admin_env.vet.id)
        after = (await http.get("/api/v1/me")).json()
        assert after == before, "текущий пользователь не меняется при просмотре другого"
        contexts = (await http.get("/api/v1/contexts")).json()
        assert contexts == [
            {"laboratory_id": None, "product_scope_id": None, "territory_id": str(admin_env.district.id)}
        ]


# --- Bootstrap issues the initial delegation (OPS-01) --------------------------


async def test_bootstrap_grants_initial_delegation(db_session: AsyncSession) -> None:
    user = await run_bootstrap(
        db_session,
        login="boot-admin",
        full_name="Bootstrap",
        email="boot@example.test",
        password=ADMIN_PASSWORD,
        confirmation=ADMIN_PASSWORD,
    )
    grant = (await db_session.execute(select(DelegationGrant).where(DelegationGrant.target_id == user.id))).scalar_one()
    assert grant.may_delegate is True
    assert grant.role == UserRole.ADMIN
    territory = await db_session.get(Territory, grant.territory_id)
    assert territory is not None and territory.parent_id is None
    with pytest.raises(Exception, match="не пуст"):
        await run_bootstrap(
            db_session,
            login="second",
            full_name="Second",
            email="second@example.test",
            password=ADMIN_PASSWORD,
            confirmation=ADMIN_PASSWORD,
        )
