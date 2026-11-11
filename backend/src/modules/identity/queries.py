"""User administration read models (API-02): views, list filters, history."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.identity.commands import PAGE_SIZE
from backend.src.modules.identity.models import DelegationGrant, Laboratory, Territory, User, UserEvent, UserRole, UserScope
from backend.src.modules.identity.policies import PERMISSION_MATRIX
from backend.src.modules.identity.schemas import LaboratoryOptionView, ScopeView, UserEventView, UserView

__all__ = [
    "PAGE_SIZE",
    "user_contexts",
    "laboratory_options",
    "capabilities_for",
    "build_user_view",
    "user_page",
    "history_page",
]


async def user_contexts(db: AsyncSession, user: User) -> list[ScopeView]:
    """Available working/administrative contexts (API-02).

    The names are the additive read-model labels (ТЗ-DR6 §6.4): resolved from
    the same rows the scope already contains — no additional laboratory or
    territory becomes visible.
    """
    role = UserRole(user.role)
    if role == UserRole.ADMIN:
        rows = await db.execute(
            select(DelegationGrant.territory_id, Territory.name)
            .join(Territory, Territory.id == DelegationGrant.territory_id)
            .where(DelegationGrant.target_id == user.id)
        )
        return [
            ScopeView(territory_id=territory_id, territory_name=name)
            for territory_id, name in rows.all()
        ]
    scope_rows = await db.execute(
        select(UserScope.laboratory_id, UserScope.product_scope_id, Laboratory.name)
        .join(Laboratory, Laboratory.id == UserScope.laboratory_id)
        .where(UserScope.user_id == user.id)
    )
    names: dict[uuid.UUID, str] = {}
    result: list[ScopeView] = []
    for laboratory_id, product_scope_id, name in scope_rows.all():
        names[laboratory_id] = name
        result.append(
            ScopeView(
                laboratory_id=laboratory_id,
                product_scope_id=product_scope_id,
                laboratory_name=name,
            )
        )
    return result


async def laboratory_options(db: AsyncSession, user: User) -> list[LaboratoryOptionView]:
    """Allowed laboratories with names (ТЗ-DR6 §6.4 scoped read endpoint).

    VET/HEAD/ANALYST: the laboratories of the user scopes. ADMIN: every
    laboratory of the delegated territories — the same predicate the catalog
    read/write authorization applies, so no laboratory leaves the allowed
    scope. Read-only and additive; write rules are unchanged.
    """
    role = UserRole(user.role)
    if role == UserRole.ADMIN:
        grants = (
            await db.execute(select(DelegationGrant.territory_id).where(DelegationGrant.target_id == user.id))
        ).scalars().all()
        if len(grants) == 0:
            return []
        rows = await db.execute(
            select(Laboratory.id, Laboratory.name, Laboratory.territory_id)
            .where(Laboratory.territory_id.in_(grants))
            .order_by(Laboratory.name, Laboratory.id)
        )
        return [
            LaboratoryOptionView(laboratory_id=lid, name=name, territory_id=tid) for lid, name, tid in rows.all()
        ]
    rows = await db.execute(
        select(Laboratory.id, Laboratory.name, Laboratory.territory_id)
        .join(UserScope, UserScope.laboratory_id == Laboratory.id)
        .where(UserScope.user_id == user.id)
        .order_by(Laboratory.name, Laboratory.id)
    )
    return [
        LaboratoryOptionView(laboratory_id=lid, name=name, territory_id=tid) for lid, name, tid in rows.all()
    ]


def capabilities_for(user: User) -> list[str]:
    """Casbin actions the user's role permits; scope is always checked separately."""
    role = UserRole(user.role)
    return sorted(action for action, roles in PERMISSION_MATRIX.items() if role in roles)


async def build_user_view(db: AsyncSession, user: User) -> UserView:
    """UserView (API-02): no password hashes, no secrets."""
    return UserView(
        id=user.id,
        full_name=user.full_name,
        login=user.login,
        email=user.email,
        position=user.position,
        role=UserRole(user.role),
        active=user.active,
        scopes=await user_contexts(db, user),
        capabilities=capabilities_for(user),
        revision=user.rev,
    )


def _escape_like(query: str) -> str:
    return re.sub(r"([\\%_])", r"\\\1", query.strip())


async def user_page(
    db: AsyncSession,
    *,
    allowed: frozenset[uuid.UUID],
    role: UserRole | None,
    status: str | None,
    laboratory_id: uuid.UUID | None,
    product_scope_id: uuid.UUID | None,
    query: str | None,
    page: int,
) -> tuple[list[User], int]:
    """A page of users inside the delegated territory (API-01 paging rules)."""
    allowed_ids = sorted(allowed)
    scope_users = (
        select(UserScope.user_id)
        .join(Laboratory, Laboratory.id == UserScope.laboratory_id)
        .where(Laboratory.territory_id.in_(allowed_ids))
    )
    grant_users = select(DelegationGrant.target_id).where(DelegationGrant.territory_id.in_(allowed_ids))
    conditions = [or_(User.id.in_(scope_users), User.id.in_(grant_users))]
    if role is not None:
        conditions.append(User.role == role.value)
    if status == "active":
        conditions.append(User.active.is_(True))
    elif status == "inactive":
        conditions.append(User.active.is_(False))
    if laboratory_id is not None:
        conditions.append(User.id.in_(select(UserScope.user_id).where(UserScope.laboratory_id == laboratory_id)))
    if product_scope_id is not None:
        conditions.append(User.id.in_(select(UserScope.user_id).where(UserScope.product_scope_id == product_scope_id)))
    if query and query.strip():
        pattern = f"%{_escape_like(query)}%"
        conditions.append(
            or_(
                User.full_name.ilike(pattern, escape="\\"),
                User.login.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )
    where = and_(*conditions)
    total = int((await db.execute(select(func.count()).select_from(User).where(where))).scalar_one())
    current = max(page, 1)
    rows = await db.execute(
        select(User)
        .where(where)
        .order_by(User.created_at.desc(), User.id.desc())
        .offset((current - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    return list(rows.scalars().all()), total


async def history_page(db: AsyncSession, target_user_id: uuid.UUID, page: int) -> tuple[list[UserEventView], int]:
    """A page of ``user_events`` for one user (API-02): no secrets inside."""
    where = UserEvent.target_user_id == target_user_id
    total = int((await db.execute(select(func.count()).select_from(UserEvent).where(where))).scalar_one())
    current = max(page, 1)
    rows = await db.execute(
        select(UserEvent)
        .where(where)
        .order_by(UserEvent.at.desc(), UserEvent.id.desc())
        .offset((current - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    items = [
        UserEventView(
            id=event.id,
            target_user_id=event.target_user_id,
            actor_id=event.actor_id,
            at=event.at,
            action=event.action,
            changed_fields=dict(event.changed_fields),
        )
        for event in rows.scalars().all()
    ]
    return items, total
