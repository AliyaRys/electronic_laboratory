"""ТЗ-DR6 §6.4 read-model labels: human-readable context names only.

The additive extension must not change any authorization, write or data-scope
rule: names resolve strictly from rows the scope already contains, and the
scoped laboratories endpoint lists exactly the allowed set.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import DelegationGrant, Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.session import SessionTransport
from backend.tests.identity.test_sessions import MemoryRedis
from backend.tests.identity.test_users import _client_for

PASSWORD = "read-model-labels-pass"


@pytest.fixture
def ctx_env(test_db_engine) -> SimpleNamespace:
    return SimpleNamespace(
        engine=test_db_engine,
        transport=SessionTransport(MemoryRedis(), prefix="contexts"),
        authorizer=Authorizer(InMemoryDecisionEngine()),
    )


async def _seed(db_session: AsyncSession) -> SimpleNamespace:
    """A HEAD over one lab and an ADMIN over a district with two labs."""
    root = Territory(name="Республика Татарстан")
    district = Territory(name="Альметьевский район", parent_id=root.id)
    other = Territory(name="Другой район", parent_id=root.id)
    db_session.add_all([root, district, other])
    await db_session.flush()
    lab = Laboratory(territory_id=district.id, name="Лаборатория №1 г. Казань", address="ул. Тест", organization="ГБУ")
    other_lab = Laboratory(
        territory_id=other.id, name="Чужая лаборатория", address="ул. Иная", organization="ГБУ"
    )
    db_session.add_all([lab, other_lab])
    await db_session.flush()
    product = uuid.uuid4()
    head = User(
        login="head-ctx",
        full_name="Ирина Заведующая",
        email="head-ctx@example.test",
        password_hash=hash_password(PASSWORD),
        role=UserRole.HEAD,
        active=True,
    )
    admin = User(
        login="admin-ctx",
        full_name="Павел Администратор",
        email="admin-ctx@example.test",
        password_hash=hash_password(PASSWORD),
        role=UserRole.ADMIN,
        active=True,
    )
    db_session.add_all([head, admin])
    await db_session.flush()
    db_session.add_all(
        [
            UserScope(user_id=head.id, laboratory_id=lab.id, product_scope_id=product),
            DelegationGrant(
                grantor_id=admin.id,
                target_id=admin.id,
                role=UserRole.ADMIN,
                territory_id=district.id,
                may_delegate=True,
            ),
        ]
    )
    await db_session.commit()
    return SimpleNamespace(head=head, admin=admin, lab=lab, other_lab=other_lab, product=product)


async def _login(client, login_name: str) -> None:
    token = str((await client.get("/api/v1/auth/csrf")).json()["csrf_token"])
    response = await client.post(
        "/api/v1/auth/login",
        json={"login": login_name, "password": PASSWORD},
        headers={"Origin": "http://test", "X-CSRF-Token": token},
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_head_contexts_carry_the_laboratory_name(db_session: AsyncSession, ctx_env) -> None:
    """HEAD's single context resolves its laboratory name; nothing extra."""
    data = await _seed(db_session)
    async with _client_for(ctx_env) as client:
        await _login(client, data.head.login)
        contexts = await client.get("/api/v1/contexts")
        assert contexts.status_code == 200
        rows = contexts.json()
        assert len(rows) == 1
        assert rows[0]["laboratory_id"] == str(data.lab.id)
        assert rows[0]["laboratory_name"] == "Лаборатория №1 г. Казань"
        labs = await client.get("/api/v1/contexts/laboratories")
        assert labs.status_code == 200
        options = labs.json()
        assert [item["laboratory_id"] for item in options] == [str(data.lab.id)]
        assert options[0]["name"] == "Лаборатория №1 г. Казань"


@pytest.mark.asyncio
async def test_admin_laboratory_options_stay_inside_the_district(db_session: AsyncSession, ctx_env) -> None:
    """ADMIN's scoped endpoint lists its delegated district only, with names."""
    data = await _seed(db_session)
    async with _client_for(ctx_env) as client:
        await _login(client, data.admin.login)
        labs = await client.get("/api/v1/contexts/laboratories")
        assert labs.status_code == 200
        options = labs.json()
        ids = {item["laboratory_id"] for item in options}
        assert str(data.lab.id) in ids
        assert str(data.other_lab.id) not in ids
        matched = next(item for item in options if item["laboratory_id"] == str(data.lab.id))
        assert matched["name"] == "Лаборатория №1 г. Казань"
        # The ADMIN territory context keeps its territory name as well.
        contexts = await client.get("/api/v1/contexts")
        assert contexts.status_code == 200
        assert any(
            row["territory_name"] == "Альметьевский район"
            for row in contexts.json()
            if row["territory_id"] is not None
        )


@pytest.mark.asyncio
async def test_laboratories_endpoint_requires_session(db_session: AsyncSession, ctx_env) -> None:
    await _seed(db_session)
    async with _client_for(ctx_env) as client:
        assert (await client.get("/api/v1/contexts/laboratories")).status_code == 401
