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
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.identity.models import OutboxEntry
from backend.src.modules.integrations.vetis.models import VetisOperation, VetisOperationKind, VetisOperationState
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
    restored = await recover_pending_operations(db, now=now, stale_after=stale_after)
    current = now or datetime.now(UTC)
    receipts = list(
        (
            await db.execute(
                select(VetisOperation).where(
                    VetisOperation.kind == VetisOperationKind.RECEIPT,
                    VetisOperation.state.in_(
                        (VetisOperationState.QUEUED, VetisOperationState.SUBMITTING, VetisOperationState.PROCESSING)
                    ),
                )
            )
        ).scalars()
    )
    for operation in receipts:
        due = (
            await db.execute(
                select(OutboxEntry.id).where(
                    OutboxEntry.operation_id == operation.id,
                    OutboxEntry.event_type == "vetis.receipt",
                    OutboxEntry.delivered_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if due is None:
            db.add(
                OutboxEntry(
                    operation_id=operation.id,
                    event_type="vetis.receipt",
                    payload={"operation_id": str(operation.id)},
                    next_attempt_at=operation.next_poll_at or current,
                )
            )
        restored.append(operation.id)
    return restored
