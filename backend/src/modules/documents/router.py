"""API-07 documents routes: the live conclusion preview of one party.

The view-model is derived per request (no snapshot, no cache) and the access
check runs inside the service against the live tables, so a revoked scope, a
correction or the deletion of the basis is honoured on the very next call.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import async_session
from backend.src.modules.documents import service
from backend.src.modules.documents.schemas import ConclusionView
from backend.src.modules.identity.authz import Authorizer, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import require_session
from backend.src.modules.identity.session import SessionIdentity

__all__ = ["router"]

router = APIRouter(prefix="/arrivals", tags=["Documents"])


@router.get("/{party_id}/conclusion/preview", response_model=ConclusionView)
async def preview_conclusion(
    party_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ConclusionView:
    """The current conclusion view-model of one party (API-07, conclusion:preview)."""
    identity, _actor = principal
    view = await service.build_conclusion(identity.actor_id, party_id, uow=db, authorizer=authorizer)
    response.headers["Cache-Control"] = "no-store"
    return view
