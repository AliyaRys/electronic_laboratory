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
from backend.src.modules.catalog_pricing.schemas import PricingSnapshot, ResearchValue, parse_decimal
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.examinations.commands import (
    _price_conflict,
    _reconciliation_for,
    _resolve_specialist,
    fair_source,
    pricing_request_for,
)
from backend.src.modules.examinations.models import Examination, ExaminationSample
from backend.src.modules.examinations.queries import build_view, get_examination, get_view
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite, OutcomeWrite
from backend.src.modules.examinations.validation import validate_researches
from backend.src.modules.identity.models import CommandStatus, TechnicalEvent
from backend.src.modules.samples.models import SampleCollection
from backend.src.modules.samples.schemas import EditSample, NewSample
from backend.src.modules.samples.service import apply_sample

__all__ = ["update_examination", "complete_waiting"]


def _conflict(detail: str) -> ProblemError:
    return ProblemError(status=409, code="STATE_CONFLICT", title="State conflict", detail=detail)


def _validation(detail: str) -> ProblemError:
    return ProblemError(status=422, code="VALIDATION_ERROR", title="Validation error", detail=detail)


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
        vse_fair=payload.vse_fair,
    )
    previous_pricing = row.pricing_snapshot
    pricing = await evaluate_and_price(work, pricing_request, PricingSnapshot.model_validate(previous_pricing))
    # DR35 §13.5: the same completion gate as the first save: a COMPLETED save
    # must confirm the previewed total (validation error when missing, managed
    # conflict on mismatch).
    if payload.mode == "COMPLETED":
        if payload.expected_total is None:
            raise _validation("Подтвердите предварительный расчёт стоимости")
        if parse_decimal(payload.expected_total) != parse_decimal(pricing.total):
            raise _price_conflict(payload.expected_total, pricing.total)
    # DR35 §12.3: an edit may reassign the specialist within the scoped list;
    # created_by stays the immutable audit actor. A missing specialist keeps
    # the card's current specialist (never the operator of the save).
    if payload.specialist_id is None:
        specialist_id, specialist_name = row.specialist_id, row.specialist_name
    else:
        specialist_id, specialist_name = await _resolve_specialist(db, party, payload.specialist_id, ctx.actor_id)

    # 9. The sample selection is applied through the same internal contract;
    #    the card keeps exactly one current link (the schema is one link per
    #    card), while every earlier collection fact stays in the ledger.
    #    DR35 §11.3: an ordinary edit is NEVER a new physical selection — when
    #    the card already links a collection, a NEW-shaped body is applied as a
    #    correction of that same fact (revision-guarded), and REUSE stays the
    #    re-link of a not-disposed fact.
    link = (
        await db.execute(select(ExaminationSample).where(ExaminationSample.examination_id == row.id).with_for_update())
    ).scalar_one_or_none()
    selection: object = payload.sample
    if link is not None and isinstance(payload.sample, NewSample):
        current = (
            await db.execute(select(SampleCollection).where(SampleCollection.id == link.collection_id))
        ).scalar_one()
        selection = EditSample(
            mode="EDIT",
            collection_id=link.collection_id,
            expected_revision=current.rev or 1,
            collected_on=payload.sample.collected_on,
            mass_kg=str(payload.sample.mass_kg),
        )
    collection = await apply_sample(db, ctx.actor_id, row.party_id, row.id, selection)
    if link is None:
        db.add(ExaminationSample(examination_id=row.id, collection_id=collection.id))
    else:
        link.collection_id = collection.id

    # 10. One atomic write of the medical facts; author and first completion
    #     are immutable, so they are never assigned here.
    row.number = payload.number
    row.stamp = payload.stamp
    row.sent_to_lab = payload.sent_to_lab
    # DR52 §3.2: the card's own VSE-only waiver is editable same-day and never
    # touches the reconciliation fair flag.
    previous_vse_fair = bool(row.vse_fair)
    row.vse_fair = payload.vse_fair
    row.specialist_id = specialist_id
    row.specialist_name = specialist_name
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
    if previous_vse_fair != payload.vse_fair:
        # DR52 §3.2: the change of the card's waiver is audited with the old
        # and the new value and the source of the effective free rule.
        db.add(
            TechnicalEvent(
                actor_id=ctx.actor_id,
                object_uuid=row.id,
                action="examination:vse_fair",
                result=(
                    f"vse_fair={str(previous_vse_fair).lower()}->{str(payload.vse_fair).lower()}:"
                    f"{fair_source(await _reconciliation_for(db, row.party_id), payload.vse_fair)}"
                ),
                trace_id=uuid.uuid4().hex,
                revision=row.rev,
            )
        )
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
