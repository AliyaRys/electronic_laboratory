"""VetIS adapter contracts (DATA-06, ADR-018/019).

These are the module-internal DTOs based on the API-04/10 shapes, not SOAP
types. The adapter is disabled until ТЗ-10/ТЗ-11: no SOAP, no network, and a
disabled adapter answers ``503 INTEGRATION_NOT_CONFIGURED`` instead of
fabricating data.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.src.modules.arrivals.schemas import IncomingDocument
from backend.src.modules.integrations.vetis.models import VetisContour

__all__ = [
    "VetisScope",
    "IncomingPage",
    "ReceiptIntent",
    "ReceiptPreview",
    "UserConfirmation",
    "Submission",
    "ExternalResult",
    "ReconciliationEvidence",
]


class VetisScope(BaseModel):
    """The laboratory's registered VetIS binding (``vetis_bindings``, ТЗ-10)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    laboratory_id: uuid.UUID
    contour: VetisContour
    business_member_id: str | None = None
    enterprise_id: str | None = None
    initiator: str | None = None


IncomingDocumentDTO = IncomingDocument


class IncomingPage(BaseModel):
    """One read page (DATA-06): arrivals DTOs + honest pagination + filter counters."""

    model_config = ConfigDict(extra="forbid")

    items: list[IncomingDocumentDTO]
    next_cursor: str | None = None
    complete: bool
    # обезличенные счётчики локальных фильтров предиката (receiver/transport/
    # status/product_type); never external credentials or operational UUIDs.
    filtered: dict[str, int] = Field(default_factory=dict)
    # The raw source XML per external UUID (ТЗ-10 V02 journal); keys are the
    # eVSD UUID strings of ``items``. XML never leaves the vetis package.
    raw_documents: dict[str, str] = Field(default_factory=dict)


class ReceiptIntent(BaseModel):
    """Frozen, server-built input of one irreversible receipt application."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    operation_id: uuid.UUID
    party_id: uuid.UUID
    laboratory_id: uuid.UUID
    contour: VetisContour
    source_evsd_uuid: uuid.UUID
    source_checksum: str
    source_revision: int
    receiver_enterprise_id: str
    business_member_id: str
    initiator: str
    delivery_date: datetime
    reconciliation_revision: int
    decision: Literal["ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"]
    doc_inspection: Literal["CORRESPONDS", "MISMATCH"]
    vet_inspection: Literal["CORRESPONDS", "MISMATCH", "UNSUPERVISED"]
    # ТЗ DR8 §5.2: the two dimensions travel SEPARATELY end-to-end. Mass
    # (``vd:volume``) is never substituted by the places count and vice versa.
    documentary_mass_kg: Decimal
    # The documentary places count stays ABSENT when the source carries none;
    # it is never replaced by the mass (ТЗ DR8 §13).
    documentary_quantity: Decimal | None
    delivered_mass_kg: Decimal
    delivered_quantity: Decimal
    accepted_mass_kg: Decimal
    accepted_quantity: Decimal
    returned_mass_kg: Decimal
    returned_quantity: Decimal
    unit_id: str
    # ТЗ DR8 §9: three distinct dates. ``issue_date`` is the server time of the
    # request formation, ``delivery_date`` the entered arrival date and
    # ``return_date`` the entered return date of the returned delivery.
    issue_date: datetime
    delivery_date: datetime
    return_date: datetime | None = None
    discrepancy_items: list[dict[str, object]] = Field(default_factory=list)
    return_reason_code: str | None = None
    return_reason_text: str | None = None
    act_number: str | None = None
    local_transaction_id: str
    fingerprint: str


class ReceiptPreview(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    intent: ReceiptIntent
    application_xml: str
    fingerprint: str


class UserConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    actor_id: uuid.UUID
    fingerprint: str
    confirmed_at: datetime


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    local_transaction_id: str
    application_id: str | None = None
    transport_state: Literal["SUBMITTING", "PROCESSING", "UNKNOWN"]


class ExternalResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_id: str | None
    state: Literal["NOT_SENT", "QUEUED", "SUBMITTING", "PROCESSING", "CONFIRMED", "REJECTED", "UNKNOWN"]
    detail: dict[str, object] | None = None


class ReconciliationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_evsd_uuid: uuid.UUID
    receiver_enterprise_id: str | None = None
    related_return_documents: list[dict[str, object]] = Field(default_factory=list)
    evidence: dict[str, object]
