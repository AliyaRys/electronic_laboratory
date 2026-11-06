"""Reusable middleware (adapted from the FastAPI boilerplate fork)."""

from __future__ import annotations

import uuid

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

HSTS_MAX_AGE_SECONDS = 63072000

__all__ = ["RequestContextMiddleware", "SecurityHeadersMiddleware", "HSTS_MAX_AGE_SECONDS"]


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a per-request ``trace_id`` used for error correlation and logging."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request.state.trace_id = uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Trace-Id"] = request.state.trace_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Set standard security headers on every response (adapted from the fork)."""

    def __init__(self, app: ASGIApp, environment: str = "development") -> None:
        super().__init__(app)
        self.environment = environment

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "0"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        if self.environment in ("production", "staging"):
            response.headers["Strict-Transport-Security"] = f"max-age={HSTS_MAX_AGE_SECONDS}; includeSubDomains"

        return response
