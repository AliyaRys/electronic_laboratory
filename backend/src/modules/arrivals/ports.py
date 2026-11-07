"""Arrivals read-only port for external receipt evidence (DATA-06).

``ReceiptEvidenceReader.read(party_id) -> ReceiptEvidence | None`` is the only
sanctioned source of an external receipt fact. ``None``/UNKNOWN never grants
the right to create an examination. There is deliberately no implementation
wired into the application yet: the disabled adapter belongs to the VetIS
module (ADR-018) and the real evidence arrives with ТЗ-11. Tests inject fake
readers through the test composition root only.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict

from backend.src.modules.integrations.vetis.models import VetisContour

__all__ = ["ReceiptEvidence", "ReceiptEvidenceReader", "ReceiptDecision", "CONFIRMED_EVIDENCE_STATUSES"]

ReceiptDecision = Literal["ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"]

# External statuses that prove the receipt happened (FT-ARR-14): an UNKNOWN,
# UTILIZED (annulled) or absent status never grants a confirmation.
CONFIRMED_EVIDENCE_STATUSES = frozenset({"CONFIRMED", "COMPLETED"})


class ReceiptEvidence(BaseModel):
    """The external receipt fact (DATA-06); ``verified`` cannot come from HTTP."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    contour: VetisContour
    evsd_uuid: uuid.UUID
    receiver_enterprise_id: str
    business_member_id: str
    decision: ReceiptDecision
    # The verified external status of the receipt result (e.g. CONFIRMED);
    # UNKNOWN/UTILIZED never confirm a receipt (FT-ARR-14). Set by the VetIS
    # adapter, never by a client.
    external_status: str | None = None
    documentary_mass_kg: Decimal | None = None
    documentary_quantity: Decimal | None = None
    delivered_mass_kg: Decimal | None = None
    delivered_quantity: Decimal | None = None
    accepted_mass_kg: Decimal | None = None
    accepted_quantity: Decimal | None = None
    returned_mass_kg: Decimal | None = None
    returned_quantity: Decimal | None = None
    unit_id: str | None = None
    operation_id: str | None = None
    application_id: str | None = None
    composition: dict[str, object] | None = None


class ReceiptEvidenceReader(Protocol):
    """A read-only port; absence/UNKNOWN must never create a receipt fact."""

    async def read(self, party_id: uuid.UUID) -> ReceiptEvidence | None:
        """Return the verified evidence or ``None`` when absent/UNKNOWN."""
        ...
