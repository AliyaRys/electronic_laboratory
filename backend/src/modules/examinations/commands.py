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


def _validation(detail: str) -> ProblemError:
    return ProblemError(status=422, code="VALIDATION_ERROR", title="Validation error", detail=detail)


async def _resolve_specialist(
    uow: AsyncSession, party: Party, specialist_id: uuid.UUID | None, actor_id: uuid.UUID
) -> tuple[uuid.UUID, str]:
    """DR35 §12.3: the chosen specialist, validated against the scoped list.

    A new card requires an explicit specialist: the audit actor (operator of
    the save) is never silently substituted for the displayed specialist.
    """
    if specialist_id is None:
        raise _validation("Выберите специалиста Госветслужбы")
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
    uow: AsyncSession | UnitOfWork,
    party: Party,
    results: list[ResearchValue],
    vse_fair: bool = False,
) -> PricingRequest:
    """Assemble the VSE pricing request from the confirmed party's facts.

    DR52 §3.1: the effective VSE free rule is
    ``reconciliation.fair OR examination.vse_fair`` — the card's own waiver
    never changes the reconciliation price, only the VSE calculation.
    """
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
        # DR52 §3.1: the effective VSE free rule —
        # ``reconciliation.fair OR examination.vse_fair``.
        fair=_effective_fair(reconciliation, vse_fair),
        # DR52 §3.1: the frozen snapshot line prices never re-price by the
        # card's own flag — ``previous`` lines keep their amounts; the NEW
        # lines are zeroed by ``request.fair``.
        product_species_id=_classification_id(party, "product"),
        product_state_id=_classification_id(party, "subProduct"),
        accepted_quantity=str(confirmation.accepted_quantity),
        accepted_unit_id=confirmation.accepted_unit_id,
    )


def _effective_fair(reconciliation: Reconciliation | None, vse_fair: bool) -> bool:
    """DR52 §3.1: ``reconciliation.fair OR examination.vse_fair``."""
    if reconciliation is not None and reconciliation.fair:
        return True
    return vse_fair


def fair_source(reconciliation: Reconciliation | None, vse_fair: bool) -> str:
    """The typed source of the effective free rule (DR52 §3.3)."""
    if reconciliation is not None and reconciliation.fair:
        return "RECONCILIATION"
    if vse_fair:
        return "EXAMINATION"
    return "NONE"


async def reconciliation_for(db: AsyncSession, party_id: uuid.UUID) -> Reconciliation | None:
    """The reconciliation row of one party (public helper — DR52 review fix)."""
    return (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party_id))
    ).scalar_one_or_none()


# Backwards-compatible alias for existing importers (DR52 review fix: the
# canonical name is the public ``reconciliation_for``).
_reconciliation_for = reconciliation_for


async def preview_pricing(
    db: AsyncSession, party: Party, results: list[ResearchValue], vse_fair: bool = False
) -> object:
    """DR35 §13.3: the preview computation of the SAME domain function.

    Pure read/compute on the caller's session: no row is written, no commit,
    no idempotency record, no event — the caller may safely roll back.
    """
    request = await pricing_request_for(db, party, results, vse_fair=vse_fair)
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
        vse_fair=payload.vse_fair,
    )
    pricing = await evaluate_and_price(work, pricing_request, None)
    # DR35 §13.5: a COMPLETED save must confirm the previewed total. A missing
    # confirmation is a validation error; a mismatch is a managed conflict.
    if payload.mode == "COMPLETED":
        if payload.expected_total is None:
            raise _validation("Подтвердите предварительный расчёт стоимости")
        if parse_decimal(payload.expected_total) != parse_decimal(pricing.total):
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
        vse_fair=payload.vse_fair,
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
        special_lab_result=payload.special_lab_result,
        created_by=ctx.actor_id,
        specialist_id=specialist_id,
        specialist_name=specialist_name,
        created_at=now,
        first_completed_at=now if payload.mode == "COMPLETED" else None,
        rev=1,
    )
    uow.add(row)
    uow.add(ExaminationSample(examination_id=row.id, collection_id=collection.id))
    # DR52 §3.2 (review fix): the fair audit names the OLD/NEW card flag and
    # the typed source of the effective free rule — never a bare unnamed
    # ``fair=true``. A create WITHOUT the card waiver stays silent: the row
    # simply inherits the documented column default (``false``); a meaningless
    # ``false->false:NONE`` init event would only pollute the audit trail.
    # The waiver itself, when set at create, is audited exactly once.
    if payload.vse_fair:
        uow.add(
            TechnicalEvent(
                actor_id=ctx.actor_id,
                object_uuid=row.id,
                action="examination:vse_fair",
                result=(
                    f"vse_fair=false->{str(payload.vse_fair).lower()}:"
                    f"{fair_source(await reconciliation_for(uow, party.id), payload.vse_fair)}"
                ),
                trace_id=uuid.uuid4().hex,
                revision=1,
            )
        )
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
