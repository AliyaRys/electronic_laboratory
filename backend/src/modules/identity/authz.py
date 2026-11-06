"""Current SQL scope + fresh Casbin policy authorization (Task I02)."""

from __future__ import annotations

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol

import casbin  # type: ignore[import-untyped]
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy_adapter import Adapter  # type: ignore[import-untyped]

from backend.src.core.problems import ProblemError, not_found
from backend.src.infrastructure.config.settings import get_settings
from backend.src.modules.identity.models import DelegationGrant, Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.policies import PERMISSION_MATRIX

CASBIN_MODEL = """
[request_definition]
r = sub, act, scope_ok
[policy_definition]
p = sub, act
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = r.sub == p.sub && r.act == p.act && r.scope_ok
"""


@dataclass(frozen=True, slots=True)
class ScopeTarget:
    laboratory_id: uuid.UUID | None = None
    product_scope_id: uuid.UUID | None = None
    territory_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class AccessSnapshot:
    actor_id: uuid.UUID
    role: UserRole
    active: bool
    scopes: frozenset[tuple[uuid.UUID, uuid.UUID]]
    delegated_territories: frozenset[uuid.UUID]
    territory_parents: dict[uuid.UUID, uuid.UUID | None]
    laboratory_territories: dict[uuid.UUID, uuid.UUID]


class DecisionEngine(Protocol):
    async def enforce(self, role: UserRole, action: str, scope_ok: bool) -> bool: ...


class InMemoryDecisionEngine:
    """Deterministic engine for unit tests; it still makes the final Casbin decision."""

    _enforcer: casbin.Enforcer | None = None

    @classmethod
    def _get_enforcer(cls) -> casbin.Enforcer:
        if cls._enforcer is None:
            model = casbin.Model()
            model.load_model_from_text(CASBIN_MODEL)
            enforcer = casbin.Enforcer(model, enable_log=False)
            for item_action, roles in PERMISSION_MATRIX.items():
                for item_role in roles:
                    enforcer.add_policy(item_role.value, item_action)
            cls._enforcer = enforcer
        return cls._enforcer

    async def enforce(self, role: UserRole, action: str, scope_ok: bool) -> bool:
        return bool(self._get_enforcer().enforce(role.value, action, scope_ok))


class SqlAlchemyDecisionEngine:
    """Load an adapter snapshot per request in a small dedicated sync pool."""

    def __init__(self, *, database_url: str | None = None, workers: int = 4) -> None:
        self.database_url = database_url or get_settings().sync_database_url
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="casbin")

    def _enforce_sync(self, role: UserRole, action: str, scope_ok: bool) -> bool:
        model = casbin.Model()
        model.load_model_from_text(CASBIN_MODEL)
        adapter = Adapter(self.database_url, create_table=False)
        enforcer = casbin.Enforcer(model, adapter, enable_log=False)
        return bool(enforcer.enforce(role.value, action, scope_ok))

    async def enforce(self, role: UserRole, action: str, scope_ok: bool) -> bool:
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(self.pool, self._enforce_sync, role, action, scope_ok)
        except Exception as exc:
            raise ProblemError(
                status=503,
                code="DEPENDENCY_UNAVAILABLE",
                title="Authorization unavailable",
                detail="Хранилище политик авторизации недоступно.",
            ) from exc

    def close(self) -> None:
        self.pool.shutdown(wait=True, cancel_futures=True)


def _is_descendant(
    target: uuid.UUID,
    allowed: frozenset[uuid.UUID],
    parents: dict[uuid.UUID, uuid.UUID | None],
) -> bool:
    seen: set[uuid.UUID] = set()
    current: uuid.UUID | None = target
    while current is not None and current not in seen:
        if current in allowed:
            return True
        seen.add(current)
        current = parents.get(current)
    return False


