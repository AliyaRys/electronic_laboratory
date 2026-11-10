"""Full incoming pass (ТЗ-10 V02): atomic intent + outbox, honest checkpoints.

``start_sync`` writes the sync intent (``vetis_operations``) and its durable
outbox row in ONE transaction — the worker restores both from SQL after a
restart. It is idempotent: an overlapping (``PENDING``/``RUNNING``) sync for
the same laboratory is reused, never duplicated.

``run_sync`` performs the FULL page walk: the read identity/scope is re-read
from the database before EVERY SOAP call, so a revoked scope stops the run
before the next page. Checkpoints (``last_success`` on the binding and the
operation) move ONLY after a successful complete pass — a failure or a
revocation keeps the previous checkpoint and never fabricates an empty
success. A document missing from the source list is never annulled: the walk
only upserts, it never deletes local rows or local facts.

The write port is accepted as a seam for W01–W03, but while
``VETIS_WRITE_ENABLED=false`` it is never invoked — proven by the spy in
``backend/tests/vetis/test_sync.py::test_no_write_on_read_stage``.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Protocol

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.audit import write_structured_audit
from backend.src.core.contracts import CommandStateView
from backend.src.core.database import get_session_factory
from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.arrivals.commands import upsert_incoming
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentDTO
from backend.src.modules.identity.models import OutboxEntry
from backend.src.modules.integrations.vetis.contracts import IncomingPage, VetisScope
from backend.src.modules.integrations.vetis.models import (
    VetisBinding,
    VetisContour,
    VetisOperation,
    VetisOperationKind,
    VetisOperationState,
    VetisSourceDocument,
)

__all__ = [
    "SCHEDULE_INTERVAL",
    "SyncAccepted",
    "VetisReadPort",
    "VetisWritePort",
    "scheduled_sync_actor_id",
    "start_sync",
    "run_sync",
    "schedule_scheduled_syncs",
    "recover_pending_operations",
    "load_operation_state",
    "command_state_view",
]

SCHEDULE_INTERVAL = timedelta(minutes=15)
_LEASE_STALE_AFTER = timedelta(hours=1)
_OUTBOX_EVENT = "vetis.sync"

# The scheduled (15-minute) runs act as the platform service, never as a
# person; the fixed UUID is a service actor (same convention as the audit
# SERVICE_ACCOUNT). Manual runs carry the calling user's id.
_SERVICE_ACTOR = uuid.UUID("00000000-0000-0000-0000-0000000000aa")


def scheduled_sync_actor_id() -> uuid.UUID:
    """The service actor id of the 15-minute scheduler."""
    return _SERVICE_ACTOR


def _scope_missing() -> ProblemError:
    return ProblemError(
        status=422,
        code="INTEGRATION_SCOPE_MISSING",
        title="Enterprise binding missing",
        detail=(
            "Поступление не привязано однозначно к лаборатории: связь площадки "
            "с хозяйствующим субъектом не зарегистрирована. Обновление не выполнено."
        ),
    )


def _scope_revoked() -> ProblemError:
    return ProblemError(
        status=422,
        code="INTEGRATION_SCOPE_REVOKED",
        title="Enterprise binding revoked",
        detail="Доступ к тестовому контуру ВетИС для площадки отозван; чтение остановлено.",
    )


class _AuditUow:
    """The session adapter the structured audit recorder expects (never commits)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session


class SyncAccepted(BaseModel):
    """API-04: the 202 answer of POST /arrivals/sync — never a sync confirmation."""

    model_config = ConfigDict(extra="forbid")

    operation_id: uuid.UUID
    state: str
    status_url: str


class VetisReadPort(Protocol):
    async def list_incoming(self, scope: VetisScope, cursor: str | None, initiator: str) -> IncomingPage: ...


class VetisWritePort(Protocol):
    """The W01+ seam; never invoked while ``VETIS_WRITE_ENABLED=false``."""

    async def submit_receipt(self, intent: object, initiator: str) -> object: ...

    async def get_operation(self, application_id: str, initiator: str) -> object: ...

    async def reconcile_receipt(self, intent: object, initiator: str) -> object: ...


