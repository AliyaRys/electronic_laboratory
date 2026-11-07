"""VetIS adapter contracts (DATA-06, ADR-018/019).

These are the module-internal DTOs based on the API-04/10 shapes, not SOAP
types. The adapter is disabled until ТЗ-10/ТЗ-11: no SOAP, no network, and a
disabled adapter answers ``503 INTEGRATION_NOT_CONFIGURED`` instead of
fabricating data.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.src.modules.integrations.vetis.models import VetisContour

__all__ = [
    "VetisScope",
    "IncomingPageItem",
    "IncomingPage",
    "ReceiptIntent",
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


class IncomingPageItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evsd_uuid: uuid.UUID
    external_status: str
    payload: dict[str, object]


class IncomingPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[IncomingPageItem]
    cursor: str | None = None


class ReceiptIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    party_id: uuid.UUID
    laboratory_id: uuid.UUID
    reconciliation_revision: int
    decision: Literal["ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"]
    fingerprint: str


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    local_transaction_id: str
    application_id: str | None = None


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
