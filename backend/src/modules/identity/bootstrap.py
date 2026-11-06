"""Closed one-shot bootstrap CLI (ADR-004, API-09).

Run from the repository root as::

    uv run --frozen python -m backend.src.modules.identity.bootstrap

Secrets (login, full name, email, password) are read from **stdin** — never from
shell argv, never echoed, never logged. The command refuses to run when the user
registry is already non-empty, so there is no public signup and no default
password. Task I03 extends it with the explicit initial scope/delegation.
"""

from __future__ import annotations

import asyncio
import getpass
import sys

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import dispose_engine, get_session_factory
from backend.src.modules.identity.models import DelegationGrant, Territory, User, UserEvent, UserRole
from backend.src.modules.identity.passwords import hash_password, validate_password, verify_password
from backend.src.modules.identity.policies import install_default_policies

__all__ = [
    "main",
    "run_bootstrap",
    "ensure_registry_empty",
    "hash_password",
    "verify_password",
    "validate_password",
    "create_admin",
    "user_count",
    "BootstrapError",
]


class BootstrapError(Exception):
    """Bootstrap cannot proceed (non-empty registry, mismatched passwords, ...)."""


async def user_count(session: AsyncSession) -> int:
    result = await session.execute(select(func.count()).select_from(User))
    return int(result.scalar_one())


async def ensure_registry_empty(session: AsyncSession) -> None:
    """Refuse to run twice: bootstrap is only valid on an empty user registry."""
    if await user_count(session) != 0:
        raise BootstrapError("реестр пользователей не пуст, bootstrap уже выполнен")


async def create_admin(session: AsyncSession, *, login: str, full_name: str, email: str, password: str) -> User:
    """Insert the bootstrap administrator."""
    user = User(
        login=login.strip(),
        full_name=full_name.strip(),
        email=email.strip(),
        password_hash=hash_password(password),
        role=UserRole.ADMIN,
        active=True,
    )
    session.add(user)
    await session.flush()
    return user


async def ensure_initial_delegation(session: AsyncSession, user: User, *, territory_name: str) -> DelegationGrant:
    """OPS-01: the bootstrap administrator receives the initial self-delegation.

    Administrator empowerment is never issued through the API; the closed CLI
    creates (or reuses) the root territory and grants the first ADMIN authority
    over it. A ``user_event`` records the creation without any secret.
    """
    territory = (
        await session.execute(select(Territory).where(Territory.name == territory_name, Territory.parent_id.is_(None)))
    ).scalar_one_or_none()
    if territory is None:
        territory = Territory(name=territory_name)
        session.add(territory)
        await session.flush()
    grant = DelegationGrant(
        grantor_id=user.id,
        target_id=user.id,
        role=UserRole.ADMIN,
        territory_id=territory.id,
        may_delegate=True,
    )
    session.add(grant)
    session.add(
        UserEvent(
            target_user_id=user.id,
            actor_id=user.id,
            action="create",
            changed_fields={"login": user.login, "role": user.role, "source": "bootstrap"},
        )
    )
    return grant


async def run_bootstrap(
    session: AsyncSession,
    *,
    login: str,
    full_name: str,
    email: str,
    password: str,
    confirmation: str,
    delegation_territory: str = "Республика Татарстан",
) -> User:
    """Validate input, create the bootstrap admin and its initial delegation."""
    await ensure_registry_empty(session)
    if password != confirmation:
        raise BootstrapError("пароли не совпадают")
    validate_password(password)
    user = await create_admin(session, login=login, full_name=full_name, email=email, password=password)
    await ensure_initial_delegation(session, user, territory_name=delegation_territory)
    await install_default_policies(session)
    await session.commit()
    return user


async def main() -> int:
    """Read credentials from stdin and create the bootstrap admin once."""
    factory = get_session_factory()
    try:
        async with factory() as session:
            login = input("Логин: ")
            full_name = input("ФИО: ")
            email = input("Email: ")
            password = getpass.getpass("Пароль: ")
            confirmation = getpass.getpass("Повторите пароль: ")
            territory = input("Территория делегирования [Республика Татарстан]: ").strip()
            delegation_territory = territory or "Республика Татарстан"

            try:
                await run_bootstrap(
                    session,
                    login=login,
                    full_name=full_name,
                    email=email,
                    password=password,
                    confirmation=confirmation,
                    delegation_territory=delegation_territory,
                )
            except (BootstrapError, ValueError) as exc:
                print(f"Отказ: {exc}", file=sys.stderr)
                return 1
    finally:
        await dispose_engine()

    print("Bootstrap-администратор создан.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
