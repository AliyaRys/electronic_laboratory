"""Identity and technical-operation ORM models (DATA-01, DATA-05).

The migration ``0001_identity`` is the source of truth for DDL; these models
mirror it and are used by the application code.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = [
    "UserRole",
    "CommandStatus",
    "Territory",
    "Laboratory",
    "User",
    "UserScope",
    "DelegationGrant",
    "UserEvent",
    "CasbinRule",
    "CommandRecord",
    "TechnicalEvent",
    "OutboxEntry",
]


class UserRole(StrEnum):
    """The four platform roles (DATA-01)."""

    VET = "VET"
    HEAD = "HEAD"
    ADMIN = "ADMIN"
    ANALYST = "ANALYST"


class CommandStatus(StrEnum):
    """Lifecycle of a command record (DATA-05 / SPEC-04)."""

    IN_PROGRESS = "IN_PROGRESS"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    UNKNOWN = "UNKNOWN"


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


class Territory(Base):
    __tablename__ = "territories"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(255))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("territories.id", ondelete="RESTRICT"), nullable=True
    )


class Laboratory(Base):
    __tablename__ = "laboratories"

    id: Mapped[uuid.UUID] = _uuid_pk()
    territory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("territories.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(Text)
    organization: Mapped[str] = mapped_column(String(255))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))

    __table_args__ = (CheckConstraint("rev >= 1", name="rev_positive"),)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("login", name="uq_users_login"),
        CheckConstraint("rev >= 1", name="rev_positive"),
        CheckConstraint("role IN ('VET','HEAD','ADMIN','ANALYST')", name="role_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    login: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=text("now()")
    )


class UserScope(Base):
    # DATA-01: the three columns form the primary key, so UNIQUE-of-three holds
    # without a separate unique index, and none of them may be NULL (PostgreSQL
    # enforces NOT NULL on PK columns; the migration mirrors that).
    __tablename__ = "user_scopes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT"), primary_key=True
    )
    product_scope_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)


class DelegationGrant(Base):
    __tablename__ = "delegation_grants"

    id: Mapped[uuid.UUID] = _uuid_pk()
    grantor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    role: Mapped[str] = mapped_column(String(20))
    territory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("territories.id", ondelete="RESTRICT")
    )
    may_delegate: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))


class UserEvent(Base):
    __tablename__ = "user_events"

    id: Mapped[uuid.UUID] = _uuid_pk()
    target_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=text("now()")
    )
    action: Mapped[str] = mapped_column(String(64))
    changed_fields: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))


class CasbinRule(Base):
    """Official sqlalchemy-adapter policy row; authorization reads this table."""

    __tablename__ = "casbin_rule"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ptype: Mapped[str | None] = mapped_column(String(255), nullable=True)
    v0: Mapped[str | None] = mapped_column(String(255), nullable=True)
    v1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    v2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    v3: Mapped[str | None] = mapped_column(String(255), nullable=True)
    v4: Mapped[str | None] = mapped_column(String(255), nullable=True)
    v5: Mapped[str | None] = mapped_column(String(255), nullable=True)


class CommandRecord(Base):
    __tablename__ = "command_records"
    __table_args__ = (
        UniqueConstraint("actor_id", "action", "context_id", "key", name="uq_command_scope"),
        CheckConstraint("status IN ('IN_PROGRESS','SUCCESS','FAILED','UNKNOWN')", name="status_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(128))
    context_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    key: Mapped[str] = mapped_column(String(255))
    request_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20))
    result_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    problem_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=text("now()")
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TechnicalEvent(Base):
    __tablename__ = "technical_events"

    id: Mapped[uuid.UUID] = _uuid_pk()
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    object_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(128))
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=text("now()")
    )
    result: Mapped[str] = mapped_column(String(64))
    trace_id: Mapped[str] = mapped_column(String(64))
    revision: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    operation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class OutboxEntry(Base):
    __tablename__ = "outbox"
    __table_args__ = (CheckConstraint("delivered_at IS NULL OR lease_until IS NULL", name="delivered_or_leased"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    operation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)
    event_type: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=text("now()"), index=True
    )
    lease_owner: Mapped[str | None] = mapped_column(String(128), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