def _binding_scope(binding: VetisBinding) -> VetisScope:
    return VetisScope(
        laboratory_id=binding.laboratory_id,
        contour=VetisContour(binding.contour),
        business_member_id=binding.business_member_id,
        enterprise_id=binding.enterprise_id,
        initiator=binding.initiator,
    )


def _session_factory(override: async_sessionmaker[AsyncSession] | None) -> async_sessionmaker[AsyncSession]:
    return override if override is not None else get_session_factory()


# --- the accepted intent --------------------------------------------------------


async def _active_binding(db: AsyncSession, laboratory_id: uuid.UUID) -> VetisBinding | None:
    binding = (
        await db.execute(select(VetisBinding).where(VetisBinding.laboratory_id == laboratory_id))
    ).scalar_one_or_none()
    if binding is None or binding.revoked_at is not None:
        return None
    return binding


async def _overlapping_operation(db: AsyncSession, laboratory_id: uuid.UUID) -> VetisOperation | None:
    return (
        await db.execute(
            select(VetisOperation)
            .where(
                VetisOperation.laboratory_id == laboratory_id,
                VetisOperation.kind == VetisOperationKind.SYNC,
                VetisOperation.state.in_(("PENDING", "RUNNING")),
            )
            .order_by(VetisOperation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def start_sync(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID,
    laboratory_id: uuid.UUID,
    manual: bool = True,
) -> SyncAccepted:
    """Accept the sync intent atomically: one operation row + one outbox row.

    Overlap protection: an existing ``PENDING``/``RUNNING`` sync for the
    laboratory is returned as-is (manual refresh uses the same job as the
    15-minute scheduler — no duplicate intent, no duplicate outbox row).
    """
    binding = await _active_binding(db, laboratory_id)
    if binding is None:
        raise _scope_missing()
    overlapping = await _overlapping_operation(db, laboratory_id)
    if overlapping is not None:
        return SyncAccepted(
            operation_id=overlapping.id,
            state=overlapping.state,
            status_url=f"/api/v1/operations/{overlapping.id}",
        )
    operation = VetisOperation(
        kind=VetisOperationKind.SYNC,
        state=VetisOperationState.PENDING,
        laboratory_id=laboratory_id,
        contour=binding.contour,
        created_by=actor_id,
    )
    db.add(operation)
    await db.flush()
    db.add(
        OutboxEntry(
            operation_id=operation.id,
            event_type=_OUTBOX_EVENT,
            payload={"operation_id": str(operation.id), "laboratory_id": str(laboratory_id)},
        )
    )
    write_structured_audit(
        _AuditUow(db),
        actor_id=actor_id,
        action="VETIS.SYNC_ACCEPTED",
        object_uuid=operation.id,
        result="ACCEPTED",
        trace_id=operation.trace_id,
        operation_id=operation.id,
    )
    return SyncAccepted(
        operation_id=operation.id,
        state=operation.state,
        status_url=f"/api/v1/operations/{operation.id}",
    )


# --- the durable worker ---------------------------------------------------------


def _transport_problem(exc: Exception) -> ProblemError:
    if isinstance(exc, ProblemError):
        return exc
    return ProblemError(
        status=502,
        code="VETIS_SYNC_FAILED",
        title="VetIS sync failed",
        detail="Обновление поступлений из ВетИС не завершено; контрольная точка не изменена.",
    )


def _import_problem(exc: Exception) -> ProblemError:
    """An import failure (DB constraint, upsert error) is recorded honestly."""
    return ProblemError(
        status=500,
        code="VETIS_IMPORT_FAILED",
        title="VetIS import failed",
        detail=f"Импорт страницы прерван ({type(exc).__name__}); контрольная точка не изменена.",
    )


def _cursor_contract_problem() -> ProblemError:
    """A non-complete page without a next cursor violates the read contract."""
    return ProblemError(
        status=502,
        code="VETIS_CURSOR_CONTRACT_VIOLATED",
        title="VetIS cursor contract violated",
        detail="Ответ ВетИС не содержит курсор следующей страницы при незавершённом проходе; операция остановлена.",
    )


async def _fail_operation(db: AsyncSession, operation: VetisOperation, problem: ProblemError, *, now: datetime) -> None:
    await db.execute(
        update(VetisOperation)
        .where(VetisOperation.id == operation.id)
        .values(
            state=VetisOperationState.FAILED,
            finished_at=now,
            updated_at=now,
            problem_code=problem.code,
            problem_detail=problem.detail,
        )
    )
    # Finalize the durable outbox row: the failure is terminal, so no retry
    # storm and no stale-lease resurrection afterwards.
    await db.execute(
        update(OutboxEntry)
        .where(
            OutboxEntry.operation_id == operation.id,
            OutboxEntry.event_type == _OUTBOX_EVENT,
            OutboxEntry.delivered_at.is_(None),
        )
        .values(delivered_at=now, lease_until=None)
    )
    write_structured_audit(
        _AuditUow(db),
        actor_id=operation.created_by or scheduled_sync_actor_id(),
        action="VETIS.SYNC_FAILED",
        object_uuid=operation.id,
        result=problem.code,
        trace_id=operation.trace_id,
        operation_id=operation.id,
    )


async def run_sync(
    operation_id: uuid.UUID,
    *,
    adapter: VetisReadPort,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    write_port: VetisWritePort | None = None,
) -> None:
    """The durable full pass of one accepted sync operation.

    Page loop: read identity/scope re-check from SQL before EVERY SOAP call;
    each page is imported in its own committed transaction; the checkpoint
    moves only after ``complete=True``. The write port is never invoked at
    this stage (``VETIS_WRITE_ENABLED=false``); it exists purely as the W01
    seam and is left untouched here.
    """
    del write_port  # the read stage performs zero external writes (W01 flips the flag)
    factory = _session_factory(session_factory)
    now = datetime.now(UTC)

    async with factory() as db:
        operation = (
            await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id))
        ).scalar_one_or_none()
        if operation is None:
            raise not_found()
        if operation.state != VetisOperationState.PENDING:
            return  # already claimed/finished — the worker is idempotent
        claimed = await db.execute(
            update(VetisOperation)
            .where(VetisOperation.id == operation_id, VetisOperation.state == VetisOperationState.PENDING)
            .values(state=VetisOperationState.RUNNING, started_at=now, updated_at=now)
        )
        if claimed.rowcount == 0:  # type: ignore[attr-defined]  # DML result carries rowcount
            return
        await db.commit()

    cursor: str | None = None
    pages_done = 0
    imported = 0
    while True:
        async with factory() as db:
            operation = (await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id))).scalar_one()
            if operation.state != VetisOperationState.RUNNING:
                return  # recovered/canceled elsewhere — stop honestly
            # Read identity/scope re-check BEFORE the SOAP call of this page.
            binding = await _active_binding(db, operation.laboratory_id)
            if binding is None:
                problem = _scope_revoked() if await _was_revoked(db, operation.laboratory_id) else _scope_missing()
                await _fail_operation(db, operation, problem, now=datetime.now(UTC))
                await db.commit()
                return
            if not (binding.initiator or "").strip():
                await _fail_operation(
                    db,
                    operation,
                    ProblemError(
                        status=422,
                        code="INTEGRATION_INITIATOR_MISSING",
                        title="Integration initiator missing",
                        detail="Инициатор чтения ВетИС не зарегистрован; операция не выполнена.",
                    ),
                    now=datetime.now(UTC),
                )
                await db.commit()
                return
            try:
                current_page: IncomingPage = await adapter.list_incoming(
                    _binding_scope(binding), cursor, binding.initiator or ""
                )
            except Exception as exc:  # noqa: BLE001 - any failure is an honest FAILED run
                await _fail_operation(db, operation, _transport_problem(exc), now=datetime.now(UTC))
                await db.commit()
                return
            try:
                for item in current_page.items:
                    await _import_item(db, operation, item, current_page)
            except Exception as exc:  # noqa: BLE001 - an import failure is ALSO an honest FAILED run
                await _fail_operation(db, operation, _import_problem(exc), now=datetime.now(UTC))
                await db.commit()
                return
            pages_done += 1
            imported += len(current_page.items)
            await db.execute(
                update(VetisOperation)
                .where(VetisOperation.id == operation_id)
                .values(pages_done=pages_done, imported=imported, updated_at=datetime.now(UTC))
            )
            # Pagination contract (API-04/DATA-06): a non-complete page MUST
            # carry a next cursor; otherwise re-entering the loop would restart
            # the walk forever with cursor=None. Fail honestly instead.
            if not current_page.complete and current_page.next_cursor is None:
                await _fail_operation(db, operation, _cursor_contract_problem(), now=datetime.now(UTC))
                await db.commit()
                return
            await db.commit()
        if current_page.complete:
            break
        cursor = current_page.next_cursor

    async with factory() as db:
        checkpoint = datetime.now(UTC)
        operation = (await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id))).scalar_one()
        if operation.state != VetisOperationState.RUNNING:
            return
        await db.execute(
            update(VetisOperation)
            .where(VetisOperation.id == operation_id)
            .values(
                state=VetisOperationState.SUCCESS,
                finished_at=checkpoint,
                updated_at=checkpoint,
                last_success=checkpoint,
            )
        )
        # THE checkpoint: only a successful FULL pass moves it.
        await db.execute(
            update(VetisBinding)
            .where(VetisBinding.laboratory_id == operation.laboratory_id)
            .values(last_success=checkpoint)
        )
        write_structured_audit(
            _AuditUow(db),
            actor_id=operation.created_by or scheduled_sync_actor_id(),
            action="VETIS.SYNC_COMPLETED",
            object_uuid=operation.id,
            result="SUCCESS",
            trace_id=operation.trace_id,
            operation_id=operation.id,
        )
        await db.commit()


