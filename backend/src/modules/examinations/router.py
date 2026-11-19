"""API-05 routes for the atomic first examination save."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext, format_etag, resolve_if_match
from backend.src.core.contracts import CommandStateView, Page
from backend.src.core.database import async_session
from backend.src.core.durability import DurabilityGuard, get_durability_guard
from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.arrivals.confirmation import downstream_route, ensure_confirmed
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.catalog_pricing.schemas import ResearchValue
from backend.src.modules.examinations import commands, deletion, form_model, lifecycle, queries
from backend.src.modules.examinations import journal as journal_model
from backend.src.modules.examinations.journal import ExaminationJournalItem
from backend.src.modules.examinations.models import Examination
from backend.src.modules.examinations.schemas import (
    ExaminationFormView,
    ExaminationView,
    ExaminationWrite,
    OutcomeWrite,
    PricingPreviewRequest,
    PricingPreviewResponse,
)
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import _idempotency_key, _require_csrf, require_session
from backend.src.modules.identity.session import SessionIdentity

router = APIRouter(prefix="/examinations", tags=["Examinations"])

__all__ = ["router"]


def _route_conflict(detail: str) -> ProblemError:
    return ProblemError(status=409, code="STATE_CONFLICT", title="State conflict", detail=detail)


def _product_scope(party: Party) -> uuid.UUID | None:
    product = party.classification_snapshot.get("product")
    value = product.get("id") if isinstance(product, dict) else None
    return uuid.UUID(str(value)) if value is not None else None


async def _party_or_404(db: AsyncSession, party_id: uuid.UUID) -> Party:
    party = (await db.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if party is None:
        raise not_found("Партия не найдена.")
    return party


@router.get("/parties/{party_id}/form", response_model=ExaminationFormView)
async def read_examination_form(
    party_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ExaminationFormView:
    """DR35 §4/§14: the frozen reconciliation-step snapshot — the single read
    source of the create page. No SOAP and no lookup job ever runs here."""
    identity, _actor = principal
    party = await _party_or_404(db, party_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:read",
        ScopeTarget(laboratory_id=party.laboratory_id, product_scope_id=_product_scope(party)),
        hide_foreign=True,
    )
    await ensure_confirmed(db, party.id)
    if await downstream_route(db, party.id) != "EXAMINATION":
        raise _route_conflict("Подтверждённый маршрут партии не предусматривает создание местной ВСЭ.")
    document = (
        await db.execute(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))
    ).scalar_one()
    payload = await form_model.build_form_view(db, party, document, revision=party.rev)
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = format_etag(party.rev)
    return ExaminationFormView.model_validate(payload)


@router.post("/parties/{party_id}/pricing-preview", response_model=PricingPreviewResponse)
async def pricing_preview(
    party_id: uuid.UUID,
    payload: PricingPreviewRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> PricingPreviewResponse:
    """DR35 §13.3: the live pricing preview. A pure read/compute: it creates
    NO examination, sample, event, command record or draft, calls the SAME
    ``evaluate_and_price`` domain function as the final save, accepts no money
    or quantity from the client and never touches VetIS."""
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    party = await _party_or_404(db, party_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:read",
        ScopeTarget(laboratory_id=party.laboratory_id, product_scope_id=_product_scope(party)),
        hide_foreign=True,
    )
    confirmation = await ensure_confirmed(db, party.id)
    if await downstream_route(db, party.id) != "EXAMINATION":
        raise _route_conflict("Подтверждённый маршрут партии не предусматривает создание местной ВСЭ.")
    snapshot = await commands.preview_pricing(
        db,
        party,
        [
            ResearchValue(indicator_id=result.indicator_id, performed=True, value=result.value)
            for result in payload.researches
        ],
        vse_fair=payload.vse_fair,
    )
    await db.commit()
    reconciliation = await commands.reconciliation_for(db, party.id)
    return PricingPreviewResponse(
        snapshot=snapshot,
        accepted_quantity=str(confirmation.accepted_quantity),
        accepted_unit_id=confirmation.accepted_unit_id,
        fair=snapshot.fair,
        # DR52 §3.3: the typed WHY of the free preview.
        fair_source=commands.fair_source(reconciliation, payload.vse_fair),
        revision=party.rev,
    )


async def _mutation_scope(db: AsyncSession, examination_id: uuid.UUID) -> tuple[uuid.UUID, bool]:
    """Resolve a live/tombstoned lab without exposing a foreign UUID."""
    row = (await db.execute(select(Examination).where(Examination.id == examination_id))).scalar_one_or_none()
    if row is not None:
        return row.laboratory_id, False
    tombstone = await queries.get_tombstone(db, examination_id)
    if tombstone is None:
        raise not_found("ВСЭ не найдена.")
    return tombstone.laboratory_id, True


@router.post("/parties/{party_id}", status_code=201, response_model=ExaminationView)
async def create_examination(
    party_id: uuid.UUID,
    payload: ExaminationWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ExaminationView:
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    party = (await db.execute(select(Party).where(Party.id == party_id))).scalar_one_or_none()
    if party is None:
        raise not_found("Партия не найдена.")
    action = "examination:create-wait" if payload.mode == "WAITING" else "examination:create-complete"
    await authorizer.authorize(
        db,
        identity.actor_id,
        action,
        ScopeTarget(laboratory_id=party.laboratory_id, product_scope_id=_product_scope(party)),
        hide_foreign=True,
    )
    view = await commands.save_examination(
        CommandContext(actor_id=identity.actor_id, idempotency_key=key), party_id, payload, uow=db
    )
    await db.commit()
    response.headers["Location"] = f"/api/v1/examinations/{view.id}"
    response.headers["ETag"] = format_etag(view.revision)
    return view


@router.put("/{examination_id}", response_model=ExaminationView)
async def update_examination(
    examination_id: uuid.UUID,
    payload: ExaminationWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ExaminationView:
    """One full edit of the card, allowed only in its creation day (API-05)."""
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    laboratory_id, deleted = await _mutation_scope(db, examination_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:update",
        ScopeTarget(laboratory_id=laboratory_id),
        hide_foreign=True,
    )
    if deleted:
        raise queries.examination_deleted()
    view = await lifecycle.update_examination(
        CommandContext(
            actor_id=identity.actor_id,
            idempotency_key=key,
            expected_revision=resolve_if_match(request.headers.get("if-match")),
        ),
        examination_id,
        payload,
        uow=db,
    )
    await db.commit()
    response.headers["ETag"] = format_etag(view.revision)
    return view


@router.post("/{examination_id}/complete-waiting", response_model=ExaminationView)
async def complete_waiting(
    examination_id: uuid.UUID,
    payload: OutcomeWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ExaminationView:
    """Explicit confirmation of the special-laboratory answer (API-05)."""
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    laboratory_id, deleted = await _mutation_scope(db, examination_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:complete-waiting",
        ScopeTarget(laboratory_id=laboratory_id),
        hide_foreign=True,
    )
    if deleted:
        raise queries.examination_deleted()
    view = await lifecycle.complete_waiting(
        CommandContext(
            actor_id=identity.actor_id,
            idempotency_key=key,
            expected_revision=resolve_if_match(request.headers.get("if-match")),
        ),
        examination_id,
        payload,
        uow=db,
    )
    await db.commit()
    response.headers["ETag"] = format_etag(view.revision)
    return view


@router.get("/authors", response_model=list[journal_model.JournalAuthor])
async def list_journal_authors(
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
) -> list[journal_model.JournalAuthor]:
    """The scoped author options of the journal filter (§2): ONE query over
    the laboratory's own journal cards — never the full user list."""
    identity, _actor = principal
    await authorizer.authorize(
        db, identity.actor_id, "examination:read", ScopeTarget(laboratory_id=laboratory_id), hide_foreign=True
    )
    return await journal_model.journal_authors(db, laboratory_id)


