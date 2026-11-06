"""Async SQLAlchemy engine/session and declarative base (ADR-003).

A single ``Base`` with the project's naming convention, a lazily-created engine,
and the ``async_session`` FastAPI dependency that tests override.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.src.infrastructure.config.settings import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

__all__ = [
    "Base",
    "NAMING_CONVENTION",
    "build_engine",
    "get_engine",
    "get_session_factory",
    "async_session",
    "dispose_engine",
]


class Base(DeclarativeBase):
    """Declarative base for all ORM models (migrations are the source of truth)."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def build_engine(**overrides: Any) -> AsyncEngine:
    """Create an async engine for the configured database."""
    settings = get_settings()
    options: dict[str, Any] = {
        "echo": False,
        "pool_pre_ping": settings.database_pool_pre_ping,
        "pool_size": settings.database_pool_size,
        "max_overflow": settings.database_max_overflow,
    }
    options.update(overrides)
    return create_async_engine(settings.async_database_url, **options)


def get_engine() -> AsyncEngine:
    """Return the shared engine, creating it on first use."""
    global _engine
    if _engine is None:
        _engine = build_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the session factory bound to the shared engine."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(bind=get_engine(), class_=AsyncSession, expire_on_commit=False)
    return _session_factory


async def async_session() -> AsyncGenerator[AsyncSession]:
    """FastAPI dependency: a session per request, closed on completion."""
    async with get_session_factory()() as session:
        yield session


async def dispose_engine() -> None:
    """Dispose the shared engine's pooled connections, if it was created."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None
