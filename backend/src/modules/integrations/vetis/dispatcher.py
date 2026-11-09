"""Dispatcher (ТЗ-10 V02): restore pending sync operations from SQL.

The dispatcher is the crash-recovery half of the durable outbox: after a
restart it re-reads the ``vetis_operations`` journal, re-enqueues every
``PENDING`` sync (and resets stale-``RUNNING`` leases back to ``PENDING``)
and hands the ids to the worker. The logic itself lives in
``sync.recover_pending_operations`` so the tests prove one implementation;
this module is the composition surface the worker startup and the ops runbook
call.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.integrations.vetis.sync import recover_pending_operations

__all__ = ["dispatch_pending_operations", "STALE_LEASE_AFTER"]

STALE_LEASE_AFTER = timedelta(hours=1)


async def dispatch_pending_operations(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    stale_after: timedelta = STALE_LEASE_AFTER,
) -> list[uuid.UUID]:
    """Restore every pending/stale sync operation and re-enqueue it (SQL only)."""
    return await recover_pending_operations(db, now=now, stale_after=stale_after)
