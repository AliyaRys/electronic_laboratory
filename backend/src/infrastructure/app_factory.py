"""Application factory (adapted from the FastAPI boilerplate fork)."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import APIRouter, FastAPI

from backend.src.core.problems import register_exception_handlers
from backend.src.infrastructure.config.settings import Settings, get_settings
from backend.src.infrastructure.middleware import RequestContextMiddleware, SecurityHeadersMiddleware

__all__ = ["create_application", "lifespan_factory"]


def lifespan_factory(settings: Settings) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """A minimal lifespan: the schema is owned by migrations, not by app startup."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        del app
        yield

    return lifespan


def create_application(router: APIRouter, settings: Settings | None = None) -> FastAPI:
    """Create the configured FastAPI application."""
    settings = settings or get_settings()

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan_factory(settings),
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
    )

    register_exception_handlers(application)

    # Middleware ordering: last added runs first for requests.
    application.add_middleware(RequestContextMiddleware)
    application.add_middleware(SecurityHeadersMiddleware, environment=settings.environment.value)

    application.include_router(router)

    return application
