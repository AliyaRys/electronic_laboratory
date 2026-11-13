"""The VetIS worker (ТЗ-10 V02): lease outbox rows, run the sync, schedule.

Three responsibilities, all proven against the real PostgreSQL journal in
``backend/tests/vetis/test_sync.py``:

- **lease worker** — a due ``vetis.sync`` outbox row is claimed with an
  owner/lease deadline (``SKIP LOCKED``), so two workers never run the same
  operation; ``run_sync`` stays idempotent even if a lease lapses;
- **15-minute scheduler** — every bound laboratory whose checkpoint is older
  than the interval gets the SAME job the manual refresh button enqueues
  (overlap protection inside ``start_sync``);
- **composition root** — the pinned read adapter is built here (and only
  here); until the WSDL/XSD are pinned the adapter honestly answers
  ``503 INTEGRATION_NOT_CONFIGURED`` and the run fails without moving the
  checkpoint — API readiness never depends on VetIS.

The arq worker (same backend image, Redis transport) is wired below; the
pure-Python functions are the tested contract.
"""

from __future__ import annotations

import contextlib
import logging
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import get_session_factory
from backend.src.modules.arrivals.confirmation import confirm_receipt
from backend.src.modules.arrivals.ports import ReceiptEvidence
from backend.src.modules.identity.models import OutboxEntry
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
from backend.src.modules.integrations.vetis.contracts import ExternalResult, ReceiptIntent
from backend.src.modules.integrations.vetis.dispatcher import dispatch_pending_operations
from backend.src.modules.integrations.vetis.evidence import parse_receipt_result
from backend.src.modules.integrations.vetis.models import (
    VetisOperation,
    VetisOperationKind,
    VetisOperationState,
    VetisSourceDocument,
)
from backend.src.modules.integrations.vetis.polling import MAX_PROCESSING, poll_delay
from backend.src.modules.integrations.vetis.receipt import write_enabled
from backend.src.modules.integrations.vetis.receipt_mapping import build_process_incoming_application
from backend.src.modules.integrations.vetis.reconcile import reconcile_receipt
from backend.src.modules.integrations.vetis.transport import ZeepApplicationTransport, imports_allowlist

__all__ = [
    "SCHEDULE_INTERVAL",
    "LEASE_TIMEOUT",
    "claim_due_operation",
    "run_claimed",
    "run_sync_operation",
    "schedule_scheduled_syncs",
    "compose_read_adapter",
    "purpose_sync_tick",
    "reference_names_tick",
    "run_receipt_operation",
    "WorkerSettings",
]

SCHEDULE_INTERVAL = sync.SCHEDULE_INTERVAL
LEASE_TIMEOUT = timedelta(minutes=10)

_LOG = logging.getLogger("vetis.worker")


def compose_read_adapter() -> VetisReadAdapter:
    """Build the pinned read adapter from the server-side profile.

    The manifest always comes from the SINGLE runtime composition path
    (``load_runtime_manifest``, ТЗ DR23 §5.1): committed manifest + pin
    overlay + SHA-256 verification.  In an installation whose pins are
    absent/PENDING the committed manifest keeps its recorded state and the
    adapter honestly refuses live calls (503) — the composition never skips
    pin verification, and the issued test profile (secret file) is simply
    absent right now.
    """
    from backend.src.core.problems import ProblemError
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.manifest import (
        load_manifest,
        load_runtime_manifest,
        load_secret_profile,
        secret_profile_path,
    )
    from backend.src.modules.integrations.vetis.manifest import manifest_path as committed_manifest_path

    try:
        manifest = load_runtime_manifest()
    except ProblemError:
        # The unconfigured installation: keep the committed manifest (its
        # recorded pins state) so the adapter refuses live calls honestly.
        manifest = load_manifest(committed_manifest_path())
    issuer_id = ""
    api_key = None
    gateway_user = None
    gateway_password = None
    profile_path = secret_profile_path()
    if profile_path:
        profile = load_secret_profile(profile_path)
        issuer_id = profile.issuer_id
        api_key = profile.api_key
        gateway_user = profile.gateway_user
        gateway_password = profile.gateway_password
    transport = ZeepApplicationTransport(
        endpoint=manifest.endpoint,
        allowed_urls=imports_allowlist(manifest),
        gateway_user=gateway_user,
        gateway_password=gateway_password,
        api_key=api_key,
        issuer_id=issuer_id,
    )
    return VetisReadAdapter(
        transport=transport,
        manifest=manifest,
        issuer_id=issuer_id,
        api_key=api_key,
    )


