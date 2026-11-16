"""Delegated user creation from the users list (DR34, FT-ACC-09/FT-ADM-01).

Named plan tests (Review Focus):

- ``test_forged_role_and_territory_rejected`` — a forged role/territory UUID
  never creates a record;
- ``test_foreign_area_is_not_in_assignable_options`` — the scoped read endpoint
  hides every foreign laboratory/territory;
- ``test_created_admin_gets_grant_without_working_scopes`` — User + grant + event
  atomically, no UserScope for the actor or the target;
- ``test_same_idempotency_key_never_duplicates`` — one intent, one user;
- ``test_creation_history_has_no_password_or_hash``.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import (
    CommandRecord,
    DelegationGrant,
    Laboratory,
    Territory,
    User,
    UserEvent,
    UserRole,
    UserScope,
)
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.session import SessionTransport
from backend.tests.identity.test_sessions import MemoryRedis
from backend.tests.identity.test_users import (
    ADMIN_PASSWORD,
    NEW_PASSWORD,
    _client_for,
    _csrf,
    _login,
)

USER_PASSWORD = NEW_PASSWORD


@pytest.fixture
async def delegation_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A bootstrap-like ADMIN delegated over a district, plus foreign areas."""
    transport = SessionTransport(MemoryRedis(), prefix="dr34")
    authorizer = Authorizer(InMemoryDecisionEngine())
    root = Territory(name="Республика Татарстан")
    district = Territory(name="Первый район", parent_id=root.id)
    foreign = Territory(name="Чужой район", parent_id=root.id)
    db_session.add_all([root, district, foreign])
    await db_session.flush()
    own_lab = Laboratory(territory_id=district.id, name="Своя лаборатория", address="ул. Первая, 1", organization="ГБУ")
    other_own_lab = Laboratory(
        territory_id=district.id, name="Вторая своя лаборатория", address="ул. Третья, 3", organization="ГБУ"
    )
    foreign_lab = Laboratory(
        territory_id=foreign.id, name="Чужая лаборатория", address="ул. Вторая, 2", organization="ГБУ"
    )
    db_session.add_all([own_lab, other_own_lab, foreign_lab])
    await db_session.flush()
    chief = User(
        login="chief",
        full_name="Главный администратор",
        email="chief@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    restricted = User(
        login="restricted",
        full_name="Администратор без делегирования",
        email="restricted@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    db_session.add_all([chief, restricted])
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
            # An administrator WITHOUT the delegation right: he manages nothing.
            DelegationGrant(
                grantor_id=chief.id,
                target_id=restricted.id,
                role=UserRole.ADMIN,
                territory_id=district.id,
                may_delegate=False,
            ),
        ]
    )
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=transport,
        authorizer=authorizer,
        root=root,
        district=district,
        foreign=foreign,
        own_lab=own_lab,
        other_own_lab=other_own_lab,
        foreign_lab=foreign_lab,
        chief=chief,
        restricted=restricted,
    )


def _payload(
    login: str,
    *,
    role: str,
    lab: uuid.UUID | None = None,
    product: uuid.UUID | None = None,
    territory: uuid.UUID | None = None,
    scopes: list[dict[str, object]] | None = None,
    password: str | None = USER_PASSWORD,
) -> dict[str, object]:
    if scopes is not None:
        body_scopes = scopes
    elif lab is None:
        body_scopes: list[dict[str, object]] = []
    else:
        scope_row: dict[str, object] = {"laboratory_id": str(lab)}
        if product is not None:
            scope_row["product_scope_id"] = str(product)
        body_scopes = [scope_row]
    body: dict[str, object] = {
        "full_name": "Новый сотрудник",
        "login": login,
        "email": f"{login}@example.test",
        "role": role,
        "scopes": body_scopes,
        "password": password,
        "confirmation": password,
    }
    if territory is not None:
        body["territory_id"] = str(territory)
    return body


async def _count(db: AsyncSession, table, login: str | None = None) -> int:
    statement = select(func.count()).select_from(table)
    if login is not None:
        statement = statement.where(User.login == login)
    return int((await db.execute(statement)).scalar_one())


# --- 1. A delegated ADMIN creates a VET in his laboratory -----------------------


