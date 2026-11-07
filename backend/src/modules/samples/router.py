"""Samples HTTP router (API-06): the atomic full-disposal command (S02) and
the accounting read endpoints (S03).

The disposal is create-once (O-07): there is deliberately no PUT/DELETE route
— ``sample:disposal-update/delete`` is denied for every role, and the missing
routes answer 405/404. Read access follows permissions.md ``sample:read``:
VET/HEAD of the own scope, ANALYST of the chosen laboratory, ADMIN forbidden.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext, resolve_if_match
from backend.src.core.contracts import Page
from backend.src.core.database import async_session
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import _idempotency_key, _require_csrf, require_session
from backend.src.modules.identity.session import SessionIdentity
from backend.src.modules.samples import commands, queries
from backend.src.modules.samples.schemas import (
    BalanceView,
    CollectionView,
    DisposalView,
    DisposalWrite,
)

__all__ = ["router"]

router = APIRouter(prefix="/samples", tags=["Samples"])


@router.get("/balances", response_model=list[BalanceView])
async def list_balances(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
) -> list[BalanceView]:
    """The live balances of one laboratory per species (API-06, sample:read)."""
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "sample:read", ScopeTarget(laboratory_id=laboratory_id))
    response.headers["Cache-Control"] = "no-store"
    return await queries.balance_list(db, laboratory_id)


@router.get("/collections", response_model=Page[CollectionView])
async def list_collections(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[CollectionView]:
    """A page of the available (not disposed) collection facts (sample:read)."""
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "sample:read", ScopeTarget(laboratory_id=laboratory_id))
    items, total = await queries.collection_page(db, laboratory_id, page)
    response.headers["Cache-Control"] = "no-store"
    return Page[CollectionView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@router.get("/disposals", response_model=Page[DisposalView])
async def list_disposals(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    date_from: date | None = None,
    date_to: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[DisposalView]:
    """A page of the immutable disposal history with the period filter; the
    filter never affects the balances read model (API-06)."""
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "sample:read", ScopeTarget(laboratory_id=laboratory_id))
    items, total = await queries.disposal_page(db, laboratory_id, page, date_from=date_from, date_to=date_to)
    response.headers["Cache-Control"] = "no-store"
    return Page[DisposalView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@router.post("/disposals", status_code=201, response_model=DisposalView)
async def create_disposal(
    payload: DisposalWrite,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> DisposalView:
    """Register the atomic full disposal of one laboratory/species balance.

    SPEC-04: the ``Idempotency-Key`` and the ``If-Match`` of the basket
    revision are both required; the stored mass is always the server-computed
    whole balance, never the value shown in the dialog. VET/HEAD of the own
    scope only (permissions.md: ANALYST/ADMIN refused).
    """
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    expected = resolve_if_match(request.headers.get("if-match"))
    await authorizer.authorize(
        db,
        identity.actor_id,
        "sample:dispose",
        ScopeTarget(laboratory_id=payload.laboratory_id),
    )
    ctx = CommandContext(actor_id=identity.actor_id, idempotency_key=key, expected_revision=expected)
    view = await commands.dispose_samples(ctx, payload, uow=db)
    await db.commit()
    return view
