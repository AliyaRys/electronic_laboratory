"""Four-role authorization matrix acceptance tests (Task I02)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.identity.authz import (
    AccessSnapshot,
    Authorizer,
    InMemoryDecisionEngine,
    ScopeTarget,
    SqlAlchemyDecisionEngine,
    attributes_allow,
    get_authorizer,
    load_access_snapshot,
    scope_allows,
)
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.policies import DENIED_ACTIONS, PERMISSION_MATRIX, install_default_policies


def _snapshot(role: UserRole, *, active: bool = True, own: bool = True) -> tuple[AccessSnapshot, ScopeTarget]:
    actor = uuid.uuid4()
    lab = uuid.uuid4()
    product = uuid.uuid4()
    territory = uuid.uuid4()
    target_lab = lab if own else uuid.uuid4()
    target_territory = territory if own else uuid.uuid4()
    snapshot = AccessSnapshot(
        actor_id=actor,
        role=role,
        active=active,
        scopes=frozenset({(lab, product)}),
        delegated_territories=frozenset({territory}),
        territory_parents={territory: None, target_territory: None},
        laboratory_territories={target_lab: target_territory},
    )
    target = ScopeTarget(laboratory_id=target_lab, product_scope_id=product, territory_id=target_territory)
    return snapshot, target


@pytest.mark.parametrize("action,allowed_roles", list(PERMISSION_MATRIX.items()))
async def test_four_roles_scope_matrix(action, allowed_roles) -> None:
    engine = InMemoryDecisionEngine()
    for role in UserRole:
        for own in (True, False):
            for active in (True, False):
                snapshot, target = _snapshot(role, active=active, own=own)
                allowed = await engine.enforce(role, action, scope_allows(snapshot, target))
                assert allowed is (active and own and role in allowed_roles)


@pytest.mark.parametrize("action", sorted(DENIED_ACTIONS))
@pytest.mark.parametrize("role", list(UserRole))
async def test_explicitly_forbidden_actions(action: str, role: UserRole) -> None:
    assert not await InMemoryDecisionEngine().enforce(role, action, True)


async def test_revocation_next_worker_request(db_session: AsyncSession) -> None:
    territory = Territory(name="Татарстан")
    db_session.add(territory)
    await db_session.flush()
    own_lab = Laboratory(territory_id=territory.id, name="Своя", address="А", organization="О")
    foreign_lab = Laboratory(territory_id=territory.id, name="Чужая", address="Б", organization="О")
    db_session.add_all([own_lab, foreign_lab])
    await db_session.flush()
    product = uuid.uuid4()
    user = User(
        login="revoked",
        full_name="Пользователь",
        email="r@example.test",
        password_hash=hash_password("long enough password"),
        role=UserRole.VET,
        active=True,
    )
    db_session.add(user)
    await db_session.flush()
    assignment = UserScope(user_id=user.id, laboratory_id=own_lab.id, product_scope_id=product)
    db_session.add(assignment)
    await db_session.commit()
    worker_one = Authorizer(InMemoryDecisionEngine())
    worker_two = Authorizer(InMemoryDecisionEngine())
    target = ScopeTarget(laboratory_id=own_lab.id, product_scope_id=product)
    await worker_one.authorize(db_session, user.id, "arrivals:read", target, hide_foreign=True)
    await db_session.delete(assignment)
    await db_session.commit()
    with pytest.raises(ProblemError) as hidden:
        await worker_two.authorize(db_session, user.id, "arrivals:read", target, hide_foreign=True)
    assert hidden.value.status == 404
    with pytest.raises(ProblemError) as mutation:
        await worker_two.authorize(db_session, user.id, "reconciliation:save", target)
    assert mutation.value.status == 403


def test_scope_gate_requires_product_for_vet() -> None:
    snapshot, target = _snapshot(UserRole.VET)
    assert scope_allows(snapshot, target)
    assert not scope_allows(
        snapshot,
        ScopeTarget(laboratory_id=target.laboratory_id, product_scope_id=uuid.uuid4()),
    )


def test_admin_hierarchy_and_operation_ownership() -> None:
    admin, _ = _snapshot(UserRole.ADMIN)
    child = uuid.uuid4()
    parent = next(iter(admin.delegated_territories))
    lab = uuid.uuid4()
    admin = AccessSnapshot(
        actor_id=admin.actor_id,
        role=admin.role,
        active=True,
        scopes=frozenset(),
        delegated_territories=frozenset({parent}),
        territory_parents={parent: None, child: parent},
        laboratory_territories={lab: child},
    )
    assert scope_allows(admin, None)
    assert scope_allows(admin, ScopeTarget(laboratory_id=lab))
    assert not scope_allows(admin, ScopeTarget())
    assert attributes_allow(admin, "catalog:read", {})
    assert attributes_allow(
        admin,
        "operation:read",
        {"operation_kind": "catalog", "created_by": admin.actor_id},
    )
    assert not attributes_allow(
        admin,
        "operation:read",
        {"operation_kind": "receipt", "created_by": admin.actor_id},
    )
    analyst = _snapshot(UserRole.ANALYST)[0]
    assert attributes_allow(
        analyst,
        "operation:read",
        {"operation_kind": "catalog", "created_by": analyst.actor_id},
    )
    assert not attributes_allow(
        analyst,
        "operation:read",
        {"operation_kind": "catalog", "created_by": uuid.uuid4()},
    )
    assert attributes_allow(analyst, "operation:read", {"operation_kind": "working"})


async def test_missing_and_blocked_actor_are_denied(db_session: AsyncSession) -> None:
    with pytest.raises(ProblemError) as missing:
        await load_access_snapshot(db_session, uuid.uuid4())
    assert missing.value.status == 404

    user = User(
        login="blocked",
        full_name="Заблокирован",
        email="blocked@example.test",
        password_hash=hash_password("long enough password"),
        role=UserRole.VET,
        active=False,
    )
    db_session.add(user)
    await db_session.commit()
    authorizer = Authorizer(InMemoryDecisionEngine())
    with pytest.raises(ProblemError) as blocked:
        await authorizer.authorize(db_session, user.id, "profile:read", ScopeTarget(user_id=user.id))
    assert blocked.value.code == "ACCOUNT_BLOCKED"


async def test_policy_dependency_failure_is_503(monkeypatch) -> None:
    engine = SqlAlchemyDecisionEngine(database_url="postgresql+psycopg://unused", workers=1)

    def fail(*args) -> bool:
        raise RuntimeError("unavailable")

    monkeypatch.setattr(engine, "_enforce_sync", fail)
    with pytest.raises(ProblemError) as unavailable:
        await engine.enforce(UserRole.VET, "arrivals:read", True)
    assert unavailable.value.status == 503


def test_authorizer_factory_is_singleton() -> None:
    assert get_authorizer() is get_authorizer()


async def test_sql_adapter_loads_fresh_policy_snapshot(db_session: AsyncSession, test_db_url: str) -> None:
    """The production engine reads the official table in its dedicated sync pool."""
    await install_default_policies(db_session)
    await db_session.commit()
    sync_url = test_db_url.replace("postgresql+asyncpg://", "postgresql+psycopg://", 1)
    engine = SqlAlchemyDecisionEngine(database_url=sync_url, workers=1)
    assert await engine.enforce(UserRole.VET, "arrivals:read", True)
    assert not await engine.enforce(UserRole.ADMIN, "arrivals:read", True)