_JOURNAL_ALLOWED_PARAMS = frozenset(
    {"laboratory_id", "status", "q", "outcome", "specialist_id", "occurred_from", "occurred_to", "sort", "page"}
)


def _validate_journal_params(request: Request, status: str) -> None:
    """§2: an unknown or incompatible journal query is an honest 422, never a
    silently ignored filter (a lying `total` is a worse answer than an
    explicit problem)."""
    unknown = sorted(set(request.query_params.keys()) - _JOURNAL_ALLOWED_PARAMS)
    if unknown:
        raise ProblemError(
            status=422,
            code="VALIDATION_ERROR",
            title="Validation error",
            detail=f"Неизвестные параметры журнала: {', '.join(unknown)}.",
        )
    if status == "WAITING" and "outcome" in request.query_params:
        # ТЗ DR53 Task 4: the outcome filter is meaningful for COMPLETED cards
        # only; the creation-date window is now meaningful for BOTH tabs
        # («Дата создания ВСЭ»), so it no longer belongs to this guard.
        raise ProblemError(
            status=422,
            code="VALIDATION_ERROR",
            title="Validation error",
            detail="Итог ВСЭ доступен только для вкладки завершённых карточек.",
        )


@router.get("", response_model=Page[ExaminationJournalItem])
async def list_examination_journal(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    status: Annotated[
        Literal["WAITING", "COMPLETED"], Query(description="Статус карточки; по умолчанию COMPLETED.")
    ] = "COMPLETED",
    q: str | None = None,
    outcome: Annotated[Literal["FIT", "UNFIT"] | None, Query()] = None,
    specialist_id: uuid.UUID | None = None,
    occurred_from: datetime | None = None,
    occurred_to: Annotated[datetime | None, Query(description="Исключающая верхняя граница периода.")] = None,
    sort: Annotated[Literal["asc", "desc"], Query()] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[ExaminationJournalItem]:
    """The scoped journal read model (ТЗ DR45 §2): a plain URL answers the
    COMPLETED cards only; the status filter selects ``Examination.status``.
    """
    identity, _actor = principal
    _validate_journal_params(request, status)
    await authorizer.authorize(
        db, identity.actor_id, "examination:read", ScopeTarget(laboratory_id=laboratory_id), hide_foreign=True
    )
    items, total = await journal_model.journal_page(
        db,
        laboratory_id,
        status=status,
        q=q,
        outcome=outcome,
        specialist_id=specialist_id,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
        sort=sort,
        page=page,
    )
    response.headers["Cache-Control"] = "no-store"
    return Page[ExaminationJournalItem](
        items=items, total=total, page=page, page_size=journal_model.JOURNAL_PAGE_SIZE
    )


@router.get("/{examination_id}", response_model=ExaminationView)
async def read_examination(
    examination_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ExaminationView:
    identity, _actor = principal
    row = await queries.get_examination(db, examination_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:read",
        ScopeTarget(laboratory_id=row.laboratory_id),
        hide_foreign=True,
    )
    view = await queries.build_view(db, row)
    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = format_etag(view.revision)
    return view


@router.delete(
    "/{examination_id}",
    status_code=204,
    responses={202: {"model": CommandStateView, "description": "Remote WAL flush is not yet confirmed."}},
)
async def delete_examination(
    examination_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    guard: Annotated[DurabilityGuard, Depends(get_durability_guard)],
) -> Response:
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    laboratory_id, _deleted = await _mutation_scope(db, examination_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:delete",
        ScopeTarget(laboratory_id=laboratory_id),
        hide_foreign=True,
    )
    outcome = await deletion.delete_examination(
        CommandContext(
            actor_id=identity.actor_id,
            idempotency_key=key,
            expected_revision=resolve_if_match(request.headers.get("if-match")),
        ),
        examination_id,
        uow=db,
        guard=guard,
    )
    outcome = await deletion.finalize_delete(db, outcome, guard)
    if outcome.state == "SUCCESS":
        return Response(status_code=204)
    return JSONResponse(status_code=202, content=deletion.delete_outcome_view(outcome).model_dump(mode="json"))
