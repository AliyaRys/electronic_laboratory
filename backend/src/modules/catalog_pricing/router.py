"""Catalog and pricing router (API-03).

Read endpoints serve stable pages with ETags of the scoped collection; the
editors enforce CSRF, Idempotency-Key and If-Match per SPEC-04, and the
authorization matrix decides who may edit which scope. ``/pricing/preview``
is a pure read calculation: nothing is persisted.
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import (
    IdempotencyRecorder,
    UnitOfWork,
    canonical_request_hash,
    ensure_revision,
    format_etag,
    resolve_if_match,
)
from backend.src.core.contracts import Page
from backend.src.core.database import async_session
from backend.src.core.problems import ProblemError, idempotency_key_required, not_found
from backend.src.modules.catalog_pricing import commands, queries
from backend.src.modules.catalog_pricing import schemas as backend_schemas
from backend.src.modules.catalog_pricing.schemas import (
    CheckServiceRuleView,
    ClassificationItemView,
    MethodRuleView,
    PricingRequest,
    PricingSnapshot,
    Readiness,
    TariffView,
)
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import CommandStatus, User
from backend.src.modules.identity.session import SessionIdentity, SessionTransport, get_session_transport

__all__ = ["router"]

router = APIRouter(tags=["Catalogs"])

_catalogs = APIRouter(prefix="/catalogs", tags=["Catalogs"])
_pricing = APIRouter(prefix="/pricing", tags=["Pricing"])


def _problem(status: int, code: str, detail: str) -> ProblemError:
    return ProblemError(status=status, code=code, title=code.replace("_", " ").title(), detail=detail)


def _require_csrf(request: Request, identity: SessionIdentity) -> None:
    origin = request.headers.get("origin")
    expected_origin = f"{request.url.scheme}://{request.url.hostname}"
    if origin != expected_origin:
        raise _problem(403, "CSRF_REJECTED", "РСЃС‚РѕС‡РЅРёРє Р·Р°РїСЂРѕСЃР° РЅРµ СЂР°Р·СЂРµС€С‘РЅ.")
    if not identity.csrf_token or not secrets.compare_digest(
        request.headers.get("x-csrf-token", ""), identity.csrf_token
    ):
        raise _problem(403, "CSRF_REJECTED", "РџСЂРѕРІРµСЂРєР° CSRF РЅРµ РїСЂРѕР№РґРµРЅР°.")


def _idempotency_key(request: Request) -> str:
    key = request.headers.get("idempotency-key", "").strip()
    if not key:
        raise idempotency_key_required()
    return key


async def _principal(
    db: Annotated[AsyncSession, Depends(async_session)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
    request: Request,
) -> tuple[SessionIdentity, User]:
    session_id = request.cookies.get(SessionTransport.COOKIE_NAME)
    if not session_id:
        raise _problem(401, "SESSION_REQUIRED", "РўСЂРµР±СѓРµС‚СЃСЏ РІС…РѕРґ РІ СЃРёСЃС‚РµРјСѓ.")
    identity = await transport.read(session_id)
    if identity is None:
        raise _problem(401, "SESSION_EXPIRED", "РЎРµР°РЅСЃ РёСЃС‚С‘Рє.")
    user = (await db.execute(select(User).where(User.id == identity.actor_id))).scalar_one_or_none()
    if user is None or not user.active:
        raise _problem(403, "ACCOUNT_BLOCKED", "РЈС‡С‘С‚РЅР°СЏ Р·Р°РїРёСЃСЊ РЅРµРґРѕСЃС‚СѓРїРЅР°.")
    return identity, user


def _set_collection_headers(
    response: Response, items: Sequence[MethodRuleView | TariffView | CheckServiceRuleView | ClassificationItemView]
) -> None:
    revision = max((item.revision for item in items), default=0)
    response.headers["ETag"] = format_etag(revision)
    response.headers["Cache-Control"] = "no-store"


# --- method rules -----------------------------------------------------------------


@_catalogs.get("/methods", response_model=Page[MethodRuleView])
async def list_methods(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    product_species_id: uuid.UUID,
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[MethodRuleView]:
    identity, _actor = principal
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:read",
        ScopeTarget(laboratory_id=laboratory_id, product_scope_id=product_species_id),
    )
    items, total = await queries.method_rule_page(db, laboratory_id, product_species_id, page)
    _set_collection_headers(response, items)
    return Page[MethodRuleView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@_catalogs.post("/methods", status_code=201, response_model=MethodRuleView)
async def create_method(
    payload: backend_schemas.MethodRuleWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> MethodRuleView:
    identity, actor = principal
    _require_csrf(request, identity)
    key = _idempotency_key(request)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:create",
        ScopeTarget(laboratory_id=payload.laboratory_id, product_scope_id=payload.product_species_id),
    )
    uow = UnitOfWork(db)
    request_hash = canonical_request_hash(payload.model_dump(mode="json"), None)
    record = await IdempotencyRecorder().claim(
        uow,
        actor_id=actor.id,
        action="catalogs.methods.create",
        context_id=payload.laboratory_id,
        key=key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        replayed = await commands.load_method_rule(db, record.result_id)
        if replayed is not None:
            response.headers["Location"] = f"/api/v1/catalogs/methods/{replayed.id}"
            response.headers["ETag"] = format_etag(replayed.rev)
            return queries.method_rule_view(replayed)
    row = await commands.create_method_rule(db, payload)
    await IdempotencyRecorder().complete(uow, record, row.id)
    await uow.commit()
    response.headers["Location"] = f"/api/v1/catalogs/methods/{row.id}"
    response.headers["ETag"] = format_etag(row.rev)
    return queries.method_rule_view(row)


@_catalogs.get("/methods/{rule_id}", response_model=MethodRuleView)
async def get_method(
    rule_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> MethodRuleView:
    identity, _ = principal
    row = await commands.load_method_rule(db, rule_id)
    if row is None:
        raise not_found()
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:read",
        ScopeTarget(laboratory_id=row.laboratory_id, product_scope_id=row.product_species_id),
    )
    response.headers["ETag"] = format_etag(row.rev)
    response.headers["Cache-Control"] = "no-store"
    return queries.method_rule_view(row)


@_catalogs.put("/methods/{rule_id}", response_model=MethodRuleView)
async def update_method(
    rule_id: uuid.UUID,
    payload: backend_schemas.MethodRuleWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> MethodRuleView:
    identity, _ = principal
    _require_csrf(request, identity)
    expected = resolve_if_match(request.headers.get("if-match"))
    row = await commands.load_method_rule(db, rule_id, lock=True)
    if row is None:
        raise not_found()
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:update",
        ScopeTarget(laboratory_id=row.laboratory_id, product_scope_id=row.product_species_id),
    )
    ensure_revision(expected, row.rev)
    row = await commands.update_method_rule(db, row, payload)
    await db.commit()
    response.headers["ETag"] = format_etag(row.rev)
    return queries.method_rule_view(row)


@_catalogs.delete("/methods/{rule_id}", status_code=204)
async def delete_method(
    rule_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    identity, _ = principal
    _require_csrf(request, identity)
    _idempotency_key(request)
    expected = resolve_if_match(request.headers.get("if-match"))
    row = await commands.load_method_rule(db, rule_id, lock=True)
    if row is None:
        return  # idempotent delete of an already removed row
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:delete",
        ScopeTarget(laboratory_id=row.laboratory_id, product_scope_id=row.product_species_id),
    )
    ensure_revision(expected, row.rev)
    await commands.delete_method_rule(db, row)
    await db.commit()


# --- tariffs ----------------------------------------------------------------------


@_catalogs.get("/tariffs", response_model=Page[TariffView])
async def list_tariffs(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    product_species_id: uuid.UUID,
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[TariffView]:
    identity, _actor = principal
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:read",
        ScopeTarget(laboratory_id=laboratory_id, product_scope_id=product_species_id),
    )
    items, total = await queries.tariff_page(db, laboratory_id, product_species_id, page)
    _set_collection_headers(response, items)
    return Page[TariffView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@_catalogs.post("/tariffs", status_code=201, response_model=TariffView)
async def create_tariff(
    payload: backend_schemas.TariffWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> TariffView:
    identity, actor = principal
    _require_csrf(request, identity)
    key = _idempotency_key(request)
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:create",
        ScopeTarget(laboratory_id=payload.laboratory_id, product_scope_id=payload.product_species_id),
    )
    uow = UnitOfWork(db)
    request_hash = canonical_request_hash(payload.model_dump(mode="json"), None)
    record = await IdempotencyRecorder().claim(
        uow,
        actor_id=actor.id,
        action="catalogs.tariffs.create",
        context_id=payload.laboratory_id,
        key=key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        replayed = await commands.load_tariff(db, record.result_id)
        if replayed is not None:
            response.headers["Location"] = f"/api/v1/catalogs/tariffs/{replayed.id}"
            response.headers["ETag"] = format_etag(replayed.rev)
            return queries.tariff_view(replayed)
    row = await commands.create_tariff(db, payload)
    await IdempotencyRecorder().complete(uow, record, row.id)
    await uow.commit()
    response.headers["Location"] = f"/api/v1/catalogs/tariffs/{row.id}"
    response.headers["ETag"] = format_etag(row.rev)
    return queries.tariff_view(row)


@_catalogs.get("/tariffs/{tariff_id}", response_model=TariffView)
async def get_tariff(
    tariff_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> TariffView:
    identity, _ = principal
    row = await commands.load_tariff(db, tariff_id)
    if row is None:
        raise not_found()
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:read",
        ScopeTarget(laboratory_id=row.laboratory_id, product_scope_id=row.product_species_id),
    )
    response.headers["ETag"] = format_etag(row.rev)
    response.headers["Cache-Control"] = "no-store"
    return queries.tariff_view(row)


@_catalogs.put("/tariffs/{tariff_id}", response_model=TariffView)
async def update_tariff(
    tariff_id: uuid.UUID,
    payload: backend_schemas.TariffWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> TariffView:
    identity, _ = principal
    _require_csrf(request, identity)
    expected = resolve_if_match(request.headers.get("if-match"))
    row = await commands.load_tariff(db, tariff_id, lock=True)
    if row is None:
        raise not_found()
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:update",
        ScopeTarget(laboratory_id=row.laboratory_id, product_scope_id=row.product_species_id),
    )
    ensure_revision(expected, row.rev)
    row = await commands.update_tariff(db, row, payload)
    await db.commit()
    response.headers["ETag"] = format_etag(row.rev)
    return queries.tariff_view(row)


@_catalogs.delete("/tariffs/{tariff_id}", status_code=204)
async def delete_tariff(
    tariff_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    identity, _ = principal
    _require_csrf(request, identity)
    _idempotency_key(request)
    expected = resolve_if_match(request.headers.get("if-match"))
    row = await commands.load_tariff(db, tariff_id, lock=True)
    if row is None:
        return
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:delete",
        ScopeTarget(laboratory_id=row.laboratory_id, product_scope_id=row.product_species_id),
    )
    ensure_revision(expected, row.rev)
    await commands.delete_tariff(db, row)
    await db.commit()


# --- CHECK service rules (global) --------------------------------------------------


@_catalogs.get("/check-services", response_model=Page[CheckServiceRuleView])
async def list_check_services(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[CheckServiceRuleView]:
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "catalog:read", None)
    items, total = await queries.check_service_rule_page(db, page)
    _set_collection_headers(response, items)
    return Page[CheckServiceRuleView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@_catalogs.post("/check-services", status_code=201, response_model=CheckServiceRuleView)
async def create_check_service(
    payload: backend_schemas.CheckServiceRuleWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> CheckServiceRuleView:
    identity, actor = principal
    _require_csrf(request, identity)
    key = _idempotency_key(request)
    # Global configuration: only the role gate applies (no laboratory to scope).
    await authorizer.authorize(db, identity.actor_id, "catalog:create", None)
    uow = UnitOfWork(db)
    request_hash = canonical_request_hash(payload.model_dump(mode="json"), None)
    record = await IdempotencyRecorder().claim(
        uow,
        actor_id=actor.id,
        action="catalogs.check-services.create",
        context_id=actor.id,
        key=key,
        request_hash=request_hash,
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        replayed = await commands.load_check_service_rule(db, record.result_id)
        if replayed is not None:
            response.headers["Location"] = f"/api/v1/catalogs/check-services/{replayed.id}"
            response.headers["ETag"] = format_etag(replayed.rev)
            return queries.check_service_rule_view(replayed)
    row = await commands.create_check_service_rule(db, payload)
    await IdempotencyRecorder().complete(uow, record, row.id)
    await uow.commit()
    response.headers["Location"] = f"/api/v1/catalogs/check-services/{row.id}"
    response.headers["ETag"] = format_etag(row.rev)
    return queries.check_service_rule_view(row)


@_catalogs.get("/check-services/{rule_id}", response_model=CheckServiceRuleView)
async def get_check_service(
    rule_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> CheckServiceRuleView:
    identity, _ = principal
    row = await commands.load_check_service_rule(db, rule_id)
    if row is None:
        raise not_found()
    await authorizer.authorize(db, identity.actor_id, "catalog:read", None)
    response.headers["ETag"] = format_etag(row.rev)
    response.headers["Cache-Control"] = "no-store"
    return queries.check_service_rule_view(row)


# --- classification maps (global, versioned) ---------------------------------------


@_catalogs.put("/check-services/{rule_id}", response_model=CheckServiceRuleView)
async def update_check_service(
    rule_id: uuid.UUID,
    payload: backend_schemas.CheckServiceRuleWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> CheckServiceRuleView:
    identity, _ = principal
    _require_csrf(request, identity)
    expected = resolve_if_match(request.headers.get("if-match"))
    row = await commands.load_check_service_rule(db, rule_id, lock=True)
    if row is None:
        raise not_found()
    await authorizer.authorize(db, identity.actor_id, "catalog:update", None)
    ensure_revision(expected, row.rev)
    row = await commands.update_check_service_rule(db, row, payload)
    await db.commit()
    response.headers["ETag"] = format_etag(row.rev)
    return queries.check_service_rule_view(row)


@_catalogs.delete("/check-services/{rule_id}", status_code=204)
async def delete_check_service(
    rule_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    identity, _ = principal
    _require_csrf(request, identity)
    _idempotency_key(request)
    expected = resolve_if_match(request.headers.get("if-match"))
    row = await commands.load_check_service_rule(db, rule_id, lock=True)
    if row is None:
        return
    await authorizer.authorize(db, identity.actor_id, "catalog:delete", None)
    ensure_revision(expected, row.rev)
    await commands.delete_check_service_rule(db, row)
    await db.commit()


@_catalogs.get("/classifications", response_model=Page[ClassificationItemView])
async def list_classifications(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    version: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[ClassificationItemView]:
    identity, _actor = principal
    await authorizer.authorize(db, identity.actor_id, "catalog:read", None)
    items, total = await queries.classification_page(db, version, page)
    _set_collection_headers(response, items)
    return Page[ClassificationItemView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@_catalogs.post("/classifications", status_code=201, response_model=Page[ClassificationItemView])
async def create_classification_version(
    payload: backend_schemas.ClassificationWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> Page[ClassificationItemView]:
    identity, actor = principal
    _require_csrf(request, identity)
    key = _idempotency_key(request)
    await authorizer.authorize(db, identity.actor_id, "catalog:create", None)
    uow = UnitOfWork(db)
    request_hash = canonical_request_hash(payload.model_dump(mode="json"), None)
    record = await IdempotencyRecorder().claim(
        uow,
        actor_id=actor.id,
        action="catalogs.classifications.create",
        context_id=actor.id,
        key=key,
        request_hash=request_hash,
    )
    rows = await commands.create_classification_version(db, payload)
    if record.status == CommandStatus.IN_PROGRESS:
        await IdempotencyRecorder().complete(uow, record, rows[0].id)
    await uow.commit()
    response.headers["Location"] = f"/api/v1/catalogs/classifications?version={payload.version}"
    items = [queries.classification_view(row) for row in rows]
    return Page[ClassificationItemView](items=items, total=len(items), page=1, page_size=queries.PAGE_SIZE)


@_catalogs.delete("/classifications/{version}", status_code=204)
async def delete_classification_version(
    version: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    identity, _ = principal
    _require_csrf(request, identity)
    _idempotency_key(request)
    await authorizer.authorize(db, identity.actor_id, "catalog:delete", None)
    removed = await commands.delete_classification_version(db, version)
    if not removed:
        raise not_found()
    await db.commit()


# --- readiness and pricing preview -------------------------------------------------


@_catalogs.get("/readiness", response_model=Readiness)
async def get_readiness(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    laboratory_id: uuid.UUID,
    product_species_id: uuid.UUID,
) -> Readiness:
    identity, _ = principal
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:read",
        ScopeTarget(laboratory_id=laboratory_id, product_scope_id=product_species_id),
    )
    response.headers["Cache-Control"] = "no-store"
    return await queries.readiness(db, laboratory_id, product_species_id)


@_pricing.post("/preview", response_model=PricingSnapshot)
async def preview_pricing(
    payload: PricingRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(_principal)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> PricingSnapshot:
    """Read-only calculation; it never persists anything (API-03)."""
    identity, _ = principal
    if payload.laboratory_id is None:
        raise _problem(422, "VALIDATION_ERROR", "Р Р°СЃС‡С‘С‚ С‚СЂРµР±СѓРµС‚ Р»Р°Р±РѕСЂР°С‚РѕСЂРёСЋ РїР°СЂС‚РёРё.")
    if payload.product_species_id is None:
        raise _problem(422, "VALIDATION_ERROR", "Р Р°СЃС‡С‘С‚ С‚СЂРµР±СѓРµС‚ РІРёРґ РїСЂРѕРґСѓРєС†РёРё РїР°СЂС‚РёРё.")
    await authorizer.authorize(
        db,
        identity.actor_id,
        "catalog:read",
        ScopeTarget(laboratory_id=payload.laboratory_id, product_scope_id=payload.product_species_id),
    )
    response.headers["Cache-Control"] = "no-store"
    return await evaluate_and_price(UnitOfWork(db), payload, None)


router.include_router(_catalogs)
router.include_router(_pricing)