async def test_delegated_vet_creation(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    async with _client_for(env) as http:
        await _login(http)
        response = await http.post(
            "/api/v1/users",
            json=_payload("new-vet", role="VET", lab=env.own_lab.id, product=uuid.uuid4()),
            headers={**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-vet"},
        )
        assert response.status_code == 201, response.text
        assert response.json()["active"] is True, "новая учётная запись активна"
    assert await _count(env.db, User, "new-vet") == 1
    scopes = (await env.db.execute(select(UserScope))).scalars().all()
    assert len(scopes) == 1 and scopes[0].product_scope_id is not None
    grants = (await env.db.execute(select(func.count()).select_from(DelegationGrant))).scalar_one()
    assert grants == 2, "рабочей роли не выдаётся делегирование"


# --- 2. A HEAD is appointed for exactly one laboratory --------------------------


async def test_head_exactly_one_laboratory(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    async with _client_for(env) as http:
        await _login(http)
        auth = _csrf(http.cookies.get("vse_csrf", ""))
        two = await http.post(
            "/api/v1/users",
            json=_payload(
                "head-two",
                role="HEAD",
                scopes=[
                    {"laboratory_id": str(env.own_lab.id)},
                    {"laboratory_id": str(env.other_own_lab.id)},
                ],
            ),
            headers={**auth, "Idempotency-Key": "dr34-head-2"},
        )
        assert two.status_code == 422, two.text
        one = await http.post(
            "/api/v1/users",
            json=_payload("head-one", role="HEAD", lab=env.own_lab.id),
            headers={**auth, "Idempotency-Key": "dr34-head-1"},
        )
        assert one.status_code == 201, one.text
        scopes = (await env.db.execute(select(UserScope))).scalars().all()
        assert len(scopes) == 1, "заведующему назначена ровно одна лаборатория"


# --- 3+4+9. ADMIN creation: atomic grant, no auto working scopes ----------------


async def test_created_admin_gets_grant_without_working_scopes(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    async with _client_for(env) as http:
        await _login(http)
        response = await http.post(
            "/api/v1/users",
            json=_payload("new-admin", role="ADMIN", territory=env.district.id, scopes=[]),
            headers={**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-admin"},
        )
        assert response.status_code == 201, response.text
        target_id = uuid.UUID(str(response.json()["id"]))
    assert response.json()["scopes"] == [] or all(
        item["laboratory_id"] is None for item in response.json()["scopes"]
    ), "созданному администратору не выдаются рабочие области"

    grants = (await env.db.execute(select(DelegationGrant))).scalars().all()
    created = [item for item in grants if item.target_id == target_id]
    assert len(created) == 1
    assert created[0].role == UserRole.ADMIN and created[0].may_delegate is True
    assert created[0].grantor_id == env.chief.id
    target_scopes = (
        await env.db.execute(select(func.count()).select_from(UserScope).where(UserScope.user_id == target_id))
    ).scalar_one()
    assert target_scopes == 0, "созданному администратору не выдаются рабочие области"
    actor_scopes = (
        await env.db.execute(select(func.count()).select_from(UserScope).where(UserScope.user_id == env.chief.id))
    ).scalar_one()
    assert actor_scopes == 0, "создание администратора не расширяет actor"

    # The created administrator cannot widen the chain beyond his subtree.
    async with _client_for(env) as http:
        await _login(http, "new-admin", USER_PASSWORD)
        widened = await http.post(
            "/api/v1/users",
            json=_payload("wider-admin", role="ADMIN", territory=env.foreign.id, scopes=[]),
            headers={**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-widen"},
        )
        assert widened.status_code == 403, widened.text
    assert await _count(env.db, User, "wider-admin") == 0


# --- 5+6. Refusals leave no partial records -------------------------------------


async def test_forged_role_and_territory_rejected(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    async with _client_for(env) as http:
        await _login(http)
        auth = {**_csrf(http.cookies.get("vse_csrf", ""))}
        cases = [
            ("forged-territory", _payload("forged-territory", role="ADMIN", territory=env.foreign.id, scopes=[])),
            ("forged-lab", _payload("forged-lab", role="VET", lab=env.foreign_lab.id)),
            ("forged-uuid", _payload("forged-uuid", role="ADMIN", territory=uuid.uuid4(), scopes=[])),
            ("admin-needs-territory", _payload("admin-needs-territory", role="ADMIN", scopes=[])),
        ]
        for login_name, payload in cases:
            response = await http.post(
                "/api/v1/users",
                json=payload,
                headers={**auth, "Idempotency-Key": f"dr34-forge-{login_name}"},
            )
            assert response.status_code in (403, 422), (login_name, response.text)
        denied = await http.post(
            "/api/v1/users",
            json=_payload("forged-territory", role="ADMIN", territory=env.foreign.id, scopes=[]),
            headers={**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-forge-code"},
        )
        assert denied.json()["code"] == "ACCESS_DENIED", denied.text
    assert await _count(env.db, User, "forged-territory") == 0
    assert await _count(env.db, User, "forged-lab") == 0
    assert await _count(env.db, User, "forged-uuid") == 0
    assert await _count(env.db, User, "admin-needs-territory") == 0
    assert await _count(env.db, DelegationGrant) == 2, "отказ не создаёт делегирование"
    events = (await env.db.execute(select(func.count()).select_from(UserEvent))).scalar_one()
    assert events == 0, "отклонённые команды не пишут историю"


# --- 7. The scoped options endpoint hides foreign areas -------------------------


async def test_foreign_area_is_not_in_assignable_options(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    async with _client_for(env) as http:
        await _login(http)
        options = await http.get("/api/v1/users/assignable")
        assert options.status_code == 200, options.text
        payload = options.json()
        roles = {item["role"]: item for item in payload["roles"]}
        assert set(roles) == {"VET", "HEAD", "ANALYST", "ADMIN"}
        lab_ids = {item["laboratory_id"] for item in roles["VET"]["laboratories"]}
        assert str(env.own_lab.id) in lab_ids and str(env.other_own_lab.id) in lab_ids
        assert str(env.foreign_lab.id) not in lab_ids, "чужая лаборатория не раскрывается"
        territory_ids = {item["territory_id"] for item in roles["ADMIN"]["territories"]}
        assert territory_ids == {str(env.district.id)}, "чужая территория не раскрывается"
        assert roles["HEAD"]["max_laboratories"] == 1
        assert roles["VET"]["product_areas"] != [], "продуктовые области читаются из справочника"

    # An administrator without the delegation right honestly receives nothing.
    async with _client_for(env) as http:
        await _login(http, "restricted")
        options = await http.get("/api/v1/users/assignable")
        assert options.status_code == 200, options.text
        assert options.json()["roles"] == [], "нет права делегирования — нет вариантов"


async def test_assignable_options_require_create_permission(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    other = User(
        login="plain-vet",
        full_name="Обычный врач",
        email="plain@example.test",
        password_hash=hash_password(ADMIN_PASSWORD),
        role=UserRole.VET,
        active=True,
    )
    env.db.add(other)
    await env.db.commit()
    async with _client_for(env) as http:
        await _login(http, "plain-vet")
        assert (await http.get("/api/v1/users/assignable")).status_code == 403


# --- 8. Self-escalation stays impossible ----------------------------------------


async def test_self_escalation_stays_impossible(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    async with _client_for(env) as http:
        await _login(http)
        auth = {**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-self"}
        # The actor's own login already exists: a second self account is refused.
        response = await http.post(
            "/api/v1/users",
            json=_payload("chief", role="ADMIN", territory=env.district.id, scopes=[]),
            headers=auth,
        )
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "ALREADY_EXISTS"
        # Raising his own grant through the creation of a wider territory is refused.
        above = await http.post(
            "/api/v1/users",
            json=_payload("above-admin", role="ADMIN", territory=env.root.id, scopes=[]),
            headers=auth,
        )
        assert above.status_code == 403, above.text
    assert await _count(env.db, User, "above-admin") == 0
    grants = (await env.db.execute(select(func.count()).select_from(DelegationGrant))).scalar_one()
    assert grants == 2, "собственные полномочия не расширяются"


# --- 10. One Idempotency-Key never duplicates the intent ------------------------


async def test_same_idempotency_key_never_duplicates(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    payload = _payload("idempotent-vet", role="VET", lab=env.own_lab.id, product=uuid.uuid4())
    async with _client_for(env) as http:
        await _login(http)
        headers = {**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-idem"}
        first = await http.post("/api/v1/users", json=payload, headers=headers)
        assert first.status_code == 201, first.text
        second = await http.post("/api/v1/users", json=payload, headers=headers)
        assert second.status_code == 201, second.text
        assert second.json()["id"] == first.json()["id"], "повтор возвращает того же пользователя"
    assert await _count(env.db, User, "idempotent-vet") == 1
    records = (
        await env.db.execute(select(func.count()).select_from(CommandRecord).where(CommandRecord.key == "dr34-idem"))
    ).scalar_one()
    assert records == 1


# --- 11. Concurrent same-login creations: one 201, one 409 ----------------------


async def test_parallel_same_login_one_created(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    payload = _payload("race-vet", role="VET", lab=env.own_lab.id, product=uuid.uuid4())
    async with _client_for(env) as first, _client_for(env) as second:
        await _login(first)
        await _login(second)
        responses = await asyncio.gather(
            first.post(
                "/api/v1/users",
                json=payload,
                headers={**_csrf(first.cookies.get("vse_csrf", "")), "Idempotency-Key": "race-1"},
            ),
            second.post(
                "/api/v1/users",
                json=payload,
                headers={**_csrf(second.cookies.get("vse_csrf", "")), "Idempotency-Key": "race-2"},
            ),
        )
    statuses = sorted(item.status_code for item in responses)
    assert statuses == [201, 409], [item.text for item in responses]
    assert await _count(env.db, User, "race-vet") == 1


# --- 12. History carries role and area, never a password or hash ----------------


async def test_creation_history_has_no_password_or_hash(delegation_env: SimpleNamespace) -> None:
    env = delegation_env
    secret = "созданный-пароль-123"
    async with _client_for(env) as http:
        await _login(http)
        created = await http.post(
            "/api/v1/users",
            json=_payload("history-vet", role="VET", lab=env.own_lab.id, product=uuid.uuid4(), password=secret),
            headers={**_csrf(http.cookies.get("vse_csrf", "")), "Idempotency-Key": "dr34-history"},
        )
        assert created.status_code == 201, created.text
        target_id = created.json()["id"]
        history = await http.get(f"/api/v1/users/{target_id}/history")
        assert history.status_code == 200, history.text
        items = history.json()["items"]
        event = next(item for item in items if item["action"] == "create")
        assert event["changed_fields"]["role"] == "VET"
        assert event["changed_fields"]["scopes"], "история описывает назначение"
        dump = json.dumps(items, ensure_ascii=False)
        assert secret not in dump
        assert "$argon2" not in dump
