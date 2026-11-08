"""Remote-WAL durability boundary for destructive examination commands."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Protocol

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import async_session
from backend.src.infrastructure.config.settings import Settings, get_settings

__all__ = [
    "DurabilityGuard",
    "BackupReadinessError",
    "BackupReadinessEvidence",
    "PostgresDurabilityGuard",
    "current_wal_lsn",
    "get_durability_guard",
    "load_backup_readiness",
]


class BackupReadinessError(ValueError):
    """The operator evidence cannot safely authorize a destructive commit."""


@dataclass(frozen=True, slots=True)
class BackupReadinessEvidence:
    system_identifier: str
    timeline: int
    base_backup_completed_at: datetime
    last_wal_received_at: datetime
    restore_tested_at: datetime


def _instant(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise BackupReadinessError(f"{field} must be an ISO-8601 instant")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise BackupReadinessError(f"{field} is not an ISO-8601 instant") from error
    if parsed.tzinfo is None:
        raise BackupReadinessError(f"{field} must include a timezone")
    return parsed.astimezone(UTC)


def load_backup_readiness(
    path: str | Path,
    *,
    now: datetime | None = None,
    max_backup_age: timedelta = timedelta(hours=26),
    max_restore_test_age: timedelta = timedelta(days=31),
) -> BackupReadinessEvidence:
    """Load fail-closed, operator-published backup/restore evidence.

    The file is mounted read-only from outside the application container. Live
    receiver state is still checked in PostgreSQL; this evidence proves that a
    recent verified base copy, keys and deletion journal are recoverable.
    """
    try:
        raw = Path(path).read_text(encoding="utf-8")
        payload = json.loads(raw)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise BackupReadinessError("backup readiness evidence is unavailable") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise BackupReadinessError("unsupported backup readiness schema")
    for field in (
        "ready",
        "wal_continuous",
        "checksum_verified",
        "deletion_journal_continuity",
        "keyring_available",
    ):
        if payload.get(field) is not True:
            raise BackupReadinessError(f"backup readiness requires {field}=true")
    system_identifier = payload.get("system_identifier")
    timeline = payload.get("timeline")
    if not isinstance(system_identifier, str) or not system_identifier.isdigit():
        raise BackupReadinessError("system_identifier must be a decimal string")
    if not isinstance(timeline, int) or isinstance(timeline, bool) or timeline < 1:
        raise BackupReadinessError("timeline must be a positive integer")
    base_backup = _instant(payload.get("base_backup_completed_at"), "base_backup_completed_at")
    last_wal = _instant(payload.get("last_wal_received_at"), "last_wal_received_at")
    restore_test = _instant(payload.get("restore_tested_at"), "restore_tested_at")
    current = (now or datetime.now(UTC)).astimezone(UTC)
    if current - base_backup > max_backup_age or base_backup > current + timedelta(minutes=5):
        raise BackupReadinessError("verified base backup is stale")
    if current - restore_test > max_restore_test_age or restore_test > current + timedelta(minutes=5):
        raise BackupReadinessError("full restore test is stale")
    if last_wal > current + timedelta(minutes=5):
        raise BackupReadinessError("WAL evidence is from the future")
    return BackupReadinessEvidence(
        system_identifier=system_identifier,
        timeline=timeline,
        base_backup_completed_at=base_backup,
        last_wal_received_at=last_wal,
        restore_tested_at=restore_test,
    )


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
            evidence = load_backup_readiness(self.settings.backup_readiness_path)
            system_row = (
                await self.db.execute(
                    text(
                        "SELECT s.system_identifier::text, c.timeline_id "
                        "FROM pg_control_system() s CROSS JOIN pg_control_checkpoint() c"
                    )
                )
            ).one()
            if str(system_row[0]) != evidence.system_identifier or int(system_row[1]) != evidence.timeline:
                return False
            return bool(
                (
                    await self.db.execute(
                        text(
                            "SELECT EXISTS ("
                            "SELECT 1 FROM pg_stat_replication r "
                            "JOIN pg_replication_slots s ON s.active_pid = r.pid "
                            "WHERE r.application_name = :application_name "
                            "AND s.slot_name = :slot_name AND s.slot_type = 'physical' "
                            "AND s.active AND COALESCE(s.wal_status, 'lost') <> 'lost' "
                            "AND r.state = 'streaming' AND r.sync_state IN ('sync','quorum') "
                            "AND r.flush_lsn IS NOT NULL)"
                        ),
                        {
                            "application_name": self.settings.backup_replication_application_name,
                            "slot_name": self.settings.backup_replication_slot,
                        },
                    )
                ).scalar_one()
            )
        except (BackupReadinessError, SQLAlchemyError, OSError, TypeError, ValueError):
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
                                "pg_wal_lsn_diff(r.flush_lsn, CAST(:lsn AS pg_lsn)) >= 0"
                                "), false) FROM pg_stat_replication r "
                                "JOIN pg_replication_slots s ON s.active_pid = r.pid "
                                "WHERE r.application_name = :application_name "
                                "AND s.slot_name = :slot_name AND s.slot_type = 'physical' "
                                "AND s.active AND COALESCE(s.wal_status, 'lost') <> 'lost' "
                                "AND r.state = 'streaming' AND r.sync_state IN ('sync','quorum')"
                            ),
                            {
                                "lsn": lsn,
                                "application_name": self.settings.backup_replication_application_name,
                                "slot_name": self.settings.backup_replication_slot,
                            },
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
