"""Arrivals ORM models (DATA-02).

The migration ``0006_arrivals`` is the source of truth for DDL; these models
mirror it. The queue is computed at query time (see ``queries``) — there is no
stored queue state; the presence of a started reconciliation, a receipt
confirmation and (once ТЗ-06 ships) a completed examination is resolved per
request against the actual tables.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = ["IncomingDocument", "Party", "Reconciliation", "ReceiptConfirmation", "HiddenIncoming"]


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )


class IncomingDocument(Base):
    """One external eVSD per ``(contour, evsd_uuid)`` — never a second row.

    ``content_hash`` covers the whole source snapshot except ``fetched_at``:
    a re-import of the same document only refreshes the fetch timestamp, so an
    unchanged hidden document stays invisible (AT-23).
    """

    __tablename__ = "incoming_documents"
    __table_args__ = (
        UniqueConstraint("contour", "evsd_uuid", name="uq_incoming_contour_evsd"),
        CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="incoming_contour_valid"),
        CheckConstraint("rev >= 1", name="incoming_rev_positive"),
        CheckConstraint(
            "source_presence IN ('CURRENT_CONFIRMED','NOT_IN_CURRENT_CONFIRMED_LIST','UNKNOWN')",
            name="incoming_source_presence_valid",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    contour: Mapped[str] = mapped_column(String(16))
    evsd_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT")
    )
    external_status: Mapped[str] = mapped_column(String(64))
    source_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)
    content_hash: Mapped[str] = mapped_column(String(64))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Freshness of the external observation (ТЗ DR9 §4): the read model never
    # asserts UTILIZED without external confirmation — a document missing from
    # the last FULL successful pass becomes NOT_IN_CURRENT_CONFIRMED_LIST and
    # keeps every local fact.
    source_presence: Mapped[str] = mapped_column(String(32), default="UNKNOWN", server_default=text("'UNKNOWN'"))
    source_presence_reason: Mapped[str | None] = mapped_column(String(64))
    last_seen_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The sync at which the document stopped (or started) being observed.
    presence_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_document_uuid: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class Party(Base):
    """The local working aggregate of one incoming eVSD (one per document)."""

    __tablename__ = "parties"
    __table_args__ = (CheckConstraint("rev >= 1", name="party_rev_positive"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    incoming_document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incoming_documents.id", ondelete="RESTRICT"), unique=True
    )
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT")
    )
    classification_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class Reconciliation(Base):
    """A saved (started or completed) CHK reconciliation — A02/A03 fill it."""

    __tablename__ = "reconciliations"
    __table_args__ = (
        CheckConstraint("state IN ('OPEN','CONFIRMED','RETURNED')", name="reconciliation_state_valid"),
        CheckConstraint("rev >= 1", name="reconciliation_rev_positive"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    party_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("parties.id", ondelete="RESTRICT"), unique=True
    )
    checks: Mapped[dict[str, object]] = mapped_column(JSONB)
    delivered_mass_kg: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    delivered_quantity: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    delivered_unit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    accepted_mass_kg: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    accepted_quantity: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    accepted_unit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    returned_mass_kg: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    returned_quantity: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    returned_unit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    transaction_planned: Mapped[bool | None] = mapped_column(nullable=True)
    transaction_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    fair: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    services: Mapped[dict[str, object]] = mapped_column(JSONB)
    # ТЗ DR11 §5/§6: the frozen server-computed PricingSnapshot of the full
    # valid save (context="CHECK"); an incomplete save keeps NULL and a
    # later tariff change never recalculates the stored value (ADR-020).
    pricing_snapshot: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    repeated_required: Mapped[bool | None] = mapped_column(nullable=True)
    repeat_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repeat_act_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    state: Mapped[str] = mapped_column(String(20))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class ReceiptConfirmation(Base):
    """The immutable external receipt fact (written only by confirm_receipt, A03)."""

    __tablename__ = "receipt_confirmations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    party_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("parties.id", ondelete="RESTRICT"), unique=True
    )
    operation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    source_evsd_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    fingerprint: Mapped[str] = mapped_column(String(64))
    evidence: Mapped[dict[str, object]] = mapped_column(JSONB)
    accepted_mass_kg: Mapped[float] = mapped_column(Numeric(20, 6))
    accepted_quantity: Mapped[float] = mapped_column(Numeric(20, 6))
    accepted_unit_id: Mapped[str] = mapped_column(String(64))
    returned_mass_kg: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    returned_quantity: Mapped[float] = mapped_column(Numeric(20, 6), default=0, server_default=text("0"))
    returned_unit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    classification_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)
    # Frozen at confirm time (FT-ARR-12): previous ВСЭ present AND the saved
    # reconciliation chose repeat-not-required. ``downstream_route`` reads this
    # frozen flag, so deleting the reconciliation row never changes the route.
    previous_sufficient: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class HiddenIncoming(Base):
    """The user's hide decision for one document content version (AT-23).

    The row never annuls the eVSD: the document itself stays in
    ``incoming_documents``; a hash change on re-import removes the decision so
    the substantive change reappears.
    """

    __tablename__ = "hidden_incoming"
    __table_args__ = (CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="hidden_contour_valid"),)

    contour: Mapped[str] = mapped_column(String(16), primary_key=True)
    evsd_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    hidden_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
