"""API-07 documents routes: the live conclusion preview of one party.

The view-model is derived per request (no snapshot, no cache) and the access
check runs inside the service against the live tables, so a revoked scope, a
correction or the deletion of the basis is honoured on the very next call.
"""

from __future__ import annotations

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Response
from fastapi.responses import Response as FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import async_session
from backend.src.modules.documents import pdf, resources, service
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


@router.get("/{party_id}/conclusion.pdf")
async def download_conclusion(
    party_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> FileResponse:
    """The controlled PDF of the same live conclusion view-model (API-07).

    The view-model is rebuilt (and re-authorized) on every call exactly as for
    the preview — print never bypasses the fresh access check. Rendered bytes
    are never cached (``no-store``) and no «выдано/подписано» record is
    written by a read. An unusable template/engine is an honest 503 Problem
    without a file.
    """
    identity, _actor = principal
    view = await service.build_conclusion(identity.actor_id, party_id, uow=db, authorizer=authorizer)
    form = resources.load_manifest(view.form_id)
    data = pdf.render_pdf(view, form)
    response.headers["Cache-Control"] = "no-store"
    filename = pdf.pdf_filename(view)
    return FileResponse(
        content=data,
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )
