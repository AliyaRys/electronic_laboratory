"""Problem Details error contract (API-01, ADR-006) and its exception machinery.

Every error the backend returns is an RFC 9457 Problem Details document with
``Content-Type: application/problem+json`` carrying the stable ``code`` and a
``trace_id`` for correlation, plus a field-level ``errors`` list for validation.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_CONTENT_TYPE = "application/problem+json"
PROBLEM_TYPE = "about:blank"

__all__ = [
    "Problem",
    "ProblemItem",
    "ProblemError",
    "register_exception_handlers",
    "new_trace_id",
    "not_found",
    "revision_required",
    "revision_conflict",
    "idempotency_key_required",
    "idempotency_mismatch",
    "dependency_unavailable",
    "validation_error",
]


def new_trace_id() -> str:
    """A fresh correlation identifier for one request/error."""
    return uuid.uuid4().hex


class ProblemItem(BaseModel):
    """A single field-level error within a Problem ``errors`` list."""

    path: str
    field_id: str | None = None
    message: str


class Problem(BaseModel):
    """RFC 9457 Problem Details extended with ``code`` and ``trace_id`` (API-01)."""

    type: str
    title: str
    status: int
    detail: str
    instance: str | None = None
    code: str
    trace_id: str
    errors: list[ProblemItem] = Field(default_factory=list)


class ProblemError(Exception):
    """An application error that maps directly to a Problem response."""

    def __init__(
        self,
        *,
        status: int,
        code: str,
        title: str,
        detail: str,
        errors: list[ProblemItem] | None = None,
        headers: Mapping[str, str] | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.errors: list[ProblemItem] = errors or []
        self.headers: dict[str, str] = dict(headers or {})
        self.trace_id = trace_id or new_trace_id()

    def as_problem(self, instance: str | None = None) -> Problem:
        return Problem(
            type=PROBLEM_TYPE,
            title=self.title,
            status=self.status,
            detail=self.detail,
            instance=instance,
            code=self.code,
            trace_id=self.trace_id,
            errors=self.errors,
        )


# --- concrete problem factories -------------------------------------------------


def not_found(detail: str = "Ресурс не найден.") -> ProblemError:
    return ProblemError(status=404, code="NOT_FOUND", title="Not Found", detail=detail)


def revision_required(
    detail: str = "Для изменения требуется заголовок If-Match с актуальной ревизией.",
) -> ProblemError:
    """422 REVISION_REQUIRED — the If-Match is missing or unusable (API-01).

    ``detail`` lets callers explain which of the two happened; the stable code,
    status and title never change.
    """
    return ProblemError(
        status=422,
        code="REVISION_REQUIRED",
        title="If-Match required",
        detail=detail,
    )


def revision_conflict() -> ProblemError:
    return ProblemError(
        status=409,
        code="REVISION_CONFLICT",
        title="Revision conflict",
        detail="Запись была изменена другим пользователем. Обновите данные и повторите.",
    )


def idempotency_key_required() -> ProblemError:
    return ProblemError(
        status=422,
        code="IDEMPOTENCY_KEY_REQUIRED",
        title="Idempotency-Key required",
        detail="Для этой операции требуется заголовок Idempotency-Key.",
    )


def idempotency_mismatch() -> ProblemError:
    return ProblemError(
        status=409,
        code="IDEMPOTENCY_MISMATCH",
        title="Idempotency mismatch",
        detail="Ключ идемпотентности уже использован с другим запросом.",
    )


def dependency_unavailable(detail: str) -> ProblemError:
    return ProblemError(status=503, code="DEPENDENCY_UNAVAILABLE", title="Dependency unavailable", detail=detail)


def validation_error(items: list[ProblemItem]) -> ProblemError:
    return ProblemError(
        status=422,
        code="VALIDATION_ERROR",
        title="Validation error",
        detail="Запрос не прошёл проверку.",
        errors=items,
    )


def _request_trace_id(request: Request) -> str:
    trace_id = getattr(request.state, "trace_id", None)
    return trace_id if isinstance(trace_id, str) and trace_id else new_trace_id()


def _validation_items(exc: RequestValidationError) -> list[ProblemItem]:
    items: list[ProblemItem] = []
    for err in exc.errors():
        loc = err.get("loc", ())
        path = ".".join(str(part) for part in loc if part != "body")
        items.append(ProblemItem(path=path or "body", message=str(err.get("msg", ""))))
    return items


def register_exception_handlers(app: FastAPI) -> None:
    """Register global handlers that translate errors into Problem documents."""

    @app.exception_handler(ProblemError)
    async def problem_handler(request: Request, exc: ProblemError) -> JSONResponse:
        problem = exc.as_problem(instance=str(request.url.path))
        problem.trace_id = _request_trace_id(request)
        return JSONResponse(
            status_code=exc.status,
            content=problem.model_dump(mode="json"),
            headers={"Content-Type": PROBLEM_CONTENT_TYPE, **exc.headers},
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        problem = validation_error(_validation_items(exc)).as_problem(instance=str(request.url.path))
        problem.trace_id = _request_trace_id(request)
        return JSONResponse(
            status_code=422,
            content=problem.model_dump(mode="json"),
            headers={"Content-Type": PROBLEM_CONTENT_TYPE},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Non-Problem HTTP exceptions (e.g. a 404 from unmatched routes) keep the
        # same status but gain the Problem shape so callers always see code+trace_id.
        problem = Problem(
            type=PROBLEM_TYPE,
            title="HTTP error",
            status=exc.status_code,
            detail=str(exc.detail),
            instance=str(request.url.path),
            code="NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR",
            trace_id=_request_trace_id(request),
            errors=[],
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=problem.model_dump(mode="json"),
            headers={"Content-Type": PROBLEM_CONTENT_TYPE, **(exc.headers or {})},
        )
