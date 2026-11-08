"""E02: day-bounded edits and the explicit late completion of a saved ВСЭ.

Semantics (FT-VSE-08/09, O-03, API-05):

- In the creation day (Europe/Moscow) the card may be edited in full; the
  status never changes through the ordinary edit — a WAITING card is not
  completed by sending the full outcome, and a COMPLETED card never returns
  to WAITING.
- After the creation day only the explicit ``complete_waiting`` action may
  write the outcome block (FIT/UNFIT, direction, reason) of a WAITING card;
  the sample, researches, cost, stamp and ``sent_to_lab`` are never touched.
- ``created_by`` and ``first_completed_at`` are immutable facts: the first
  completion is set exactly once, and no edit moves it.
- SPEC-04: the row lock is taken first, then the server time is read — never
  a transaction-start ``now`` — then the revision and the day rules.
"""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import Clock, moscow_date
from backend.src.core.commands import (
    CommandContext,
    IdempotencyRecorder,
    UnitOfWork,
    canonical_request_hash,
    ensure_revision,
)
from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.arrivals.confirmation import downstream_route
from backend.src.modules.arrivals.models import Party
from backend.src.modules.catalog_pricing.schemas import PricingSnapshot, ResearchValue
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.examinations.commands import pricing_request_for
from backend.src.modules.examinations.models import Examination, ExaminationSample
from backend.src.modules.examinations.queries import build_view, get_examination, get_view
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite, OutcomeWrite
from backend.src.modules.examinations.validation import validate_researches
from backend.src.modules.identity.models import CommandStatus, TechnicalEvent
from backend.src.modules.samples.service import apply_sample

__all__ = ["update_examination", "complete_waiting"]


def _conflict(detail: str) -> ProblemError:
    return ProblemError(status=409, code="STATE_CONFLICT", title="State conflict", detail=detail)


def _day_closed() -> ProblemError:
    return ProblemError(
        status=409,
        code="DAY_CLOSED",
        title="Day closed",
        detail=(
            "Карточку можно полностью исправить только в день создания; "
            "позднее доступно только завершение ожидания итогом."
        ),
    )


def _session(uow: AsyncSession | UnitOfWork) -> AsyncSession:
    return uow.session if isinstance(uow, UnitOfWork) else uow


async def _lock_party(db: AsyncSession, party_id: uuid.UUID) -> Party:
    party = (await db.execute(select(Party).where(Party.id == party_id).with_for_update())).scalar_one_or_none()
    if party is None:
        raise not_found("Партия не найдена.")
    return party


