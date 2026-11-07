"""TEST-ONLY fixture evidence for the ``ReceiptEvidenceReader`` port (DATA-06).

Real verified evidence enters the system only through the composition root:
the VetIS adapter ships with ТЗ-11 and stays disabled until then. This module
is the *test* composition root — it plants explicit ``ReceiptEvidence`` facts
and replays the ``reader.read → confirm_receipt`` seam exactly as ТЗ-11 will.

It must never be imported by anything under ``backend/src``: there is no
runtime or demo switch, and no HTTP route can produce a confirmation.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.confirmation import confirm_receipt
from backend.src.modules.arrivals.models import ReceiptConfirmation
from backend.src.modules.arrivals.ports import ReceiptEvidence
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.tests.arrivals.test_import_and_queues import (
    _CONSIGNEE_ENTERPRISE as RECEIVER_ENTERPRISE,  # the fixture document's receiver
)
from backend.tests.arrivals.test_import_and_queues import (
    _CONSIGNOR_ENTITY as BUSINESS_MEMBER,
)
from backend.tests.arrivals.test_import_and_queues import (
    UNIT_KG as UNIT,
)

__all__ = [
    "FixtureReceiptEvidenceReader",
    "BUSINESS_MEMBER",
    "RECEIVER_ENTERPRISE",
    "UNIT",
    "confirm_via_reader",
    "receipt_evidence",
]


def receipt_evidence(
    evsd_uuid: uuid.UUID,
    decision: str = "ACCEPT_ALL",
    *,
    external_status: str = "CONFIRMED",
    operation_id: uuid.UUID | None = None,
    **overrides: object,
) -> ReceiptEvidence:
    """A realistic confirmed receipt fact for the default beef fixture (120 кг / 4 шт)."""
    delivered_mass, delivered_quantity = Decimal("120.0"), Decimal("4")
    if decision == "RETURN_ALL":
        accepted_mass, accepted_quantity = Decimal("0"), Decimal("0")
        returned_mass, returned_quantity = delivered_mass, delivered_quantity
    elif decision == "PARTIALLY":
        accepted_mass, accepted_quantity = Decimal("100.0"), Decimal("3")
        returned_mass, returned_quantity = Decimal("20.0"), Decimal("1")
    else:
        accepted_mass, accepted_quantity = delivered_mass, delivered_quantity
        returned_mass, returned_quantity = Decimal("0"), Decimal("0")
    values: dict[str, object] = {
        "contour": VetisContour.PILOT,
        "evsd_uuid": evsd_uuid,
        "receiver_enterprise_id": str(RECEIVER_ENTERPRISE),
        "business_member_id": str(BUSINESS_MEMBER),
        "decision": decision,
        "external_status": external_status,
        "documentary_mass_kg": delivered_mass,
        "documentary_quantity": delivered_quantity,
        "delivered_mass_kg": delivered_mass,
        "delivered_quantity": delivered_quantity,
        "accepted_mass_kg": accepted_mass,
        "accepted_quantity": accepted_quantity,
        "returned_mass_kg": returned_mass,
        "returned_quantity": returned_quantity,
        "unit_id": str(UNIT),
        "operation_id": str(operation_id or uuid.uuid4()),
        "application_id": str(uuid.uuid4()),
        "composition": {"result": "неизменяемый состав внешнего результата"},
    }
    values.update(overrides)
    return ReceiptEvidence.model_validate(values)


class FixtureReceiptEvidenceReader:
    """The test reader of the port: evidence is planted per party, nothing more."""

    def __init__(self) -> None:
        self._planted: dict[uuid.UUID, ReceiptEvidence | None] = {}

    def plant(self, party_id: uuid.UUID, evidence: ReceiptEvidence | None) -> None:
        """Plant (or remove, with ``None``) the evidence of one party."""
        self._planted[party_id] = evidence

    async def read(self, party_id: uuid.UUID) -> ReceiptEvidence | None:
        """The port signature; ``None`` models an absent/UNKNOWN external result."""
        return self._planted.get(party_id)


async def party_evsd_uuid(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID:
    """The external eVSD UUID behind one party (fixture lookup)."""
    from backend.src.modules.arrivals.models import IncomingDocument, Party

    return (
        await db.execute(
            select(IncomingDocument.evsd_uuid)
            .join(Party, Party.incoming_document_id == IncomingDocument.id)
            .where(Party.id == party_id)
        )
    ).scalar_one()


async def confirm_via_reader(
    uow: AsyncSession,
    reader: FixtureReceiptEvidenceReader,
    party_id: uuid.UUID,
) -> ReceiptConfirmation | None:
    """The composition-root seam under test: ``reader.read`` → ``confirm_receipt``.

    ``confirm_receipt`` never reads evidence from an HTTP body — only a port
    reader the composition root wired (ТЗ-11) can put a fact into the system.
    """
    return await confirm_receipt(uow, await reader.read(party_id))
