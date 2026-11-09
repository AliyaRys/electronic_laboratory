"""Identity router: API-02 access endpoints plus API-09 health probes.

There is deliberately no public signup route: initial bootstrap remains a
closed CLI. User administration arrives in Task I03.
"""

from __future__ import annotations

import secrets
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
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
from backend.src.core.problems import (
    ProblemError,
    ProblemItem,
    dependency_unavailable,
    idempotency_key_required,
    not_found,
    validation_error,
)
from backend.src.infrastructure.config.settings import Settings, get_settings
from backend.src.modules.identity import commands, queries
from backend.src.modules.identity.authz import AccessSnapshot, Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import CommandStatus, User, UserRole
from backend.src.modules.identity.passwords import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    validate_password,
    verify_password,
)
from backend.src.modules.identity.schemas import (
    ChangePasswordRequest,
    CsrfResponse,
    LiveResponse,
    LoginRequest,
    LoginResponse,
    ReadyResponse,
    ResetPasswordRequest,
    ScopeView,
    UserEventView,
    UserView,
    UserWrite,
)
from backend.src.modules.identity.session import (
    SessionIdentity,
    SessionTransport,
    get_session_transport,
    session_expired,
    session_required,
)

# The Alembic head revision this build expects. Guarded by a test so it cannot
# drift from the migration file.
CURRENT_SCHEMA_REVISION = "0012_vetis_operations"

__all__ = ["router", "CURRENT_SCHEMA_REVISION"]

router = APIRouter(tags=["System"])
auth_router = APIRouter(prefix="/auth", tags=["Access"])
users_router = APIRouter(prefix="/users", tags=["Access"])


def _problem(status: int, code: str, detail: str, *, headers: dict[str, str] | None = None) -> ProblemError:
    return ProblemError(status=status, code=code, title=code.replace("_", " ").title(), detail=detail, headers=headers)


def _origin(request: Request) -> str:
    default_port = 443 if request.url.scheme == "https" else 80
    port = request.url.port
    suffix = "" if port in (None, default_port) else f":{port}"
    return f"{request.url.scheme}://{request.url.hostname}{suffix}"


def _require_origin(request: Request) -> None:
    if request.headers.get("origin") != _origin(request):
        raise _problem(403, "CSRF_REJECTED", "Источник запроса не разрешён.")


def _require_csrf(request: Request, expected: str) -> None:
    _require_origin(request)
    supplied = request.headers.get("x-csrf-token", "")
    if not supplied or not secrets.compare_digest(supplied, expected):
        raise _problem(403, "CSRF_REJECTED", "Проверка CSRF не пройдена.")


async def require_session(
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
) -> tuple[SessionIdentity, User]:
    session_id = request.cookies.get(SessionTransport.COOKIE_NAME)
    if not session_id:
        raise session_required()
    identity = await transport.read(session_id)
    if identity is None:
        raise session_expired()
    user = (await db.execute(select(User).where(User.id == identity.actor_id))).scalar_one_or_none()
    if user is None:
        await transport.revoke(identity.session_id, identity.actor_id)
        raise session_required()
    if not user.active:
        raise _problem(403, "ACCOUNT_BLOCKED", "Учётная запись заблокирована.")
    return identity, user


async def _contexts(db: AsyncSession, user: User) -> list[ScopeView]:
    return await queries.user_contexts(db, user)


async def _user_view(db: AsyncSession, user: User) -> UserView:
    return await queries.build_user_view(db, user)


@router.get("/health/live", response_model=LiveResponse)
async def live() -> LiveResponse:
    """Liveness probe — no secrets (API-09)."""
    return LiveResponse(status="alive")


