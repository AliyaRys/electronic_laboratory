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
from backend.src.modules.identity.models import User, UserRole
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


async def run_bootstrap(
    session: AsyncSession, *, login: str, full_name: str, email: str, password: str, confirmation: str
) -> User:
    """Validate input and create the bootstrap admin; commits on success."""
    await ensure_registry_empty(session)
    if password != confirmation:
        raise BootstrapError("пароли не совпадают")
    validate_password(password)
    user = await create_admin(session, login=login, full_name=full_name, email=email, password=password)
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

            try:
                await run_bootstrap(
                    session, login=login, full_name=full_name, email=email, password=password, confirmation=confirmation
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
