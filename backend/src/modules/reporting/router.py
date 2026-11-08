"""API-08 report preview and immutable snapshot commands."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import Response as FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext, resolve_if_match
from backend.src.core.database import async_session
from backend.src.core.problems import ProblemError
from backend.src.modules.documents import pdf, resources, xlsx
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import _idempotency_key, _require_csrf, require_session
from backend.src.modules.identity.session import SessionIdentity
from backend.src.modules.reporting import commands, projection, queries, snapshots
from backend.src.modules.reporting.schemas import (
    OperationalView,
    ReportPreviewParams,
    ReportSnapshotView,
    ReportSummaryPage,
    SaveReportWrite,
    SignedPreview,
)

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/operational", response_model=OperationalView)
async def operational(
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    date_from: datetime,
    date_to: datetime,
) -> OperationalView:
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "report:operational", ScopeTarget(laboratory_id=laboratory_id))
    return await queries.operational_query(db, laboratory_id, date_from, date_to)


@router.post("/5vet/preview", response_model=SignedPreview)
async def preview(
    payload: ReportPreviewParams,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> SignedPreview:
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    await authorizer.authorize(
        db, identity.actor_id, "report:5vet-preview", ScopeTarget(laboratory_id=payload.laboratory_id)
    )
    return await snapshots.preview_report(db, identity.actor_id, identity.session_id, payload)


@router.post("/5vet", status_code=201, response_model=ReportSnapshotView)
async def save(
    payload: SaveReportWrite,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReportSnapshotView:
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    verified = snapshots.verify_preview(payload.preview, identity.actor_id, identity.session_id)
    try:
        laboratory_id = uuid.UUID(str(verified["laboratory_id"]))
    except (KeyError, ValueError) as exc:
        raise ProblemError(
            status=422,
            code="REPORT_PREVIEW_INVALID",
            title="Report preview invalid",
            detail="Подписанный preview не содержит лабораторию.",
        ) from exc
    await authorizer.authorize(db, identity.actor_id, "report:5vet-save", ScopeTarget(laboratory_id=laboratory_id))
    ctx = CommandContext(actor_id=identity.actor_id, idempotency_key=_idempotency_key(request))
    view = await commands.save_report(ctx, payload.preview, payload.codes, session_id=identity.session_id, db=db)
    await db.commit()
    return view


@router.get("/5vet/{report_id}", response_model=ReportSnapshotView)
async def get_report(
    report_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReportSnapshotView:
    identity, _actor = principal
    view = await commands.load_report(db, report_id)
    await authorizer.authorize(
        db, identity.actor_id, "report:5vet-read", ScopeTarget(laboratory_id=view.laboratory_id), hide_foreign=True
    )
    response.headers["ETag"] = f'"{view.rev}"'
    response.headers["Cache-Control"] = "no-store"
    return view


@router.delete("/5vet/{report_id}", status_code=204)
async def delete(
    report_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> Response:
    identity, _actor = principal
    _require_csrf(request, identity.csrf_token)
    ctx = CommandContext(
        actor_id=identity.actor_id,
        idempotency_key=_idempotency_key(request),
        expected_revision=resolve_if_match(request.headers.get("if-match")),
    )
    try:
        view = await commands.load_report(db, report_id)
    except ProblemError as exc:
        if exc.code != "NOT_FOUND":
            raise
        # A successful actor-bound replay is safe although the deleted row can
        # no longer supply its laboratory scope. A new key still gets 404.
        await commands.delete_report(ctx, report_id, db=db)
        await db.commit()
        return Response(status_code=204)
    await authorizer.authorize(
        db, identity.actor_id, "report:5vet-delete", ScopeTarget(laboratory_id=view.laboratory_id), hide_foreign=True
    )
    await commands.delete_report(ctx, report_id, db=db)
    await db.commit()
    return Response(status_code=204)


@router.get("/5vet", response_model=ReportSummaryPage)
async def list_reports(
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    page: Annotated[int, Query(ge=1)] = 1,
) -> ReportSummaryPage:
    """The saved-report list of one laboratory (API-08 ``Page<ReportSummary>``)."""
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "report:5vet-list", ScopeTarget(laboratory_id=laboratory_id))
    return await commands.list_reports(db, laboratory_id, page=page)


def _export_response(view: ReportSnapshotView, kind: str) -> FileResponse:
    """Render one saved snapshot through the controlled D02 renderer."""
    model = projection.report_document_view(view)
    form = resources.load_manifest("report-5vet")
    if kind == "pdf":
        data = pdf.render_pdf(model, form)
        filename = projection.report_pdf_filename(view)
        media_type = "application/pdf"
    elif kind == "xlsx":
        data = xlsx.render_xlsx(model, form)
        filename = projection.report_xlsx_filename(view)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:  # pragma: no cover - guarded by the route definition
        raise ProblemError(status=404, code="NOT_FOUND", title="Not found", detail="Форма не найдена.")
    return FileResponse(
        content=data,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )


@router.get("/5vet/{report_id}/export.pdf")
async def export_report_pdf(
    report_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> FileResponse:
    """The controlled PDF built exclusively from the saved snapshot (API-08)."""
    identity, _actor = principal
    view = await commands.load_report(db, report_id)
    await authorizer.authorize(
        db, identity.actor_id, "report:5vet-export", ScopeTarget(laboratory_id=view.laboratory_id), hide_foreign=True
    )
    response.headers["Cache-Control"] = "no-store"
    return _export_response(view, "pdf")


@router.get("/5vet/{report_id}/export.xlsx")
async def export_report_xlsx(
    report_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> FileResponse:
    """The controlled spreadsheet built exclusively from the saved snapshot (API-08)."""
    identity, _actor = principal
    view = await commands.load_report(db, report_id)
    await authorizer.authorize(
        db, identity.actor_id, "report:5vet-export", ScopeTarget(laboratory_id=view.laboratory_id), hide_foreign=True
    )
    response.headers["Cache-Control"] = "no-store"
    return _export_response(view, "xlsx")
