"""Identity router: the service endpoints of API-01/09.

Only ``/health/live`` and ``/health/ready`` exist here; there is deliberately no
public signup route (bootstrap is a closed CLI). User administration arrives in
Task I03.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.database import async_session
from backend.src.core.problems import dependency_unavailable
from backend.src.modules.identity.schemas import LiveResponse, ReadyResponse

# The Alembic head revision this build expects. Guarded by a test so it cannot
# drift from the migration file.
CURRENT_SCHEMA_REVISION = "0001_identity"

__all__ = ["router", "CURRENT_SCHEMA_REVISION"]

router = APIRouter(tags=["System"])


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
