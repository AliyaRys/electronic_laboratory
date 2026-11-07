"""Samples HTTP router (API-06): the atomic full-disposal command (S02).

The disposal is create-once (O-07): there is deliberately no PUT/DELETE route
— ``sample:disposal-update/delete`` is denied for every role, and the missing
routes answer 405/404. The read endpoints (balances/collections/disposals
pages) belong to S03.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext, resolve_if_match
from backend.src.core.database import async_session
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import _idempotency_key, _require_csrf, require_session
from backend.src.modules.identity.session import SessionIdentity
from backend.src.modules.samples import commands
from backend.src.modules.samples.schemas import DisposalView, DisposalWrite

__all__ = ["router"]

router = APIRouter(prefix="/samples", tags=["Samples"])


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
