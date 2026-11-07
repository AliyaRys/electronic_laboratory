"""Atomic first save of a WAITING or COMPLETED examination (E01)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import Clock
from backend.src.core.commands import IdempotencyRecorder, UnitOfWork, canonical_request_hash
from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.confirmation import downstream_route, ensure_confirmed
from backend.src.modules.arrivals.models import Party, Reconciliation
from backend.src.modules.catalog_pricing.schemas import PricingRequest, ResearchValue
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.examinations.models import Examination, ExaminationSample
from backend.src.modules.examinations.queries import build_view, get_view
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite
from backend.src.modules.examinations.validation import validate_researches
from backend.src.modules.identity.models import CommandStatus, TechnicalEvent
from backend.src.modules.samples.service import apply_sample

__all__ = ["save_examination", "pricing_request_for"]


def _conflict(detail: str) -> ProblemError:
    return ProblemError(status=409, code="STATE_CONFLICT", title="State conflict", detail=detail)


def _classification_id(party: Party, key: str) -> uuid.UUID:
    item = party.classification_snapshot.get(key)
    value = item.get("id") if isinstance(item, dict) else None
    if value is None:
        raise ProblemError(
            status=422,
            code="CONFIGURATION_MISSING",
            title="Configuration missing",
            detail="Снимок классификации партии неполон для расчёта ВСЭ.",
        )
    return uuid.UUID(str(value))


async def pricing_request_for(
    uow: AsyncSession | UnitOfWork, party: Party, results: list[ResearchValue]
) -> PricingRequest:
    """Assemble the VSE pricing request from the confirmed party's facts."""
    db = uow.session if isinstance(uow, UnitOfWork) else uow
    confirmation = await ensure_confirmed(db, party.id)
    reconciliation = (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one_or_none()
    return PricingRequest(
        party_id=party.id,
        laboratory_id=party.laboratory_id,
        context="VSE",
        results=results,
        fair=bool(reconciliation.fair) if reconciliation is not None else False,
        product_species_id=_classification_id(party, "product"),
        product_state_id=_classification_id(party, "subProduct"),
        accepted_quantity=str(confirmation.accepted_quantity),
        accepted_unit_id=confirmation.accepted_unit_id,
    )


async def save_examination(
    ctx: CommandContext,
    party_id: uuid.UUID,
    payload: ExaminationWrite,
    *,
    uow: AsyncSession,
    clock: Clock | None = None,
    after_sample: Callable[[], None] | None = None,
) -> ExaminationView:
    """Save every medical/sample/pricing fact in the caller's transaction."""
    work = UnitOfWork(uow)
    party = (await uow.execute(select(Party).where(Party.id == party_id).with_for_update())).scalar_one_or_none()
    if party is None:
        raise ProblemError(status=404, code="NOT_FOUND", title="Not Found", detail="Партия не найдена.")

    recorder = IdempotencyRecorder()
    request_hash = canonical_request_hash(payload.model_dump(mode="json", by_alias=True), None)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="examination.create",
        context_id=party_id,
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        return await get_view(uow, record.result_id)

    existing = (await uow.execute(select(Examination).where(Examination.party_id == party_id))).scalar_one_or_none()
    if existing is not None:
        raise _conflict("Для партии уже существует ВСЭ; откройте существующую карточку.")

    await ensure_confirmed(uow, party_id)
    if await downstream_route(uow, party_id) != "EXAMINATION":
        raise _conflict("Подтверждённый маршрут партии не предусматривает создание местной ВСЭ.")
    await validate_researches(uow, party, payload)

    duplicate_number = await uow.scalar(
        select(Examination.id).where(
            Examination.laboratory_id == party.laboratory_id,
            Examination.number == payload.number,
        )
    )
    if duplicate_number is not None:
        raise _conflict("Номер ВСЭ уже используется в этой лаборатории.")

    pricing_request = await pricing_request_for(
        uow,
        party,
        [
            ResearchValue(indicator_id=result.indicator_id, performed=True, value=result.value)
            for result in payload.researches
        ],
    )
    pricing = await evaluate_and_price(work, pricing_request, None)

    now = (clock or Clock()).now()
    examination_id = uuid.uuid4()
    collection = await apply_sample(uow, ctx.actor_id, party_id, examination_id, payload.sample)
    if after_sample is not None:
        after_sample()

    row = Examination(
        id=examination_id,
        party_id=party.id,
        laboratory_id=party.laboratory_id,
        number=payload.number,
        stamp=payload.stamp,
        status=payload.mode,
        sent_to_lab=payload.sent_to_lab,
        research_snapshot=[
            cast(dict[str, object], result.model_dump(mode="json", by_alias=True)) for result in payload.researches
        ],
        findings_snapshot={
            "invasive": [item.model_dump(mode="json", by_alias=True) for item in payload.invasive_findings],
            "noncontagious": [item.model_dump(mode="json", by_alias=True) for item in payload.noncontagious_findings],
        },
        pricing_snapshot=pricing.model_dump(mode="json"),
        outcome=payload.outcome,
        direction=payload.direction,
        reason=payload.reason.strip() if payload.reason is not None else None,
        created_by=ctx.actor_id,
        created_at=now,
        first_completed_at=now if payload.mode == "COMPLETED" else None,
        rev=1,
    )
    uow.add(row)
    uow.add(ExaminationSample(examination_id=row.id, collection_id=collection.id))
    uow.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=row.id,
            action="examination:create",
            result=payload.mode,
            trace_id=uuid.uuid4().hex,
            revision=1,
        )
    )
    try:
        await uow.flush()
    except IntegrityError as exc:
        raise _conflict("ВСЭ с этой партией или номером уже создана конкурентной операцией.") from exc
    await recorder.complete(work, record, row.id)
    return await build_view(uow, row)