async def update_examination(
    ctx: CommandContext,
    examination_id: uuid.UUID,
    payload: ExaminationWrite,
    *,
    uow: AsyncSession | UnitOfWork,
    clock: Clock | None = None,
) -> ExaminationView:
    """Apply one full edit of a saved card in its creation day."""
    db = _session(uow)
    work = uow if isinstance(uow, UnitOfWork) else UnitOfWork(db)

    # 1. The card row is the serialization point of the lifecycle.
    row = await get_examination(db, examination_id, lock=True, deleted_conflict=True)

    # 2. SPEC-04: the server time is read after the lock wait, never at the
    #    transaction start — a save blocked over midnight belongs to the new day.
    now = (clock or Clock()).now()

    # 3. Idempotency claim before the guards: a committed replay answers the
    #    saved card without re-running any check.
    recorder = IdempotencyRecorder()
    request_hash = canonical_request_hash(payload.model_dump(mode="json", by_alias=True), ctx.expected_revision)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="examination.update",
        context_id=row.id,
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        return await get_view(db, record.result_id)

    # 4. If-Match of the card revision; a stale dialog loses without merging.
    ensure_revision(ctx.expected_revision, int(row.rev))

    # 5. The day boundary: full edits live only in the creation day.
    if moscow_date(now) != moscow_date(row.created_at):
        raise _day_closed()

    # 6. The status is preserved by an ordinary edit.
    if row.status == "COMPLETED" and payload.mode == "WAITING":
        raise _conflict("Завершённая ВСЭ не переводится обратно в ожидание.")
    if row.status == "WAITING" and payload.mode == "COMPLETED":
        raise _conflict("Обычная правка не завершает ожидание; используйте явное действие завершения.")

    # 7. The party facts are re-checked under lock: the receipt confirmation
    #    and the medical rules stay authoritative at edit time.
    party = await _lock_party(db, row.party_id)
    if await downstream_route(db, row.party_id) != "EXAMINATION":
        raise _conflict("Подтверждённый маршрут партии не предусматривает местную ВСЭ.")
    await validate_researches(db, party, payload)

    duplicate_number = await db.scalar(
        select(Examination.id).where(
            Examination.laboratory_id == row.laboratory_id,
            Examination.number == payload.number,
            Examination.id != row.id,
        )
    )
    if duplicate_number is not None:
        raise _conflict("Номер ВСЭ уже используется в этой лаборатории.")

    # 8. Existing indicators keep their pinned price/norm snapshot; only a
    #    newly added indicator is priced by the current catalog.
    pricing_request = await pricing_request_for(
        db,
        party,
        [
            ResearchValue(indicator_id=result.indicator_id, performed=True, value=result.value)
            for result in payload.researches
        ],
    )
    previous_pricing = row.pricing_snapshot
    pricing = await evaluate_and_price(work, pricing_request, PricingSnapshot.model_validate(previous_pricing))

    # 9. The sample selection is applied through the same internal contract;
    #    the card keeps exactly one current link (the schema is one link per
    #    card), while every earlier collection fact stays in the ledger.
    collection = await apply_sample(db, ctx.actor_id, row.party_id, row.id, payload.sample)
    link = (
        await db.execute(select(ExaminationSample).where(ExaminationSample.examination_id == row.id).with_for_update())
    ).scalar_one_or_none()
    if link is None:
        db.add(ExaminationSample(examination_id=row.id, collection_id=collection.id))
    else:
        link.collection_id = collection.id

    # 10. One atomic write of the medical facts; author and first completion
    #     are immutable, so they are never assigned here.
    row.number = payload.number
    row.stamp = payload.stamp
    row.sent_to_lab = payload.sent_to_lab
    row.research_snapshot = [
        cast(dict[str, object], result.model_dump(mode="json", by_alias=True)) for result in payload.researches
    ]
    row.findings_snapshot = {
        "invasive": [item.model_dump(mode="json", by_alias=True) for item in payload.invasive_findings],
        "noncontagious": [item.model_dump(mode="json", by_alias=True) for item in payload.noncontagious_findings],
    }
    row.pricing_snapshot = pricing.model_dump(mode="json")
    if payload.mode == "COMPLETED":
        row.outcome = payload.outcome
        row.direction = payload.direction
        row.reason = payload.reason.strip() if payload.reason is not None else None
    row.rev = int(row.rev) + 1
    db.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=row.id,
            action="examination:update",
            result=row.status,
            trace_id=uuid.uuid4().hex,
            revision=row.rev,
        )
    )
    await db.flush()
    await recorder.complete(work, record, row.id)
    return await build_view(db, row)


async def complete_waiting(
    ctx: CommandContext,
    examination_id: uuid.UUID,
    outcome: OutcomeWrite,
    *,
    uow: AsyncSession | UnitOfWork,
    clock: Clock | None = None,
) -> ExaminationView:
    """Confirm the special-laboratory answer explicitly and complete a WAITING card."""
    db = _session(uow)
    work = uow if isinstance(uow, UnitOfWork) else UnitOfWork(db)

    row = await get_examination(db, examination_id, lock=True, deleted_conflict=True)
    now = (clock or Clock()).now()  # after the lock wait (SPEC-04)

    recorder = IdempotencyRecorder()
    request_hash = canonical_request_hash(outcome.model_dump(mode="json", by_alias=True), ctx.expected_revision)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="examination.complete-waiting",
        context_id=row.id,
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        return await get_view(db, record.result_id)

    ensure_revision(ctx.expected_revision, int(row.rev))
    if row.status != "WAITING":
        raise _conflict("Завершить ожидание можно только у карточки в состоянии ожидания ответа.")

    # Only the outcome block is written; sample/researches/cost/stamp and the
    # sent_to_lab flag are never overwritten by the late completion.
    row.status = "COMPLETED"
    row.outcome = outcome.outcome
    row.direction = outcome.direction
    row.reason = outcome.reason.strip() if outcome.reason is not None else None
    if row.first_completed_at is None:
        row.first_completed_at = now
    row.rev = int(row.rev) + 1
    db.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=row.id,
            action="examination:complete-waiting",
            result="COMPLETED",
            trace_id=uuid.uuid4().hex,
            revision=row.rev,
        )
    )
    await db.flush()
    await recorder.complete(work, record, row.id)
    return await build_view(db, row)
