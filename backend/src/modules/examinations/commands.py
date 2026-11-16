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
from backend.src.core.problems import ProblemError, ProblemItem
from backend.src.modules.arrivals.confirmation import downstream_route, ensure_confirmed
from backend.src.modules.arrivals.models import Party, Reconciliation
from backend.src.modules.catalog_pricing.schemas import PricingRequest, ResearchValue, parse_decimal
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.examinations.models import Examination, ExaminationSample
from backend.src.modules.examinations.queries import build_view, get_view
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite
from backend.src.modules.examinations.specialists import is_eligible_specialist, specialist_not_allowed
from backend.src.modules.examinations.validation import validate_researches
from backend.src.modules.identity.models import CommandStatus, TechnicalEvent, User
from backend.src.modules.samples.schemas import ReuseSample
from backend.src.modules.samples.service import apply_sample

__all__ = ["save_examination", "preview_pricing", "pricing_request_for"]


def _conflict(detail: str) -> ProblemError:
    return ProblemError(status=409, code="STATE_CONFLICT", title="State conflict", detail=detail)


def _reuse_rejected() -> ProblemError:
    """DR35 §11.2: a new card performs a NEW physical selection — REUSE is
    refused honestly, including a forged API request."""
    return ProblemError(
        status=422,
        code="VALIDATION_ERROR",
        title="Validation error",
        detail="Создание ВСЭ выполняет только новый отбор пробы; повторное использование недоступно.",
    )


def _price_conflict(expected: str, actual: str) -> ProblemError:
    """DR35 §13.5: a price that changed between the confirmed preview and the
    final save is never saved silently — the user re-confirms the new amount."""
    return ProblemError(
        status=409,
        code="PRICE_CONFLICT",
        title="Price conflict",
        detail=(
            "Стоимость изменилась с момента предварительного расчёта; подтвердите новый расчёт перед завершением ВСЭ."
        ),
        errors=[ProblemItem(path="expectedTotal", field_id="VSE", message=actual)],
    )


async def _resolve_specialist(
    uow: AsyncSession, party: Party, specialist_id: uuid.UUID | None, actor_id: uuid.UUID
) -> tuple[uuid.UUID, str]:
    """DR35 §12.3: the chosen specialist, validated against the scoped list.

    ``None`` keeps the documented legacy fallback: the audit actor is both the
    operator and the displayed specialist (pre-DR35 behavior).
    """
    if specialist_id is None:
        user = (await uow.execute(select(User).where(User.id == actor_id))).scalar_one()
        return actor_id, user.full_name
    if not await is_eligible_specialist(uow, specialist_id, party.laboratory_id, _product_scope_id(party)):
        raise specialist_not_allowed()
    user = (await uow.execute(select(User).where(User.id == specialist_id))).scalar_one()
    return specialist_id, user.full_name


def _product_scope_id(party: Party) -> uuid.UUID | None:
    product = party.classification_snapshot.get("product")
    value = product.get("id") if isinstance(product, dict) else None
    return uuid.UUID(str(value)) if value is not None else None


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


def _ensure_meat_product_type(party: Party) -> None:
    """DR31 §8.5: the VSE evaluation applies to meat parties (productType 1).

    A classification snapshot that carries a DIFFERENT product type is refused
    honestly; an unset ``productType`` keeps the pre-DR31 behavior (the party
    was accepted by the meat VSD filter anyway).
    """
    product = party.classification_snapshot.get("product")
    product_type = product.get("productType") if isinstance(product, dict) else None
    if product_type is not None and int(product_type) != 1:
        raise ProblemError(
            status=422,
            code="CONFIGURATION_MISSING",
            title="Configuration missing",
            detail="Единый мясной справочник норм применяется только к категории «Мясо и мясопродукты».",
        )


async def pricing_request_for(
    uow: AsyncSession | UnitOfWork, party: Party, results: list[ResearchValue]
) -> PricingRequest:
    """Assemble the VSE pricing request from the confirmed party's facts."""
    db = uow.session if isinstance(uow, UnitOfWork) else uow
    confirmation = await ensure_confirmed(db, party.id)
    reconciliation = (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one_or_none()
    _ensure_meat_product_type(party)
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


async def preview_pricing(db: AsyncSession, party: Party, results: list[ResearchValue]) -> object:
    """DR35 §13.3: the preview computation of the SAME domain function.

    Pure read/compute on the caller's session: no row is written, no commit,
    no idempotency record, no event — the caller may safely roll back.
    """
    request = await pricing_request_for(db, party, results)
    return await evaluate_and_price(UnitOfWork(db), request, None)


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
    # DR35 §11.2: a new card performs a NEW physical selection only.
    if isinstance(payload.sample, ReuseSample):
        raise _reuse_rejected()
    # DR35 §12.3: the specialist is validated against the scoped list BEFORE
    # any write; audit actor and specialist stay distinct facts.
    specialist_id, specialist_name = await _resolve_specialist(uow, party, payload.specialist_id, ctx.actor_id)
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
    # DR35 §13.5: the final save re-derives the price in the SAME transaction;
    # a change against the confirmed preview is a managed conflict, never a
    # silent save of a different amount.
    if (
        payload.mode == "COMPLETED"
        and payload.expected_total is not None
        and parse_decimal(payload.expected_total) != parse_decimal(pricing.total)
    ):
        raise _price_conflict(payload.expected_total, pricing.total)

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
        specialist_id=specialist_id,
        specialist_name=specialist_name,
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