async def claim_due_operation(db: AsyncSession, *, owner: str, now: datetime | None = None) -> uuid.UUID | None:
    """Claim one due ``vetis.sync`` outbox row (lease, SKIP LOCKED)."""
    current = now or datetime.now(UTC)
    due = (
        await db.execute(
            select(OutboxEntry)
            .where(
                OutboxEntry.event_type.in_(("vetis.sync", "vetis.receipt")),
                OutboxEntry.delivered_at.is_(None),
                OutboxEntry.next_attempt_at <= current,
            )
            .where((OutboxEntry.lease_until.is_(None)) | (OutboxEntry.lease_until < current))
            .order_by(OutboxEntry.next_attempt_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if due is None:
        return None
    await db.execute(
        update(OutboxEntry)
        .where(OutboxEntry.id == due.id)
        .values(
            lease_owner=owner,
            lease_until=current + LEASE_TIMEOUT,
            next_attempt_at=current + LEASE_TIMEOUT,
        )
    )
    await db.commit()
    return due.operation_id


async def run_claimed(
    db: AsyncSession,
    operation_id: uuid.UUID,
    *,
    adapter: VetisReadAdapter | None = None,
    owner: str = "worker",
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> bool:
    """Run one claimed operation and mark the outbox row delivered.

    ``run_sync`` always drives the operation to a terminal state (SUCCESS or
    an honest FAILED), so the outbox row is delivered either way; an
    operation that left the RUNNING path elsewhere stays undelivered for the
    retry backoff.
    """
    if adapter is None:
        adapter = compose_read_adapter()
    operation = (await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id))).scalar_one()
    if operation.kind == VetisOperationKind.RECEIPT:
        if not write_enabled():
            await db.execute(
                update(OutboxEntry)
                .where(OutboxEntry.operation_id == operation_id, OutboxEntry.delivered_at.is_(None))
                .values(
                    next_attempt_at=datetime.now(UTC) + timedelta(minutes=1),
                    lease_owner=None,
                    lease_until=None,
                )
            )
            await db.commit()
            return False
        adapter.require_live_ready()
        await run_receipt_operation(
            operation_id,
            transport=adapter._transport,
            session_factory=session_factory,
            service_id=adapter._manifest.service_id,
            issuer_id=adapter._issuer_id,
            api_key=adapter._api_key,
        )
    else:
        await sync.run_sync(operation_id, adapter=adapter, session_factory=session_factory)
    state = (
        await db.execute(select(VetisOperation.state).where(VetisOperation.id == operation_id))
    ).scalar_one_or_none()
    terminal = state in (
        VetisOperationState.SUCCESS,
        VetisOperationState.FAILED,
        VetisOperationState.CONFIRMED,
        VetisOperationState.REJECTED,
        VetisOperationState.UNKNOWN,
    )
    if terminal:
        await db.execute(
            update(OutboxEntry)
            .where(OutboxEntry.operation_id == operation_id, OutboxEntry.delivered_at.is_(None))
            .values(delivered_at=datetime.now(UTC), lease_owner=owner, lease_until=None)
        )
        await db.commit()
    elif operation.kind == VetisOperationKind.RECEIPT:
        next_poll = (
            await db.execute(select(VetisOperation.next_poll_at).where(VetisOperation.id == operation_id))
        ).scalar_one_or_none()
        await db.execute(
            update(OutboxEntry)
            .where(OutboxEntry.operation_id == operation_id, OutboxEntry.delivered_at.is_(None))
            .values(next_attempt_at=next_poll or datetime.now(UTC), lease_owner=None, lease_until=None)
        )
        await db.commit()
    return bool(terminal)


async def run_receipt_operation(
    operation_id: uuid.UUID,
    *,
    transport: object,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    service_id: str = "mercury-vu.service:2.0",
    issuer_id: str = "",
    api_key: str | None = None,
) -> None:
    """Submit once, then poll/reconcile; a lost submit response is UNKNOWN.

    The SUBMITTING transition is committed before external I/O.  Therefore a
    replacement worker never repeats an irreversible submit: it only polls an
    already stored application id or freezes UNKNOWN when that id was lost.
    """
    factory = session_factory or get_session_factory()
    first_submit = False
    intent: ReceiptIntent
    async with factory() as db:
        operation = (
            await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id).with_for_update())
        ).scalar_one()
        if operation.kind != VetisOperationKind.RECEIPT or operation.intent is None:
            return
        intent = ReceiptIntent.model_validate(operation.intent)
        if operation.state == VetisOperationState.CONFIRMED and operation.evidence is not None:
            await confirm_receipt(db, ReceiptEvidence.model_validate(operation.evidence))
            await db.commit()
            return
        source_xml = (
            await db.execute(
                select(VetisSourceDocument.raw_xml).where(
                    VetisSourceDocument.contour == str(intent.contour),
                    VetisSourceDocument.evsd_uuid == intent.source_evsd_uuid,
                    VetisSourceDocument.revision == intent.source_revision,
                    VetisSourceDocument.checksum == intent.source_checksum,
                )
            )
        ).scalar_one_or_none()
        if source_xml is None:
            operation.state = VetisOperationState.UNKNOWN
            operation.problem_code = "VETIS_SOURCE_REVISION_LOST"
            operation.problem_detail = "Закреплённая версия исходного XML недоступна; отправка запрещена."
            await db.commit()
            return
        if operation.state == VetisOperationState.QUEUED:
            operation.state = VetisOperationState.SUBMITTING
            operation.started_at = datetime.now(UTC)
            operation.updated_at = datetime.now(UTC)
            first_submit = True
            await db.commit()
        elif operation.state == VetisOperationState.SUBMITTING and not operation.application_id:
            operation.state = VetisOperationState.UNKNOWN
            operation.problem_code = "VETIS_SUBMIT_OUTCOME_UNKNOWN"
            operation.problem_detail = (
                "Ответ submit с applicationId утрачен; повторная отправка автоматически запрещена."
            )
            await db.commit()
            return
        elif operation.state not in (VetisOperationState.SUBMITTING, VetisOperationState.PROCESSING):
            return

    if first_submit:
        xml = build_process_incoming_application(
            intent,
            source_xml=source_xml,
            service_id=service_id,
            issuer_id=issuer_id,
            api_key=api_key,
        )
        try:
            application_id = await transport.send_application(xml)  # type: ignore[attr-defined]
            if not application_id:
                raise RuntimeError("missing application id")
        except Exception:  # noqa: BLE001 - outcome may be externally committed
            async with factory() as db:
                operation = (
                    await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id).with_for_update())
                ).scalar_one()
                operation.state = VetisOperationState.UNKNOWN
                operation.problem_code = "VETIS_SUBMIT_OUTCOME_UNKNOWN"
                operation.problem_detail = (
                    "Связь оборвалась во время submit; автоматическая повторная отправка запрещена."
                )
                operation.updated_at = datetime.now(UTC)
                await db.commit()
            return
        async with factory() as db:
            operation = (
                await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id).with_for_update())
            ).scalar_one()
            operation.application_id = str(application_id)
            operation.state = VetisOperationState.PROCESSING
            operation.submitted_at = datetime.now(UTC)
            operation.next_poll_at = datetime.now(UTC)
            operation.updated_at = datetime.now(UTC)
            await db.commit()

    async with factory() as db:
        operation = (
            await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id).with_for_update())
        ).scalar_one()
        application_id = operation.application_id
        submitted_at = operation.submitted_at
        attempts = operation.poll_attempts
    if not application_id:
        return
    if submitted_at and datetime.now(UTC) - submitted_at >= MAX_PROCESSING:
        async with factory() as db:
            operation = (
                await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id).with_for_update())
            ).scalar_one()
            operation.state = VetisOperationState.UNKNOWN
            operation.problem_code = "VETIS_RESULT_TIMEOUT"
            operation.problem_detail = "Результат не подтверждён за 15 минут; повторная отправка запрещена."
            await db.commit()
        return
    try:
        result_xml = await transport.receive_result(application_id)  # type: ignore[attr-defined]
    except Exception:  # polling is safe to repeat
        result = ExternalResult(
            application_id=application_id,
            state="PROCESSING",
            detail={"problem": "VETIS_POLL_TEMPORARY_FAILURE"},
        )
    else:
        result = parse_receipt_result(result_xml, intent, application_id=application_id)
    async with factory() as db:
        operation = (
            await db.execute(select(VetisOperation).where(VetisOperation.id == operation_id).with_for_update())
        ).scalar_one()
        if result.state == "PROCESSING":
            operation.poll_attempts = attempts + 1
            operation.next_poll_at = datetime.now(UTC) + poll_delay(attempts)
        else:
            await reconcile_receipt(db, operation, result)
            operation.finished_at = datetime.now(UTC)
            operation.next_poll_at = None
        operation.updated_at = datetime.now(UTC)
        await db.commit()


