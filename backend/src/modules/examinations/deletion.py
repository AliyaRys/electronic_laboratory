"""E03: durable physical examination deletion without independent-fact loss."""

from __future__ import annotations

import uuid
from contextlib import suppress
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import Clock, moscow_date
from backend.src.core.commands import IdempotencyRecorder, UnitOfWork, canonical_request_hash, ensure_revision
from backend.src.core.contracts import CommandContext, CommandStateView
from backend.src.core.durability import DurabilityGuard, current_wal_lsn
from backend.src.core.problems import ProblemError, idempotency_mismatch, not_found
from backend.src.modules.examinations.models import Examination, ExaminationTombstone
from backend.src.modules.examinations.queries import examination_deleted, get_tombstone
from backend.src.modules.identity.models import CommandRecord, CommandStatus, TechnicalEvent
from backend.src.modules.samples.service import detach_examination_samples

__all__ = [
    "DeleteOutcome",
    "delete_examination",
    "finalize_delete",
    "recover_delete_operation",
    "delete_outcome_view",
]

ACTION = "examination.delete"


@dataclass(frozen=True, slots=True)
class DeleteOutcome:
    operation_id: uuid.UUID
    examination_id: uuid.UUID
    state: str
    first_attempt: bool
    problem: str | None = None
    updated_at: datetime | None = None


def delete_outcome_view(outcome: DeleteOutcome) -> CommandStateView:
    return CommandStateView(
        id=outcome.operation_id,
        kind="examination-delete",
        state=outcome.state,
        result_id=outcome.examination_id,
        problem=outcome.problem,
        updated_at=outcome.updated_at,
    )


def _backup_unavailable() -> ProblemError:
    return ProblemError(
        status=503,
        code="BACKUP_DURABILITY_UNAVAILABLE",
        title="Backup durability unavailable",
        detail="Удаление недоступно: резервный WAL-получатель не подтвердил готовность.",
    )


def _day_closed() -> ProblemError:
    return ProblemError(
        status=409,
        code="DAY_CLOSED",
        title="Day closed",
        detail="Карточку ВСЭ можно удалить только в день её создания по времени Europe/Moscow.",
    )


