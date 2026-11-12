"""Arrivals router (API-04): scoped queues, single read, hide, honest sync."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext, format_etag, resolve_if_match
from backend.src.core.contracts import Page
from backend.src.core.database import async_session
from backend.src.core.problems import not_found
from backend.src.modules.arrivals import commands, queries, reconciliation
from backend.src.modules.arrivals.models import IncomingDocument, Party, Reconciliation
from backend.src.modules.arrivals.schemas import IncomingView, ReconciliationView, ReconciliationWrite
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import User
from backend.src.modules.identity.router import _idempotency_key, _require_csrf, require_session
from backend.src.modules.identity.session import SessionIdentity
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.contracts import ReceiptPreview, UserConfirmation
from backend.src.modules.integrations.vetis.models import (
    VetisOperation,
    VetisOperationKind,
    VetisSourceDocument,
)
from backend.src.modules.integrations.vetis.receipt import build_receipt_preview, queue_receipt, write_enabled

router = APIRouter(prefix="/arrivals", tags=["Arrivals"])

__all__ = ["router"]


class SyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    laboratory_id: uuid.UUID


class ReceiptPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_revision: int
    reconciliation_revision: int
    vet_inspection: Literal["CORRESPONDS", "MISMATCH", "UNSUPERVISED"]
    delivery_date: datetime | None = None
    # ТЗ DR8 §9: the ENTERED return date of the returned delivery (never the
    # request date) and the frozen server issue date echoed on submit.
    return_date: datetime | None = None
    issue_date: datetime | None = None


class ReceiptSubmitRequest(ReceiptPreviewRequest):
    fingerprint: str
    delivery_date: datetime


class ReceiptAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: uuid.UUID
    state: str
    status_url: str


class ReceiptContext(BaseModel):
    """Safe read model for the receipt UI; it never exposes XML or credentials."""

    model_config = ConfigDict(extra="forbid")

    write_enabled: bool
    source_revision: int | None
    reconciliation_revision: int | None
    operation_id: uuid.UUID | None
    operation_state: str | None


async def _scoped_party(
    db: AsyncSession,
    authorizer: Authorizer,
    actor: User,
    party_id: uuid.UUID,
    action: str = "arrivals:read",
    *,
    lock: bool = False,
) -> Party:
    statement = select(Party).where(Party.id == party_id)
    if lock:
        statement = statement.with_for_update()
    party = (await db.execute(statement)).scalar_one_or_none()
    if party is None:
        raise not_found()
    await authorizer.authorize(db, actor.id, action, ScopeTarget(laboratory_id=party.laboratory_id), hide_foreign=True)
    return party


@router.get("", response_model=Page[IncomingView])
async def list_arrivals(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    queue: Literal["EXPECTED", "WORK", "ACCEPTED"] | None = None,
    result: Literal["WAITING", "RETURNED", "COMPLETED"] | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    # DR15 §5.2: sort by the ВСД issue date; an unknown value is an honest 422.
    sort: Literal["asc", "desc"] | None = None,
) -> Page[IncomingView]:
    """A scoped page of arrivals (queue/result filters, search, stable order)."""
    identity, actor = principal
    await authorizer.authorize(db, identity.actor_id, "arrivals:list", ScopeTarget(laboratory_id=laboratory_id))
    parties, documents, total = await queries.arrival_page(
        db,
        laboratory_id=laboratory_id,
        queue=queue,
        result=result,
        query=q,
        page=page,
        sort=sort,
    )
    views: list[IncomingView] = []
    for party, document in zip(parties, documents, strict=True):
        views.append(await queries.build_incoming_view(db, party, document))
    response.headers["Cache-Control"] = "no-store"
    return Page[IncomingView](items=views, total=total, page=page, page_size=queries.PAGE_SIZE)


@router.get("/{party_id}", response_model=IncomingView)
async def get_arrival(
    party_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> IncomingView:
    identity, actor = principal
    party = await _scoped_party(db, authorizer, actor, party_id)
    document = (
        await db.execute(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))
    ).scalar_one()
    view = await queries.build_incoming_view(db, party, document)
    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = format_etag(party.rev)
    return view


@router.get("/{party_id}/reconciliation", response_model=ReconciliationView)
async def get_reconciliation(
    party_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReconciliationView:
    """The saved reconciliation of one party; before the first save the view
    is an empty OPEN state carrying the parent (party) ETag (API-04)."""
    identity, actor = principal
    party = await _scoped_party(db, authorizer, actor, party_id)
    document = (
        await db.execute(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))
    ).scalar_one()
    row = await reconciliation.load_reconciliation(db, party_id)
    view = reconciliation.build_reconciliation_view(row, party, document)
    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = format_etag(view.revision)
    return view


@router.get("/{party_id}/receipt-context", response_model=ReceiptContext)
async def get_receipt_context(
    party_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReceiptContext:
    """Return only the capability, frozen revisions and latest operation.

    This read endpoint is deliberately side-effect free.  The preview and
    submit routes repeat authorization and all source/revision checks.
    """
    _, actor = principal
    party = await _scoped_party(db, authorizer, actor, party_id, "receipt:submit")
    document = (
        await db.execute(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))
    ).scalar_one()
    source_revision = (
        await db.execute(
            select(VetisSourceDocument.revision).where(
                VetisSourceDocument.contour == document.contour,
                VetisSourceDocument.evsd_uuid == document.evsd_uuid,
            )
        )
    ).scalar_one_or_none()
    reconciliation_revision = (
        await db.execute(select(Reconciliation.rev).where(Reconciliation.party_id == party_id))
    ).scalar_one_or_none()
    operation = (
        await db.execute(
            select(VetisOperation)
            .where(
                VetisOperation.party_id == party_id,
                VetisOperation.kind == VetisOperationKind.RECEIPT,
            )
            .order_by(VetisOperation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    response.headers["Cache-Control"] = "no-store"
    return ReceiptContext(
        write_enabled=write_enabled(),
        source_revision=source_revision,
        reconciliation_revision=reconciliation_revision,
        operation_id=operation.id if operation is not None else None,
        operation_state=str(operation.state) if operation is not None else None,
    )


@router.put("/{party_id}/reconciliation", response_model=ReconciliationView)
async def put_reconciliation(
    party_id: uuid.UUID,
    payload: ReconciliationWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReconciliationView:
    """Save the started reconciliation (OPEN state; completion belongs to the
    external receipt). SPEC-04: Idempotency-Key + If-Match under the party
    lock; the first save uses the party ETag, later saves the reconciliation
    ETag. A decision the current grounds forbid is refused, never merged."""
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    expected = resolve_if_match(request.headers.get("if-match"))
    await _scoped_party(db, authorizer, actor, party_id, "reconciliation:save", lock=True)
    ctx = CommandContext(actor_id=identity.actor_id, idempotency_key=key, expected_revision=expected)
    view = await reconciliation.save_reconciliation(ctx, party_id, payload, uow=db)
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = format_etag(view.revision)
    return view


@router.post("/{party_id}/receipt-preview", response_model=ReceiptPreview)
async def preview_receipt(
    party_id: uuid.UUID,
    payload: ReceiptPreviewRequest,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReceiptPreview:
    """Build XML locally. This endpoint never queues or contacts VetIS."""
    identity, actor = principal
    await _scoped_party(db, authorizer, actor, party_id, "receipt:submit")
    return await build_receipt_preview(
        db,
        party_id=party_id,
        source_revision=payload.source_revision,
        reconciliation_revision=payload.reconciliation_revision,
        vet_inspection=payload.vet_inspection,
        delivery_date=payload.delivery_date,
        return_date=payload.return_date,
        issue_date=payload.issue_date,
    )


@router.post("/{party_id}/receipt", status_code=202, response_model=ReceiptAccepted)
async def submit_receipt(
    party_id: uuid.UUID,
    payload: ReceiptSubmitRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> ReceiptAccepted:
    """Freeze the re-built preview and queue one irreversible operation."""
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    _idempotency_key(request)
    await _scoped_party(db, authorizer, actor, party_id, "receipt:submit", lock=True)
    preview = await build_receipt_preview(
        db,
        party_id=party_id,
        source_revision=payload.source_revision,
        reconciliation_revision=payload.reconciliation_revision,
        vet_inspection=payload.vet_inspection,
        delivery_date=payload.delivery_date,
        return_date=payload.return_date,
        issue_date=payload.issue_date,
    )
    operation = await queue_receipt(
        db,
        preview=preview,
        confirmation=UserConfirmation(
            actor_id=identity.actor_id,
            fingerprint=payload.fingerprint,
            confirmed_at=datetime.now(UTC),
        ),
    )
    await db.commit()
    return ReceiptAccepted(
        operation_id=operation.id,
        state=operation.state,
        status_url=f"/api/v1/operations/{operation.id}",
    )


@router.delete("/{party_id}", status_code=204)
async def hide_arrival(
    party_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    """Hide an expected arrival (204). The eVSD itself is never annulled."""
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    _idempotency_key(request)
    expected = resolve_if_match(request.headers.get("if-match"))
    await _scoped_party(db, authorizer, actor, party_id, "arrivals:hide", lock=True)
    await commands.hide_incoming(db, identity.actor_id, party_id, expected)
    await db.commit()


@router.post("/sync", status_code=202, response_model=sync.SyncAccepted)
async def sync_arrivals(
    payload: SyncRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> sync.SyncAccepted:
    """API-04: accept the manual refresh as the SAME durable job the 15-minute
    scheduler uses (202 SyncRun — never a sync confirmation). API readiness
    does not depend on VetIS: an unconfigured run fails honestly later, the
    checkpoint stays put, and a missing binding is refused before any intent."""
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    await authorizer.authorize(db, identity.actor_id, "vetis:sync", ScopeTarget(laboratory_id=payload.laboratory_id))
    accepted = await sync.start_sync(db, actor_id=identity.actor_id, laboratory_id=payload.laboratory_id)
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return accepted
