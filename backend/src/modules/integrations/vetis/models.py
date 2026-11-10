"""Locally mirrored VetIS reference data used without per-view SOAP calls."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = [
    "MercuryProductGuidLvl2",
    "VetisBinding",
    "VetisContour",
    "VetisOperation",
    "VetisOperationKind",
    "VetisOperationState",
    "VetisSourceDocument",
]


class VetisContour(StrEnum):
    """VetIS contours must never share dictionary identities implicitly."""

    PILOT = "PILOT"
    PRODUCTION = "PRODUCTION"


class MercuryProductGuidLvl2(Base):
    """Current second-level Mercury product record for one VetIS contour.

    ``guid`` is the stable product identity received in an incoming VSD;
    ``current_uuid`` identifies the current version of that external record.
    The Russian name is resolved locally for API/UI output. The mandatory
    trichinelloscopy flag is an owner-approved local rule and is never inferred
    from a substring of ``name``.
    """

    __tablename__ = "mercury_product_guid_lvl_2"
    __table_args__ = (
        UniqueConstraint("contour", "current_uuid", name="uq_mercury_product_lvl2_contour_uuid"),
        CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="mercury_product_lvl2_contour_valid"),
        CheckConstraint("product_type BETWEEN 1 AND 8", name="mercury_product_lvl2_type_valid"),
        Index("ix_mercury_product_lvl2_name", "contour", "name"),
    )

    contour: Mapped[str] = mapped_column(String(16), primary_key=True)
    guid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    current_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    english_name: Mapped[str | None] = mapped_column(String(255))
    tnved_codes: Mapped[str] = mapped_column(String(255), nullable=False)
    product_type: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_last: Mapped[bool] = mapped_column(Boolean, nullable=False)
    external_status: Mapped[int] = mapped_column(Integer, nullable=False)
    requires_trichinelloscopy: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    synchronized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )


class VetisOperationKind(StrEnum):
    """The journal kinds of ТЗ-10/ТЗ-11 (DATA-05); the write kinds arrive with W01."""

    SYNC = "SYNC"
    RECEIPT = "RECEIPT"


class VetisOperationState(StrEnum):
    """Durable operation states; the worker and dispatcher restore from SQL."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    NOT_SENT = "NOT_SENT"
    QUEUED = "QUEUED"
    SUBMITTING = "SUBMITTING"
    PROCESSING = "PROCESSING"
    CONFIRMED = "CONFIRMED"
    REJECTED = "REJECTED"
    UNKNOWN = "UNKNOWN"


def _operation_uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )


class VetisBinding(Base):
    """The laboratory's registered VetIS binding (``vetis_bindings``, ТЗ-10).

    The initiator column carries the READ identity NAME only (the secret
    profile lives server-side); ``revoked_at`` stops every further SOAP call
    of the scope, and ``last_success`` is the checkpoint of the last
    SUCCESSFUL FULL page walk — never moved by a partial or failed run.
    """

    __tablename__ = "vetis_bindings"
    __table_args__ = (
        CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_bindings_contour_valid"),
        Index("ix_vetis_bindings_active", "laboratory_id"),
    )

    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT"), primary_key=True
    )
    contour: Mapped[str] = mapped_column(String(16), nullable=False)
    business_member_id: Mapped[str | None] = mapped_column(String(64))
    enterprise_id: Mapped[str | None] = mapped_column(String(64))
    initiator: Mapped[str | None] = mapped_column(String(128))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class VetisOperation(Base):
    """One durable VetIS operation (``vetis_operations``, DATA-05 ТЗ-10).

    The sync intent and its outbox row are written in ONE transaction; after a
    restart the dispatcher restores every ``PENDING``/stale-``RUNNING`` row
    from this journal. ``last_success`` carries the checkpoint of this run.
    """

    __tablename__ = "vetis_operations"
    __table_args__ = (
        CheckConstraint("kind IN ('SYNC','RECEIPT')", name="vetis_operations_kind_valid"),
        CheckConstraint(
            "state IN ('PENDING','RUNNING','SUCCESS','FAILED','NOT_SENT','QUEUED',"
            "'SUBMITTING','PROCESSING','CONFIRMED','REJECTED','UNKNOWN')",
            name="vetis_operations_state_valid",
        ),
        CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_operations_contour_valid"),
        Index("ix_vetis_operations_scope_state", "laboratory_id", "kind", "state"),
    )

    id: Mapped[uuid.UUID] = _operation_uuid_pk()
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT"), nullable=False
    )
    contour: Mapped[str] = mapped_column(String(16), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # The RECEIPT operations (ТЗ-11/W01) reference the party; sync rows leave it NULL.
    party_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("parties.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    last_success: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    problem_code: Mapped[str | None] = mapped_column(String(128))
    problem_detail: Mapped[str | None] = mapped_column(Text)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, server_default=text("gen_random_uuid()::text"))
    pages_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    rev: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default=text("1"))
    source_checksum: Mapped[str | None] = mapped_column(String(64))
    source_revision: Mapped[int | None] = mapped_column(BigInteger)
    reconciliation_revision: Mapped[int | None] = mapped_column(BigInteger)
    local_transaction_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    application_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    fingerprint: Mapped[str | None] = mapped_column(String(64))
    intent: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    evidence: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    diagnostics: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    poll_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))


class VetisSourceDocument(Base):
    """The raw source XML of one external eVSD (``vetis_source_documents``).

    ``revision`` grows with every substantive re-fetch; ``checksum`` is the
    SHA-256 of the stored XML. The normalized source GUIDs/UUIDs/names live in
    the arrivals ``source_snapshot`` — this table is the raw journal.
    """

    __tablename__ = "vetis_source_documents"
    __table_args__ = (
        UniqueConstraint("contour", "evsd_uuid", name="uq_vetis_source_contour_evsd"),
        CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="vetis_source_contour_valid"),
    )

    id: Mapped[uuid.UUID] = _operation_uuid_pk()
    contour: Mapped[str] = mapped_column(String(16), nullable=False)
    evsd_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT"), nullable=False
    )
    raw_xml: Mapped[str] = mapped_column(Text, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1, server_default=text("1"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
