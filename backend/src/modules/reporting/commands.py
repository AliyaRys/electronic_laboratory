"""Persist and delete immutable, already-verified report snapshots."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import utcnow
from backend.src.core.commands import IdempotencyRecorder, UnitOfWork, canonical_request_hash, ensure_revision
from backend.src.core.contracts import CommandContext
from backend.src.core.keyring import PreviewKeyring
from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.identity.models import CommandStatus, TechnicalEvent
from backend.src.modules.reporting.models import ReportSnapshot
from backend.src.modules.reporting.schemas import (
    ReportSnapshotView,
    ReportSummary,
    ReportSummaryPage,
    SignedPreview,
)
from backend.src.modules.reporting.snapshots import adapt_payload, verify_preview


def snapshot_view(row: ReportSnapshot) -> ReportSnapshotView:
    """The read view of one stored row; the payload is adapted to the full
    printed form read-only (DR51 §4): legacy compact snapshots open in the
    47-row catalogue without any live recalculation."""
    view = ReportSnapshotView.model_validate(row)
    return view.model_copy(update={"payload": adapt_payload(view.payload)})


def _period_context(report_type: str, laboratory_id: uuid.UUID, date_from: date, date_to: date) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"report:{report_type}:{laboratory_id}:{date_from}:{date_to}")


def _period_exists() -> ProblemError:
    return ProblemError(
        status=409,
        code="REPORT_PERIOD_EXISTS",
        title="Report period exists",
        detail="Отчёт этого типа за выбранный период уже сохранён.",
    )


async def load_report(db: AsyncSession, report_id: uuid.UUID) -> ReportSnapshotView:
    row = (await db.execute(select(ReportSnapshot).where(ReportSnapshot.id == report_id))).scalar_one_or_none()
    if row is None:
        raise not_found("Сохранённый отчёт не найден.")
    return snapshot_view(row)


async def save_report(
    ctx: CommandContext,
    preview: SignedPreview,
    *,
    session_id: str,
    db: AsyncSession,
    keyring: PreviewKeyring | None = None,
    now: datetime | None = None,
) -> ReportSnapshotView:
    """Save exactly the verified payload; never query or recalculate its sources."""
    instant = now or utcnow()
    payload = verify_preview(preview, ctx.actor_id, session_id, keyring=keyring, now=instant)
    try:
        report_type = str(payload["report_type"])
        laboratory_id = uuid.UUID(str(payload["laboratory_id"]))
        date_from = date.fromisoformat(str(payload["date_from"]))
        date_to = date.fromisoformat(str(payload["date_to"]))
        source_count = int(str(payload["source_count"]))
        generated_at = datetime.fromisoformat(str(payload["generated_at"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise ProblemError(
            status=422,
            code="REPORT_PREVIEW_INVALID",
            title="Report preview invalid",
            detail="Подписанный preview не содержит обязательных полей.",
        ) from exc

    context_id = _period_context(report_type, laboratory_id, date_from, date_to)
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": str(context_id)})
    work = UnitOfWork(db)
    recorder = IdempotencyRecorder()
    request_hash = canonical_request_hash({"preview": preview.model_dump(mode="json")}, None)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="report:5vet-save",
        context_id=context_id,
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS:
        if record.result_id is None:
            raise _period_exists()
        return await load_report(db, record.result_id)

    existing = (
        await db.execute(
            select(ReportSnapshot.id).where(
                ReportSnapshot.report_type == report_type,
                ReportSnapshot.laboratory_id == laboratory_id,
                ReportSnapshot.date_from == date_from,
                ReportSnapshot.date_to == date_to,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise _period_exists()

    row = ReportSnapshot(
        report_type=report_type,
        laboratory_id=laboratory_id,
        date_from=date_from,
        date_to=date_to,
        payload=payload,
        source_count=source_count,
        preview_generated_at=generated_at,
        saved_at=instant,
        saved_by=ctx.actor_id,
        key_id=preview.key_id,
        signature=preview.signature,
    )
    db.add(row)
    await db.flush()
    db.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=row.id,
            action="report:5vet-save",
            result=f"{date_from}..{date_to}",
            trace_id=uuid.uuid4().hex,
            revision=1,
        )
    )
    await db.flush()
    await recorder.complete(work, record, row.id)
    return snapshot_view(row)


async def list_reports(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    *,
    page: int,
    page_size: int = 20,
) -> ReportSummaryPage:
    """The saved-report list of one laboratory (API-08 ``GET /reports``).

    Newest saved period first (DR48 §3.5: ``date_to DESC, date_from DESC,
    saved_at DESC`` for determinism); the payload never leaves the database
    here — the list carries only period/source/revision metadata.
    """
    base = select(ReportSnapshot).where(ReportSnapshot.laboratory_id == laboratory_id)
    total = await db.scalar(
        select(func.count()).select_from(ReportSnapshot).where(ReportSnapshot.laboratory_id == laboratory_id)
    )
    offset = (page - 1) * page_size
    rows = (
        (
            await db.execute(
                base.order_by(
                    ReportSnapshot.date_to.desc(),
                    ReportSnapshot.date_from.desc(),
                    ReportSnapshot.saved_at.desc(),
                )
                .offset(offset)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return ReportSummaryPage(
        items=[ReportSummary.model_validate(row) for row in rows],
        total=int(total or 0),
        page=page,
        page_size=page_size,
    )


async def delete_report(ctx: CommandContext, report_id: uuid.UUID, *, db: AsyncSession) -> None:
    recorder = IdempotencyRecorder()
    work = UnitOfWork(db)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="report:5vet-delete",
        context_id=report_id,
        key=ctx.idempotency_key,
        request_hash=canonical_request_hash(None, ctx.expected_revision),
    )
    if record.status == CommandStatus.SUCCESS:
        return
    row = (
        await db.execute(select(ReportSnapshot).where(ReportSnapshot.id == report_id).with_for_update())
    ).scalar_one_or_none()
    if row is None:
        raise not_found("Сохранённый отчёт не найден.")
    ensure_revision(ctx.expected_revision, int(row.rev))
    db.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=report_id,
            action="report:5vet-delete",
            result="deleted",
            trace_id=uuid.uuid4().hex,
            revision=1,
        )
    )
    await db.delete(row)
    await db.flush()
    await recorder.complete(work, record, report_id)