async def run_sync_operation(operation_id: uuid.UUID) -> None:
    """The documented worker entry point: ``run_sync(operation_id: UUID) -> None``.

    Deliberately NOT named ``run_sync`` to avoid shadowing the tested
    application function it delegates to.
    """
    await sync.run_sync(operation_id, adapter=compose_read_adapter())


async def schedule_scheduled_syncs(db: AsyncSession, *, now: datetime | None = None) -> list[sync.SyncAccepted]:
    """The 15-minute scheduler tick: enqueue due laboratories (same job)."""
    return await sync.schedule_scheduled_syncs(
        db, now=now or datetime.now(UTC), actor_id=sync.scheduled_sync_actor_id()
    )


async def _startup(_: dict[str, Any]) -> None:
    """arq startup: restore pending operations from SQL before polling."""
    factory = get_session_factory()
    async with factory() as session:
        await dispatch_pending_operations(session)
        await session.commit()
    with contextlib.suppress(Exception):  # the backfill never blocks the worker
        await backfill_reference_names_startup()

async def _job_run_vetis_sync(ctx: dict[str, Any], *, operation_id: str) -> None:  # pragma: no cover - arq entry
    await sync.run_sync(uuid.UUID(operation_id), adapter=compose_read_adapter())


async def _job_vetis_scheduler(ctx: dict[str, Any]) -> None:  # pragma: no cover - arq entry
    factory = get_session_factory()
    async with factory() as session:
        await schedule_scheduled_syncs(session)
        await session.commit()
    await purpose_sync_tick()
    await reference_names_tick()


