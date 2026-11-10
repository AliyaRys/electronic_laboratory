"""Parse durable ProcessIncomingConsignment result evidence without SOAP types."""

from __future__ import annotations

import uuid
from decimal import Decimal
from xml.etree import ElementTree as ET

from backend.src.modules.arrivals.ports import ReceiptEvidence
from backend.src.modules.integrations.vetis.contracts import ExternalResult, ReceiptIntent

__all__ = ["parse_receipt_result"]


def _nodes(root: ET.Element, local: str) -> list[ET.Element]:
    return [node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == local]


def _first(root: ET.Element, *names: str) -> str | None:
    for name in names:
        for node in _nodes(root, name):
            if node.text and node.text.strip():
                return node.text.strip()
    return None


def _quantity(root: ET.Element, section: str) -> Decimal | None:
    matches = _nodes(root, section)
    if not matches:
        return None
    value = _first(matches[0], "volume", "quantity")
    return Decimal(value) if value is not None else None


def _child(root: ET.Element, name: str) -> ET.Element | None:
    return next((node for node in root if node.tag.rsplit("}", 1)[-1] == name), None)


def _document_identity(document: ET.Element) -> tuple[str | None, str | None]:
    return _first(document, "uuid"), (_first(document, "vetDStatus") or "").upper() or None


def _real_evidence(
    scope: ET.Element, intent: ReceiptIntent
) -> tuple[str | None, str | None, Decimal | None, Decimal | None, bool, bool]:
    """Extract the actual v2 response: stockEntry + UTILIZED/RETURNABLE docs."""
    source_uuid: str | None = None
    receiver: str | None = None
    returned = Decimal("0")
    return_found = False
    unit_ok = True
    reason_ok = True
    for document in (node for node in scope if node.tag.rsplit("}", 1)[-1] == "vetDocument"):
        document_uuid, status = _document_identity(document)
        document_type = (_first(document, "vetDType") or "").upper()
        if document_uuid == str(intent.source_evsd_uuid) and status == "UTILIZED":
            source_uuid = document_uuid
            certified = _child(document, "certifiedConsignment")
            consignee = _child(certified, "consignee") if certified is not None else None
            enterprise = _child(consignee, "enterprise") if consignee is not None else None
            receiver = _first(enterprise, "guid") if enterprise is not None else None
        if document_type == "RETURNABLE" and status == "CONFIRMED":
            certified = _child(document, "certifiedConsignment")
            value = _quantity(certified, "batch") if certified is not None else None
            if value is not None:
                returned += value
                return_found = True
                batch = _child(certified, "batch") if certified is not None else None
                unit = _child(batch, "unit") if batch is not None else None
                unit_ok = unit_ok and _first(unit, "guid") == intent.unit_id if unit is not None else False
                special_marks = _first(document, "specialMarks") or ""
                reason_ok = reason_ok and f"Причина возврата: {intent.return_reason_code}" in special_marks
    accepted = Decimal("0")
    stock_found = False
    for stock in (node for node in scope if node.tag.rsplit("}", 1)[-1] == "stockEntry"):
        value = _quantity(stock, "batch")
        if value is not None:
            accepted += value
            stock_found = True
            batch = _child(stock, "batch")
            unit = _child(batch, "unit") if batch is not None else None
            unit_ok = unit_ok and _first(unit, "guid") == intent.unit_id if unit is not None else False
    return (
        source_uuid,
        receiver,
        accepted if stock_found else None,
        returned if return_found else None,
        unit_ok,
        reason_ok,
    )


def parse_receipt_result(xml: str, intent: ReceiptIntent, *, application_id: str) -> ExternalResult:
    """Map an async result to state plus complete/incomplete evidence details."""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return ExternalResult(application_id=application_id, state="UNKNOWN", detail={"problem": "MALFORMED_XML"})
    status = (_first(root, "status", "applicationStatus") or "").upper()
    if status in {"ACCEPTED", "IN_PROCESS", "PROCESSING"}:
        return ExternalResult(application_id=application_id, state="PROCESSING")
    if status in {"REJECTED", "ERROR", "FAILED"} or _nodes(root, "fault"):
        return ExternalResult(
            application_id=application_id,
            state="REJECTED",
            detail={"problem": _first(root, "message", "error", "faultstring") or "REJECTED"},
        )

    response = _nodes(root, "processIncomingConsignmentResponse")
    if status not in {"COMPLETED", "CONFIRMED"} and not response:
        return ExternalResult(application_id=application_id, state="PROCESSING")
    scope = response[0] if response else root
    source_uuid, receiver, accepted, returned, unit_ok, reason_ok = _real_evidence(scope, intent)
    # Compact sanitized simulator fixtures use explicit link fields; the real
    # Mercury response above is preferred whenever it is present.
    source_uuid = source_uuid or _first(scope, "sourceVetDocumentUuid", "vetDocumentUuid")
    receiver = receiver or _first(scope, "receiverEnterpriseGuid", "enterpriseGuid")
    accepted = accepted if accepted is not None else _quantity(scope, "acceptedConsignment")
    returned = returned if returned is not None else _quantity(scope, "returnedDelivery")
    decision = intent.decision
    if decision == "RETURN_ALL" and accepted is None:
        accepted = Decimal("0")
    if decision == "ACCEPT_ALL" and returned is None:
        returned = Decimal("0")
    complete = (
        source_uuid == str(intent.source_evsd_uuid)
        and receiver == intent.receiver_enterprise_id
        and accepted == intent.accepted_quantity
        and returned == intent.returned_quantity
        and unit_ok
        and reason_ok
    )
    if not complete:
        return ExternalResult(
            application_id=application_id,
            state="UNKNOWN",
            detail={
                "problem": "INTEGRATION_EVIDENCE_INCOMPLETE",
                "links": {
                    "source": bool(source_uuid == str(intent.source_evsd_uuid)),
                    "receiver": bool(receiver == intent.receiver_enterprise_id),
                    "accepted": bool(accepted == intent.accepted_quantity),
                    "returned": bool(returned == intent.returned_quantity),
                    "unit": unit_ok,
                    "return_reason": reason_ok,
                },
            },
        )
    evidence = ReceiptEvidence(
        contour=intent.contour,
        evsd_uuid=uuid.UUID(source_uuid),
        receiver_enterprise_id=receiver or "",
        business_member_id=intent.business_member_id,
        decision=decision,
        external_status="CONFIRMED",
        documentary_mass_kg=intent.documentary_quantity,
        documentary_quantity=intent.documentary_quantity,
        delivered_mass_kg=intent.delivered_quantity,
        delivered_quantity=intent.delivered_quantity,
        accepted_mass_kg=intent.accepted_quantity,
        accepted_quantity=intent.accepted_quantity,
        returned_mass_kg=intent.returned_quantity,
        returned_quantity=intent.returned_quantity,
        unit_id=intent.unit_id,
        operation_id=str(intent.operation_id),
        application_id=application_id,
        composition={
            "sourceRevision": intent.source_revision,
            "reconciliationRevision": intent.reconciliation_revision,
        },
    )
    return ExternalResult(
        application_id=application_id,
        state="CONFIRMED",
        detail={"evidence": evidence.model_dump(mode="json")},
    )
