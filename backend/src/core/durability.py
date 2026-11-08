"""Remote-WAL durability boundary for destructive examination commands."""

from __future__ import annotations

import asyncio
from typing import Annotated, Protocol

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import async_session
from backend.src.infrastructure.config.settings import Settings, get_settings

__all__ = [
    "DurabilityGuard",
    "PostgresDurabilityGuard",
    "current_wal_lsn",
    "get_durability_guard",
]


class DurabilityGuard(Protocol):
    """The E03/O02 port: readiness before DELETE and remote flush after it."""

    async def ready(self) -> bool: ...

    async def wait_flushed(self, lsn: str) -> bool: ...


async def current_wal_lsn(db: AsyncSession) -> str:
    """A conservative upper WAL bound after the destructive commit."""
    return str((await db.execute(text("SELECT pg_current_wal_lsn()::text"))).scalar_one())


class PostgresDurabilityGuard:
    """Observe the configured synchronous WAL receiver through PostgreSQL.

    O02 supplies and validates the receiver/base-backup installation. E03 keeps
    the safe production boundary: without the explicit gate and one streaming
    synchronous receiver, deletion readiness is false.
    """

    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    async def ready(self) -> bool:
        if not self.settings.delete_durability_enabled:
            return False
        try:
            return bool(
                (
                    await self.db.execute(
                        text(
                            "SELECT EXISTS ("
                            "SELECT 1 FROM pg_stat_replication "
                            "WHERE state = 'streaming' AND sync_state IN ('sync','quorum') "
                            "AND flush_lsn IS NOT NULL)"
                        )
                    )
                ).scalar_one()
            )
        except SQLAlchemyError, OSError:
            return False

    async def wait_flushed(self, lsn: str) -> bool:
        if not self.settings.delete_durability_enabled:
            return False
        for _attempt in range(20):
            try:
                reached = bool(
                    (
                        await self.db.execute(
                            text(
                                "SELECT COALESCE(bool_or("
                                "pg_wal_lsn_diff(flush_lsn, CAST(:lsn AS pg_lsn)) >= 0"
                                "), false) FROM pg_stat_replication "
                                "WHERE state = 'streaming' AND sync_state IN ('sync','quorum')"
                            ),
                            {"lsn": lsn},
                        )
                    ).scalar_one()
                )
            except SQLAlchemyError, OSError:
                return False
            if reached:
                return True
            await asyncio.sleep(0.25)
        return False


def get_durability_guard(
    db: Annotated[AsyncSession, Depends(async_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> DurabilityGuard:
    return PostgresDurabilityGuard(db, settings)