async def _record_for_key(
    db: AsyncSession, ctx: CommandContext, examination_id: uuid.UUID, request_hash: str
) -> CommandRecord | None:
    record = (
        await db.execute(
            select(CommandRecord).where(
                CommandRecord.actor_id == ctx.actor_id,
                CommandRecord.action == ACTION,
                CommandRecord.context_id == examination_id,
                CommandRecord.key == ctx.idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if record is not None and record.request_hash != request_hash:
        raise idempotency_mismatch()
    return record


async def _outcome(record: CommandRecord, *, first_attempt: bool) -> DeleteOutcome:
    state = record.status.value if isinstance(record.status, CommandStatus) else str(record.status)
    return DeleteOutcome(
        operation_id=record.id,
        examination_id=record.context_id,
        state=state,
        first_attempt=first_attempt,
        problem=record.problem_code,
        updated_at=record.finished_at or record.created_at,
    )


async def _recover_record(
    db: AsyncSession,
    record: CommandRecord,
    guard: DurabilityGuard,
) -> DeleteOutcome:
    if record.status == CommandStatus.SUCCESS:
        return await _outcome(record, first_attempt=False)
    tombstone = (
        await db.execute(select(ExaminationTombstone).where(ExaminationTombstone.command_id == record.id))
    ).scalar_one_or_none()
    if tombstone is None:
        raise ProblemError(
            status=409,
            code="OPERATION_UNRESOLVED",
            title="Operation unresolved",
            detail="Результат удаления ещё не подтверждён; повторите проверку операции.",
        )
    try:
        upper_lsn = await current_wal_lsn(db)
        flushed = await guard.wait_flushed(upper_lsn)
    except SQLAlchemyError, OSError:
        flushed = False
    if flushed:
        now = Clock().now()
        record.status = CommandStatus.SUCCESS
        record.problem_code = None
        record.finished_at = now
        await db.flush()
    return await _outcome(record, first_attempt=False)


async def delete_examination(
    ctx: CommandContext,
    examination_id: uuid.UUID,
    *,
    uow: AsyncSession,
    guard: DurabilityGuard,
    clock: Clock | None = None,
) -> DeleteOutcome:
    """Prepare the atomic delete; the HTTP coordinator commits and confirms WAL."""
    request_hash = canonical_request_hash(None, ctx.expected_revision)
    existing = await _record_for_key(uow, ctx, examination_id, request_hash)
    if existing is not None:
        return await _outcome(existing, first_attempt=False)

    row = (
        await uow.execute(select(Examination).where(Examination.id == examination_id).with_for_update())
    ).scalar_one_or_none()
    if row is None:
        # A competing identical request may have committed while this one was
        # waiting for the row lock. Re-read its actor/key-bound command first.
        existing = await _record_for_key(uow, ctx, examination_id, request_hash)
        if existing is not None:
            return await _outcome(existing, first_attempt=False)
        if await get_tombstone(uow, examination_id) is not None:
            raise examination_deleted()
        raise not_found("ВСЭ не найдена.")

    now = (clock or Clock()).now()
    ensure_revision(ctx.expected_revision, int(row.rev))
    if moscow_date(now) != moscow_date(row.created_at):
        raise _day_closed()
    if not await guard.ready():
        raise _backup_unavailable()

    # The DELETE transaction itself asks PostgreSQL for synchronous remote
    # durability. The guard already proved a synchronous streaming receiver.
    await uow.execute(text("SET LOCAL synchronous_commit = on"))
    work = UnitOfWork(uow)
    record = await IdempotencyRecorder().claim(
        work,
        actor_id=ctx.actor_id,
        action=ACTION,
        context_id=examination_id,
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    record.status = CommandStatus.UNKNOWN
    record.result_id = examination_id
    record.problem_code = "DURABILITY_UNCONFIRMED"

    await detach_examination_samples(uow, examination_id)
    uow.add(
        ExaminationTombstone(
            examination_id=examination_id,
            laboratory_id=row.laboratory_id,
            deleted_at=now,
            actor_id=ctx.actor_id,
            command_id=record.id,
        )
    )
    uow.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=examination_id,
            action="examination:delete",
            result="UNKNOWN",
            trace_id=uuid.uuid4().hex,
            revision=int(row.rev),
            operation_id=record.id,
        )
    )
    await uow.delete(row)
    await uow.flush()
    return await _outcome(record, first_attempt=True)


async def finalize_delete(
    db: AsyncSession,
    outcome: DeleteOutcome,
    guard: DurabilityGuard,
) -> DeleteOutcome:
    """Commit once, then prove remote flush; a lost commit answer stays UNKNOWN."""
    if outcome.first_attempt:
        try:
            await db.commit()
        except SQLAlchemyError, OSError:
            with suppress(SQLAlchemyError, OSError):
                await db.rollback()
            return replace(outcome, state="UNKNOWN", problem="DURABILITY_UNCONFIRMED")
    record = (
        await db.execute(select(CommandRecord).where(CommandRecord.id == outcome.operation_id).with_for_update())
    ).scalar_one_or_none()
    if record is None:
        return replace(outcome, state="UNKNOWN", problem="DURABILITY_UNCONFIRMED")
    recovered = await _recover_record(db, record, guard)
    try:
        await db.commit()
    except SQLAlchemyError, OSError:
        return replace(recovered, state="UNKNOWN", problem="DURABILITY_UNCONFIRMED")
    return recovered


async def recover_delete_operation(
    db: AsyncSession,
    operation_id: uuid.UUID,
    guard: DurabilityGuard,
) -> DeleteOutcome:
    record = (
        await db.execute(select(CommandRecord).where(CommandRecord.id == operation_id, CommandRecord.action == ACTION))
    ).scalar_one_or_none()
    if record is None:
        raise not_found("Операция удаления не найдена.")
    outcome = await _recover_record(db, record, guard)
    await db.commit()
    return outcome