@router.get("/health/ready", response_model=ReadyResponse)
async def ready(db: Annotated[AsyncSession, Depends(async_session)]) -> ReadyResponse:
    """Readiness probe — database reachable and schema at the current head (API-09).

    A stale or missing ``alembic_version`` answers ``503 DEPENDENCY_UNAVAILABLE``;
    VetIS readiness is reported separately, never here.
    """
    try:
        version = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
    except SQLAlchemyError:
        raise dependency_unavailable("База данных недоступна или схема не инициализирована.") from None

    if version != CURRENT_SCHEMA_REVISION:
        raise dependency_unavailable("Версия схемы БД не соответствует текущей ревизии приложения.")

    return ReadyResponse(status="ready", schema_revision=str(version))


@auth_router.get("/csrf", response_model=CsrfResponse)
async def csrf(response: Response, settings: Annotated[Settings, Depends(get_settings)]) -> CsrfResponse:
    token = secrets.token_urlsafe(32)
    response.set_cookie(
        SessionTransport.CSRF_COOKIE_NAME,
        token,
        secure=settings.session_cookie_secure,
        httponly=False,
        samesite="lax",
        max_age=900,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return CsrfResponse(csrf_token=token)


@auth_router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LoginResponse:
    bootstrap_csrf = request.cookies.get(SessionTransport.CSRF_COOKIE_NAME, "")
    _require_csrf(request, bootstrap_csrf)
    login_name = payload.login.strip()
    ip = request.client.host if request.client else "unknown"
    if await transport.is_login_blocked(ip, login_name):
        raise _problem(
            429, "LOGIN_RATE_LIMITED", "Слишком много попыток входа. Повторите позже.", headers={"Retry-After": "900"}
        )
    user = (await db.execute(select(User).where(User.login == login_name).with_for_update())).scalar_one_or_none()
    password_matches = verify_password(
        payload.password, user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    )
    if user is None or not password_matches:
        failures = await transport.record_login_failure(ip, login_name)
        # The fifth failure is still the fifth invalid credential response;
        # the next request is the blocked sixth attempt.
        del failures
        raise _problem(401, "INVALID_CREDENTIALS", "Неверный логин или пароль.")
    if not user.active:
        raise _problem(403, "ACCOUNT_BLOCKED", "Учётная запись заблокирована.")
    await transport.clear_login_failures(ip, login_name)
    identity = await transport.create(user.id)
    response.set_cookie(
        SessionTransport.COOKIE_NAME,
        identity.session_id,
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
        max_age=8 * 60 * 60,
        path="/",
    )
    response.set_cookie(
        SessionTransport.CSRF_COOKIE_NAME,
        identity.csrf_token,
        secure=settings.session_cookie_secure,
        httponly=False,
        samesite="lax",
        max_age=8 * 60 * 60,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return LoginResponse(
        user=await _user_view(db, user), contexts=await _contexts(db, user), csrf_token=identity.csrf_token
    )


@auth_router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
) -> None:
    identity, _ = principal
    _require_csrf(request, identity.csrf_token)
    await transport.revoke(identity.session_id, identity.actor_id)
    response.delete_cookie(SessionTransport.COOKIE_NAME, path="/")
    response.delete_cookie(SessionTransport.CSRF_COOKIE_NAME, path="/")
    response.headers["Cache-Control"] = "no-store"


@router.get("/me", response_model=UserView)
async def me(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> UserView:
    _, user = principal
    await authorizer.authorize(db, user.id, "profile:read", ScopeTarget(user_id=user.id))
    response.headers["Cache-Control"] = "no-store"
    return await _user_view(db, user)


@router.get("/contexts", response_model=list[ScopeView])
async def contexts(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> list[ScopeView]:
    _, user = principal
    await authorizer.authorize(db, user.id, "context:list", None)
    response.headers["Cache-Control"] = "no-store"
    return await _contexts(db, user)


@router.post("/me/change-password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    identity, user = principal
    _require_csrf(request, identity.csrf_token)
    user = (await db.execute(select(User).where(User.id == user.id).with_for_update())).scalar_one()
    await authorizer.authorize(db, user.id, "password:change", ScopeTarget(user_id=user.id))
    errors: list[ProblemItem] = []
    if not verify_password(payload.current_password, user.password_hash):
        errors.append(ProblemItem(path="current_password", message="Текущий пароль указан неверно."))
    if payload.new_password != payload.confirmation:
        errors.append(ProblemItem(path="confirmation", message="Пароли не совпадают."))
    try:
        validate_password(payload.new_password)
    except ValueError as exc:
        errors.append(ProblemItem(path="new_password", message=str(exc)))
    if errors:
        raise validation_error(errors)
    user.password_hash = hash_password(payload.new_password)
    user.rev += 1
    await db.flush()
    await transport.revoke_all(user.id)
    await db.commit()


# --- User administration (API-02) ----------------------------------------------


async def _scoped_target(
    db: AsyncSession,
    authorizer: Authorizer,
    actor: User,
    action: str,
    user_id: uuid.UUID,
    *,
    lock: bool = False,
) -> tuple[AccessSnapshot, User]:
    """Authorize the ADMIN action and resolve the target inside the delegation.

    With ``lock=True`` the target row is re-read ``FOR UPDATE`` before the
    caller's revision check, so concurrent If-Match mutations serialize (SPEC-04:
    locks before the remaining command work).
    """
    target = await commands.load_target(db, user_id, lock=lock)
    if target is None:
        raise not_found()
    snapshot = await authorizer.authorize(db, actor.id, action, None)
    territories = await commands.user_territories(db, target.id)
    # A user inside the delegation is visible; a user without any territory is
    # unassigned staff, carries no territory data and stays manageable.
    if territories and not territories & commands.allowed_territories(snapshot):
        # A foreign user UUID answers 404 without revealing its attributes.
        raise not_found()
    return snapshot, target


def _idempotency_key(request: Request) -> str:
    key = request.headers.get("idempotency-key", "").strip()
    if not key:
        raise idempotency_key_required()
    return key


@users_router.post("/register", status_code=404, include_in_schema=False, response_model=None)
async def no_public_signup() -> None:
    """There is deliberately no public signup: bootstrap stays a closed CLI."""
    raise not_found("Публичная регистрация отсутствует.")


@users_router.get("", response_model=Page[UserView])
async def list_users(
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    role: UserRole | None = None,
    status: Literal["active", "inactive"] | None = None,
    laboratory_id: uuid.UUID | None = None,
    product_scope_id: uuid.UUID | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[UserView]:
    identity, actor = principal
    snapshot = await authorizer.authorize(db, identity.actor_id, "users:list", None)
    items, total = await queries.user_page(
        db,
        allowed=commands.allowed_territories(snapshot),
        role=role,
        status=status,
        laboratory_id=laboratory_id,
        product_scope_id=product_scope_id,
        query=q,
        page=page,
    )
    response.headers["Cache-Control"] = "no-store"
    return Page[UserView](
        items=[await queries.build_user_view(db, item) for item in items],
        total=total,
        page=page,
        page_size=queries.PAGE_SIZE,
    )


@users_router.post("", status_code=201, response_model=UserView)
async def create_user(
    payload: UserWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> UserView:
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    snapshot = await authorizer.authorize(db, actor.id, "users:create", None)
    request_hash = canonical_request_hash(payload.model_dump(mode="json"), None)
    recorder = IdempotencyRecorder()
    uow = UnitOfWork(db)
    record = await recorder.claim(
        uow, actor_id=actor.id, action="users.create", context_id=actor.id, key=key, request_hash=request_hash
    )
    if record.status == CommandStatus.SUCCESS and record.result_id is not None:
        replayed = await commands.load_target(db, record.result_id)
        if replayed is not None:
            response.headers["Location"] = f"/api/v1/users/{replayed.id}"
            return await queries.build_user_view(db, replayed)
    user = await commands.create_user(db, actor_id=actor.id, snapshot=snapshot, payload=payload, record=record)
    response.headers["Location"] = f"/api/v1/users/{user.id}"
    response.headers["ETag"] = format_etag(user.rev)
    return await queries.build_user_view(db, user)


@users_router.get("/{user_id}", response_model=UserView)
async def get_user(
    user_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> UserView:
    identity, actor = principal
    _, target = await _scoped_target(db, authorizer, actor, "users:read", user_id)
    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = format_etag(target.rev)
    return await queries.build_user_view(db, target)


@users_router.put("/{user_id}", response_model=UserView)
async def update_user(
    user_id: uuid.UUID,
    payload: UserWrite,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> UserView:
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    expected = resolve_if_match(request.headers.get("if-match"))
    snapshot, target = await _scoped_target(db, authorizer, actor, "users:update", user_id, lock=True)
    ensure_revision(expected, target.rev)
    updated = await commands.update_user(db, actor_id=actor.id, snapshot=snapshot, target=target, payload=payload)
    response.headers["ETag"] = format_etag(updated.rev)
    return await queries.build_user_view(db, updated)


@users_router.post("/{user_id}/block", response_model=UserView)
async def block_user(
    user_id: uuid.UUID,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
) -> UserView:
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    expected = resolve_if_match(request.headers.get("if-match"))
    _, target = await _scoped_target(db, authorizer, actor, "users:block", user_id, lock=True)
    ensure_revision(expected, target.rev)
    updated = await commands.set_active(db, actor_id=actor.id, target=target, active=False)
    await transport.revoke_all(updated.id)  # outside the SQL transaction (SPEC-04)
    response.headers["ETag"] = format_etag(updated.rev)
    return await queries.build_user_view(db, updated)


@users_router.post("/{user_id}/unblock", response_model=UserView)
async def unblock_user(
    user_id: uuid.UUID,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> UserView:
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    expected = resolve_if_match(request.headers.get("if-match"))
    _, target = await _scoped_target(db, authorizer, actor, "users:unblock", user_id, lock=True)
    ensure_revision(expected, target.rev)
    updated = await commands.set_active(db, actor_id=actor.id, target=target, active=True)
    response.headers["ETag"] = format_etag(updated.rev)
    return await queries.build_user_view(db, updated)


@users_router.post("/{user_id}/reset-password", status_code=204)
async def reset_user_password(
    user_id: uuid.UUID,
    payload: ResetPasswordRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    transport: Annotated[SessionTransport, Depends(get_session_transport)],
) -> None:
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    expected = resolve_if_match(request.headers.get("if-match"))
    _, target = await _scoped_target(db, authorizer, actor, "users:reset-password", user_id, lock=True)
    ensure_revision(expected, target.rev)
    await commands.reset_password(
        db, actor_id=actor.id, target=target, password=payload.new_password, confirmation=payload.confirmation
    )
    await transport.revoke_all(target.id)  # outside the SQL transaction (SPEC-04)


@users_router.get("/{user_id}/history", response_model=Page[UserEventView])
async def user_history(
    user_id: uuid.UUID,
    response: Response,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
    page: Annotated[int, Query(ge=1)] = 1,
) -> Page[UserEventView]:
    identity, actor = principal
    _, target = await _scoped_target(db, authorizer, actor, "users:history", user_id)
    items, total = await queries.history_page(db, target.id, page)
    response.headers["Cache-Control"] = "no-store"
    return Page[UserEventView](items=items, total=total, page=page, page_size=queries.PAGE_SIZE)


@users_router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(async_session)],
    principal: Annotated[tuple[SessionIdentity, User], Depends(require_session)],
    authorizer: Annotated[Authorizer, Depends(get_authorizer)],
) -> None:
    identity, actor = principal
    _require_csrf(request, identity.csrf_token)
    key = _idempotency_key(request)
    await _scoped_target(db, authorizer, actor, "users:delete", user_id)
    request_hash = canonical_request_hash(None, None)
    record = await IdempotencyRecorder().claim(
        UnitOfWork(db), actor_id=actor.id, action="users.delete", context_id=user_id, key=key, request_hash=request_hash
    )
    if record.status == CommandStatus.SUCCESS:
        return  # idempotent replay of the same delete
    await commands.delete_user(db, actor_id=actor.id, target_id=user_id, record=record)


router.include_router(auth_router)
router.include_router(users_router)