async def purpose_sync_tick() -> dict[str, object]:
    """The 14-day purpose-dictionary check at every scheduler tick.

    Never per page view and never per document: the due check runs here and
    the full read-only pass (when due) is the ONLY GetPurposeList traffic.
    The manifest comes from the single runtime composition path (ТЗ DR23 §5.1).
    """
    from backend.src.core.problems import ProblemError
    from backend.src.modules.integrations.vetis.manifest import load_runtime_manifest
    from backend.src.modules.integrations.vetis.purpose_sync import (
        compose_purpose_transport,
        run_due_purpose_sync,
    )

    try:
        manifest = load_runtime_manifest()
        transport, _contour = compose_purpose_transport(manifest)
    except ProblemError as problem:
        return {"result": "NOT_CONFIGURED", "problem": problem.code}
    return await run_due_purpose_sync(transport=transport, manifest=manifest)


def _log_reference_names_tick(result: dict[str, object]) -> None:
    """The structured, secret-free tick diagnostic (ТЗ DR23 §5.3).

    Only counters and stable problem codes are published: no credentials,
    apiKey, issuerId, raw SOAP or XML ever reach the log.  An unconfigured or
    failed tick NEVER looks like a successful empty one.
    """
    _LOG.info(
        "reference_names_tick",
        extra={
            "result": str(result.get("result")),
            "claimed": int(result.get("claimed", 0)),
            "resolved": int(result.get("resolved", 0)),
            "retried": int(result.get("retried", 0)),
            "problem_code": result.get("problem"),
            "contour": result.get("contour"),
        },
    )


