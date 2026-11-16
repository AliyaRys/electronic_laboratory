"""Eligible Госветслужбы specialists for the examination form (DR35 §12.3).

The list is server-authoritative and scoped: only ACTIVE users with the VET or
HEAD role who hold the examination right in the CURRENT laboratory (and, for a
VET, the applicable product scope) are offered. A foreign, blocked or
unauthorized user can never be smuggled in through a forged request: the final
save re-checks eligibility with the same predicate.

This module READS the identity tables only — it deliberately does not modify
anything in ``backend/src/modules/identity`` (DR34 works there in parallel).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError, ProblemItem, validation_error
from backend.src.modules.identity.models import User, UserRole, UserScope

__all__ = ["eligible_specialists", "is_eligible_specialist", "specialist_not_allowed"]

_ELIGIBLE_ROLES = (UserRole.VET, UserRole.HEAD)


def specialist_not_allowed() -> ProblemError:
    return validation_error(
        [ProblemItem(path="specialistId", field_id="VSE", message="Недопустимый специалист Госветслужбы.")]
    )


async def eligible_specialists(db: AsyncSession, laboratory_id: uuid.UUID, product_id: uuid.UUID | None) -> list[User]:
    """The scoped specialist options of one laboratory (+ applicable product).

    The predicate mirrors ``scope_allows`` (I02): HEAD needs any scope row of
    the laboratory; VET needs the exact (laboratory, product) pair when the
    party carries a product classification.
    """
    users = (
        (await db.execute(select(User).where(User.active.is_(True), User.role.in_(_ELIGIBLE_ROLES)))).scalars().all()
    )
    scopes = (await db.execute(select(UserScope).where(UserScope.laboratory_id == laboratory_id))).scalars().all()
    by_user: dict[uuid.UUID, list[UserScope]] = {}
    for scope in scopes:
        by_user.setdefault(scope.user_id, []).append(scope)
    eligible: list[User] = []
    for user in users:
        rows = by_user.get(user.id, [])
        if not rows:
            continue
        if user.role == UserRole.HEAD:
            eligible.append(user)
            continue
        # VET: the product scope pair decides (when the party carries one).
        if product_id is None or any(scope.product_scope_id in (None, product_id) for scope in rows):
            eligible.append(user)
    eligible.sort(key=lambda item: item.full_name)
    return eligible


async def is_eligible_specialist(
    db: AsyncSession, user_id: uuid.UUID, laboratory_id: uuid.UUID, product_id: uuid.UUID | None
) -> bool:
    """The save-time re-check: the same predicate as the offered list."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.active or user.role not in _ELIGIBLE_ROLES:
        return False
    return any(candidate.id == user_id for candidate in await eligible_specialists(db, laboratory_id, product_id))