def scope_allows(snapshot: AccessSnapshot, target: ScopeTarget | None) -> bool:
    if not snapshot.active:
        return False
    if target is None:
        return True
    if target.user_id is not None:
        return target.user_id == snapshot.actor_id
    if snapshot.role == UserRole.ADMIN:
        territory_id = target.territory_id
        if territory_id is None and target.laboratory_id is not None:
            territory_id = snapshot.laboratory_territories.get(target.laboratory_id)
        return territory_id is not None and _is_descendant(
            territory_id, snapshot.delegated_territories, snapshot.territory_parents
        )
    if target.laboratory_id is None:
        return False
    matching = {(lab, product) for lab, product in snapshot.scopes if lab == target.laboratory_id}
    if snapshot.role == UserRole.VET and target.product_scope_id is not None:
        return (target.laboratory_id, target.product_scope_id) in matching
    return bool(matching)


def attributes_allow(snapshot: AccessSnapshot, action: str, attributes: dict[str, object]) -> bool:
    """Apply cross-module ownership constraints that are part of AUTHZ itself."""
    if action != "operation:read":
        return True
    kind = attributes.get("operation_kind")
    owner = attributes.get("created_by")
    if snapshot.role == UserRole.ADMIN:
        return kind == "catalog" and owner == snapshot.actor_id
    if snapshot.role == UserRole.ANALYST and kind == "catalog":
        return owner == snapshot.actor_id
    return True


async def load_access_snapshot(session: AsyncSession, actor_id: uuid.UUID) -> AccessSnapshot:
    user = (await session.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
    if user is None:
        raise not_found()
    scopes = (await session.execute(select(UserScope).where(UserScope.user_id == actor_id))).scalars().all()
    grants = (
        (await session.execute(select(DelegationGrant).where(DelegationGrant.target_id == actor_id))).scalars().all()
    )
    territories = (await session.execute(select(Territory))).scalars().all()
    laboratories = (await session.execute(select(Laboratory))).scalars().all()
    return AccessSnapshot(
        actor_id=user.id,
        role=UserRole(user.role),
        active=user.active,
        scopes=frozenset((item.laboratory_id, item.product_scope_id) for item in scopes),
        delegated_territories=frozenset(item.territory_id for item in grants),
        territory_parents={item.id: item.parent_id for item in territories},
        laboratory_territories={item.id: item.territory_id for item in laboratories},
    )


class Authorizer:
    def __init__(self, engine: DecisionEngine) -> None:
        self.engine = engine

    async def authorize(
        self,
        session: AsyncSession,
        actor_id: uuid.UUID,
        action: str,
        scope: ScopeTarget | None,
        attributes: dict[str, object] | None = None,
        *,
        hide_foreign: bool = False,
    ) -> AccessSnapshot:
        attributes = attributes or {}
        snapshot = await load_access_snapshot(session, actor_id)
        scope_ok = scope_allows(snapshot, scope) and attributes_allow(snapshot, action, attributes)
        allowed = await self.engine.enforce(snapshot.role, action, scope_ok)
        if not allowed:
            if hide_foreign:
                raise not_found()
            code = "ACCOUNT_BLOCKED" if not snapshot.active else "ACCESS_DENIED"
            raise ProblemError(status=403, code=code, title="Access denied", detail="Доступ запрещён.")
        return snapshot


_authorizer: Authorizer | None = None


def get_authorizer() -> Authorizer:
    global _authorizer
    if _authorizer is None:
        _authorizer = Authorizer(SqlAlchemyDecisionEngine())
    return _authorizer


def close_authorizer() -> None:
    global _authorizer
    if _authorizer is not None and isinstance(_authorizer.engine, SqlAlchemyDecisionEngine):
        _authorizer.engine.close()
    _authorizer = None


__all__ = [
    "PERMISSION_MATRIX",
    "ScopeTarget",
    "AccessSnapshot",
    "Authorizer",
    "InMemoryDecisionEngine",
    "SqlAlchemyDecisionEngine",
    "scope_allows",
    "attributes_allow",
    "load_access_snapshot",
    "get_authorizer",
    "close_authorizer",
]