async def _was_revoked(db: AsyncSession, laboratory_id: uuid.UUID) -> bool:
    row = (
        await db.execute(select(VetisBinding.revoked_at).where(VetisBinding.laboratory_id == laboratory_id))
    ).scalar_one_or_none()
    return row is not None


async def _import_item(
    db: AsyncSession, operation: VetisOperation, item: IncomingDocumentDTO, page: IncomingPage
) -> None:
    """Upsert one eVSD + journal its raw source XML (same transaction)."""
    await upsert_incoming(db, item)
    raw = page.raw_documents.get(str(item.evsd_uuid))
    if raw is None:
        return
    checksum = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    existing = (
        await db.execute(
            select(VetisSourceDocument).where(
                VetisSourceDocument.contour == str(item.contour),
                VetisSourceDocument.evsd_uuid == item.evsd_uuid,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            VetisSourceDocument(
                contour=str(item.contour),
                evsd_uuid=item.evsd_uuid,
                laboratory_id=item.laboratory_id or operation.laboratory_id,
                raw_xml=raw,
                checksum=checksum,
            )
        )
    elif existing.checksum != checksum:
        await db.execute(
            update(VetisSourceDocument)
            .where(VetisSourceDocument.id == existing.id)
            .values(raw_xml=raw, checksum=checksum, revision=existing.revision + 1, updated_at=datetime.now(UTC))
        )


# --- the 15-minute scheduler ----------------------------------------------------


async def schedule_scheduled_syncs(
    db: AsyncSession,
    *,
    now: datetime,
    actor_id: uuid.UUID | None = None,
    interval: timedelta = SCHEDULE_INTERVAL,
) -> list[SyncAccepted]:
    """Enqueue the 15-minute runs for every bound laboratory.

    A laboratory is due when it has NO overlapping (PENDING/RUNNING) sync AND
    its checkpoint is older than the interval (or it never succeeded). The
    overlap protection inside :func:`start_sync` keeps repeats honest.
    """
    actor = actor_id or scheduled_sync_actor_id()
    bindings = list((await db.execute(select(VetisBinding).where(VetisBinding.revoked_at.is_(None)))).scalars())
    accepted: list[SyncAccepted] = []
    for binding in bindings:
        if binding.last_success is not None and now - binding.last_success < interval:
            continue
        if await _overlapping_operation(db, binding.laboratory_id) is not None:
            continue  # overlap protection: an in-flight run is never duplicated
        accepted.append(await start_sync(db, actor_id=actor, laboratory_id=binding.laboratory_id, manual=False))
    return accepted


# --- the dispatcher (restart recovery) ------------------------------------------


async def recover_pending_operations(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    stale_after: timedelta = _LEASE_STALE_AFTER,
) -> list[uuid.UUID]:
    """Restore pending operations from SQL after a restart.

    Every ``PENDING`` sync and every stale-``RUNNING`` sync (its lease died
    with the crashed worker) gets a fresh undelivered outbox row; the worker
    then claims them through the normal lease path. Returns the operation ids
    that are (again) enqueueable.
    """
    current = now or datetime.now(UTC)
    pending = list(
        (
            await db.execute(
                select(VetisOperation).where(
                    VetisOperation.kind == VetisOperationKind.SYNC,
                    VetisOperation.state == VetisOperationState.PENDING,
                )
            )
        ).scalars()
    )
    stale = list(
        (
            await db.execute(
                select(VetisOperation).where(
                    VetisOperation.kind == VetisOperationKind.SYNC,
                    VetisOperation.state == VetisOperationState.RUNNING,
                    VetisOperation.updated_at < current - stale_after,
                )
            )
        ).scalars()
    )
    restored: list[uuid.UUID] = []
    for operation in (*pending, *stale):
        if operation.state == VetisOperationState.RUNNING:
            await db.execute(
                update(VetisOperation)
                .where(VetisOperation.id == operation.id)
                .values(
                    state=VetisOperationState.PENDING,
                    updated_at=current,
                    # A recovered stale lease is never silent: the interrupted
                    # run keeps an honest problem code until it reruns.
                    problem_code=operation.problem_code or "VETIS_SYNC_INTERRUPTED",
                    problem_detail=operation.problem_detail
                    or "Работа прервана перезапуском; операция будет повторена.",
                )
            )
            operation.state = VetisOperationState.PENDING
        has_due = (
            await db.execute(
                select(OutboxEntry.id)
                .where(
                    OutboxEntry.operation_id == operation.id,
                    OutboxEntry.event_type == _OUTBOX_EVENT,
                    OutboxEntry.delivered_at.is_(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if has_due is None:
            db.add(
                OutboxEntry(
                    operation_id=operation.id,
                    event_type=_OUTBOX_EVENT,
                    payload={"operation_id": str(operation.id), "laboratory_id": str(operation.laboratory_id)},
                )
            )
        restored.append(operation.id)
    return restored


# --- API-01 operation state -----------------------------------------------------


def command_state_view(operation: VetisOperation) -> CommandStateView:
    """The API-01 CommandState of one VetIS sync operation (DATA-05)."""
    return CommandStateView(
        id=operation.id,
        kind="vetis.receipt" if operation.kind == VetisOperationKind.RECEIPT else "vetis.sync",
        state=str(operation.state),
        problem=operation.problem_code,
        updated_at=operation.updated_at,
    )


async def load_operation_state(db: AsyncSession, operation_id: uuid.UUID) -> VetisOperation | None:
    """Resolve one VetIS operation row for GET /operations/:id (scope-checked upstream)."""
    return (
        await db.execute(
            select(VetisOperation).where(VetisOperation.id == operation_id)
        )
    ).scalar_one_or_none()