async def reference_names_tick() -> dict[str, object]:
    """The due read-only participant-name resolution at every scheduler tick.

    Never per page view and never per document: the tick resolves the due
    PENDING/refreshable entries through the pinned EnterpriseService lookups
    (ТЗ DR18 §8).  The manifest comes from the same runtime composition path
    as the main read adapter (ТЗ DR23 §5.1): until the pins verify, the tick
    answers ``NOT_CONFIGURED`` honestly WITHOUT any network contact; the
    import and every screen work regardless.
    """
    from backend.src.core.problems import ProblemError
    from backend.src.modules.integrations.vetis.manifest import load_runtime_manifest
    from backend.src.modules.integrations.vetis.reference_names import (
        compose_reference_transport,
        resolve_due_reference_names,
    )

    try:
        manifest = load_runtime_manifest()
        transport = compose_reference_transport(manifest)
    except ProblemError as problem:
        result = {
            "result": "NOT_CONFIGURED",
            "problem": problem.code,
            "claimed": 0,
            "resolved": 0,
            "retried": 0,
            "contour": None,
        }
        _log_reference_names_tick(result)
        return result
    factory = get_session_factory()
    try:
        async with factory() as session:
            counters = await resolve_due_reference_names(
                session, transport, contour=manifest.contour
            )
    except Exception as exc:  # noqa: BLE001 - an honest tick diagnostic, not a silent cron
        result = {"result": "ERROR", "problem": type(exc).__name__, "contour": manifest.contour}
        _log_reference_names_tick(result)
        return result
    result = {"result": "SUCCESS", "contour": manifest.contour, **counters}
    _log_reference_names_tick(result)
    return result


async def backfill_reference_names_startup() -> dict[str, int] | None:
    """The safe idempotent backfill at worker startup (ТЗ DR18 §7).

    Only derived cache rows/queue entries are created from the ALREADY stored
    source snapshots: the raw XML, checksum, revision and every local fact
    stay untouched. A repeated start creates nothing new.
    """
    from sqlalchemy import select

    from backend.src.modules.arrivals.models import IncomingDocument
    from backend.src.modules.integrations.vetis.reference_names import backfill_reference_names

    factory = get_session_factory()
    async with factory() as session:
        rows = (await session.execute(select(IncomingDocument))).scalars()
        counters = await backfill_reference_names(
            session, [(row.contour, row.source_snapshot) for row in rows]
        )
        await session.commit()
        return counters


async def _job_poll_due(ctx: dict[str, Any]) -> None:  # pragma: no cover - arq entry
    """Poll due outbox rows (Redis-free fallback keeps the durable semantics)."""
    factory = get_session_factory()
    async with factory() as session:
        operation_id = await claim_due_operation(session, owner=f"worker-{ctx.get('job_id', 'poll')}")
        await session.commit()
        if operation_id is not None:
            await run_claimed(session, operation_id, owner=f"worker-{ctx.get('job_id', 'poll')}")


class WorkerSettings:  # pragma: no cover - composition, exercised by compose
    """arq worker settings (same backend image, Redis transport; ADR-013).

    Started from compose as::

        python -m arq --redis-url $REDIS_URL \\
            backend.src.modules.integrations.vetis.worker.WorkerSettings

    The scheduler tick runs every minute; the 15-minute interval lives in
    ``sync.SCHEDULE_INTERVAL`` so the cadence is proven, not assumed.
    """

    functions = [_job_run_vetis_sync, _job_vetis_scheduler, _job_poll_due]
    cron_jobs = [
        cron(_job_vetis_scheduler, second=0, run_at_startup=True),
        cron(_job_poll_due, second={0, 10, 20, 30, 40, 50}, run_at_startup=True),
    ]
    redis_settings = RedisSettings.from_dsn(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    on_startup = _startup
    poll_interval = 60
    max_jobs = 4
    job_timeout = 900
