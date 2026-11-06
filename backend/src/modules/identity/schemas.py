"""Identity DTOs for the platform task (API-01/02/09)."""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.src.modules.identity.models import UserRole

__all__ = [
    "LiveResponse",
    "ReadyResponse",
    "CsrfResponse",
    "LoginRequest",
    "LoginResponse",
    "ChangePasswordRequest",
    "ResetPasswordRequest",
    "ScopeInput",
    "UserWrite",
    "ScopeView",
    "UserView",
    "UserEventView",
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


class ResetPasswordRequest(BaseModel):
    """Administrator reset (API-02): only the new password and its confirmation."""

    new_password: str
    confirmation: str


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ScopeInput(BaseModel):
    """One laboratory assignment; a missing product means the whole laboratory."""

    model_config = ConfigDict(extra="forbid")

    laboratory_id: uuid.UUID
    product_scope_id: uuid.UUID | None = None


class UserWrite(BaseModel):
    """API-02 create/update payload; legacy permission flags are rejected."""

    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=255)
    login: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    position: str | None = Field(default=None, max_length=255)
    role: UserRole
    scopes: list[ScopeInput] = Field(default_factory=list)
    password: str | None = None
    confirmation: str | None = None

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        if not _EMAIL_RE.fullmatch(value.strip()):
            raise ValueError("Некорректный email.")
        return value


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


class UserEventView(BaseModel):
    """A history record (API-02): no secrets, real changed fields only."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    target_user_id: uuid.UUID
    actor_id: uuid.UUID
    at: datetime
    action: str
    changed_fields: dict[str, object]


class LoginResponse(BaseModel):
    user: UserView
    contexts: list[ScopeView]
    csrf_token: str
