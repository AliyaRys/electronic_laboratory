"""Identity router: API-02 access endpoints plus API-09 health probes.

There is deliberately no public signup route: initial bootstrap remains a
closed CLI. User administration arrives in Task I03.
"""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import async_session
from backend.src.core.problems import ProblemError, ProblemItem, dependency_unavailable, validation_error
from backend.src.infrastructure.config.settings import Settings, get_settings
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import DelegationGrant, User, UserRole, UserScope
from backend.src.modules.identity.passwords import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    validate_password,
    verify_password,
)
from backend.src.modules.identity.policies import PERMISSION_MATRIX
from backend.src.modules.identity.schemas import (
    ChangePasswordRequest,
    CsrfResponse,
    LiveResponse,
    LoginRequest,
    LoginResponse,
    ReadyResponse,
    ScopeView,
    UserView,
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
CURRENT_SCHEMA_REVISION = "0002_auth_policy_adapter"

__all__ = ["router", "CURRENT_SCHEMA_REVISION"]

router = APIRouter(tags=["System"])
auth_router = APIRouter(prefix="/auth", tags=["Access"])


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


def _capabilities(user: User) -> list[str]:
    role = UserRole(user.role)
    return sorted(action for action, roles in PERMISSION_MATRIX.items() if role in roles)


async def _contexts(db: AsyncSession, user: User) -> list[ScopeView]:
    if UserRole(user.role) == UserRole.ADMIN:
        grants = (await db.execute(select(DelegationGrant).where(DelegationGrant.target_id == user.id))).scalars().all()
        return [ScopeView(territory_id=item.territory_id) for item in grants]
    scopes = (await db.execute(select(UserScope).where(UserScope.user_id == user.id))).scalars().all()
    return [ScopeView(laboratory_id=item.laboratory_id, product_scope_id=item.product_scope_id) for item in scopes]


async def _user_view(db: AsyncSession, user: User) -> UserView:
    return UserView(
        id=user.id,
        full_name=user.full_name,
        login=user.login,
        email=user.email,
        position=user.position,
        role=UserRole(user.role),
        active=user.active,
        scopes=await _contexts(db, user),
        capabilities=_capabilities(user),
        revision=user.rev,
    )


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
        path="/api/v1",
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
        path="/api/v1",
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
    response.delete_cookie(SessionTransport.CSRF_COOKIE_NAME, path="/api/v1")
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


router.include_router(auth_router)
