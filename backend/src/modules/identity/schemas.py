"""Identity DTOs for the platform task (API-01/09)."""

from __future__ import annotations

from pydantic import BaseModel

__all__ = ["LiveResponse", "ReadyResponse"]


class LiveResponse(BaseModel):
    """Liveness probe — carries no secrets (API-09)."""

    status: str


class ReadyResponse(BaseModel):
    """Readiness probe — database connectivity + schema version (API-09)."""

    status: str
    schema_revision: str
