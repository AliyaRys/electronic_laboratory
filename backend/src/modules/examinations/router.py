"""API-05 routes for the atomic first examination save."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext, format_etag, resolve_if_match
from backend.src.core.database import async_session
from backend.src.core.problems import not_found
from backend.src.modules.arrivals.models import Party
from backend.src.modules.examinations import commands, lifecycle, queries
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite, OutcomeWrite
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import _idempotency_key, _require_csrf, require_session
from backend.src.modules.identity.session import SessionIdentity

router = APIRouter(prefix="/examinations", tags=["Examinations"])

__all__ = ["router"]


def _product_scope(party: Party) -> uuid.UUID | None:
    product = party.classification_snapshot.get("product")
    value = product.get("id") if isinstance(product, dict) else None
    return uuid.UUID(str(value)) if value is not None else None


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
    row = await queries.get_examination(db, examination_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:update",
        ScopeTarget(laboratory_id=row.laboratory_id),
        hide_foreign=True,
    )
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
    row = await queries.get_examination(db, examination_id)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "examination:complete-waiting",
        ScopeTarget(laboratory_id=row.laboratory_id),
        hide_foreign=True,
    )
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
