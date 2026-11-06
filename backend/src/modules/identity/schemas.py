"""Identity DTOs for the platform task (API-01/09)."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from backend.src.modules.identity.models import UserRole

__all__ = [
    "LiveResponse",
    "ReadyResponse",
    "CsrfResponse",
    "LoginRequest",
    "LoginResponse",
    "ChangePasswordRequest",
    "ScopeView",
    "UserView",
]


class LiveResponse(BaseModel):
    """Liveness probe — carries no secrets (API-09)."""

    status: str


class ReadyResponse(BaseModel):
    """Readiness probe — database connectivity + schema version (API-09)."""

    status: str
    schema_revision: str


class CsrfResponse(BaseModel):
    csrf_token: str


class LoginRequest(BaseModel):
    login: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirmation: str


class ScopeView(BaseModel):
    laboratory_id: uuid.UUID | None = None
    product_scope_id: uuid.UUID | None = None
    territory_id: uuid.UUID | None = None


class UserView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    login: str
    email: str
    position: str | None
    role: UserRole
    active: bool
    scopes: list[ScopeView]
    capabilities: list[str]
    revision: int


class LoginResponse(BaseModel):
    user: UserView
    contexts: list[ScopeView]
    csrf_token: str
