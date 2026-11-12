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


def _mass_of(section: ET.Element) -> Decimal | None:
    value = _first(section, "volume")
    return Decimal(value) if value is not None else None


def _places_of(section: ET.Element) -> Decimal | None:
    """ТЗ DR8 §11: the places count from the batch/package entries.

    Only the maximal numeric ``dt:level`` packages are summed (never mixed
    with the mass and never taken from ``volume``).
    """
    direct = _first(section, "quantity")
    if direct is not None:
        return Decimal(direct)
    batches = _nodes(section, "batch")
    if not batches:
        return None
    batch = batches[0]
    packages = [
        package
        for package_list in _nodes(batch, "packageList")
        for package in package_list
        if package.tag.rsplit("}", 1)[-1] == "package"
    ]
    levels: list[tuple[int, ET.Element]] = []
    for package in packages:
        level = _first(package, "level")
        if level is not None and level.isdigit():
            levels.append((int(level), package))
    if levels:
        top = max(level for level, _ in levels)
        packages = [package for level, package in levels if level == top]
    values = [_first(package, "quantity") for package in packages]
    if not values or any(value is None for value in values):
        return None
    total = Decimal("0")
    for value in values:
        total += Decimal(value or "0")
    return total


def _child(root: ET.Element, name: str) -> ET.Element | None:
    return next((node for node in root if node.tag.rsplit("}", 1)[-1] == name), None)


def _document_identity(document: ET.Element) -> tuple[str | None, str | None]:
    return _first(document, "uuid"), (_first(document, "vetDStatus") or "").upper() or None


def _real_evidence(
    scope: ET.Element, intent: ReceiptIntent
) -> tuple[str | None, str | None, Decimal | None, Decimal | None, Decimal | None, Decimal | None, bool, bool, bool]:
    """Extract the actual v2 response: stockEntry + UTILIZED/RETURNABLE docs.

    ТЗ DR8 §11: the mass and the places count are checked SEPARATELY, next to
    the unit and the return-reason marks.
    """
    source_uuid: str | None = None
    receiver: str | None = None
    returned_mass = Decimal("0")
    returned_quantity = Decimal("0")
    return_found = False
    unit_ok = True
    quantity_ok = True
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
            batch = _child(certified, "batch") if certified is not None else None
            if batch is not None:
                mass = _mass_of(batch)
                places = _places_of(batch)
                if mass is not None:
                    returned_mass += mass
                    return_found = True
                if places is not None:
                    returned_quantity += places
                unit = _child(batch, "unit")
                unit_ok = unit_ok and _first(unit, "guid") == intent.unit_id if unit is not None else False
                if returned_mass == intent.returned_mass_kg and intent.returned_quantity > 0:
                    quantity_ok = quantity_ok and places == intent.returned_quantity
            special_marks = [(node.text or "").strip() for node in _nodes(document, "specialMarks")]
            # ТЗ DR8 §6.2: the exact CODE is one of the marks; the Russian
            # label is never accepted as proof of the reason.
            if intent.return_reason_code == "OTHER_REASON":
                reason_ok = reason_ok and (
                    intent.return_reason_code in special_marks
                    and f"OTHER_REASON: {(intent.return_reason_text or '').strip()}" in special_marks
                )
            else:
                reason_ok = reason_ok and (intent.return_reason_code or "") in special_marks
    accepted_mass = Decimal("0")
    accepted_quantity = Decimal("0")
    stock_found = False
    for stock in (node for node in scope if node.tag.rsplit("}", 1)[-1] == "stockEntry"):
        batch = _child(stock, "batch")
        if batch is None:
            continue
        mass = _mass_of(batch)
        places = _places_of(batch)
        if mass is not None:
            accepted_mass += mass
            stock_found = True
        if places is not None:
            accepted_quantity += places
        unit = _child(batch, "unit")
        unit_ok = unit_ok and _first(unit, "guid") == intent.unit_id if unit is not None else False
        if accepted_mass == intent.accepted_mass_kg and intent.accepted_quantity > 0:
            quantity_ok = quantity_ok and places == intent.accepted_quantity
    return (
        source_uuid,
        receiver,
        accepted_mass if stock_found else None,
        accepted_quantity if stock_found and accepted_quantity > 0 else None,
        returned_mass if return_found else None,
        returned_quantity if return_found and returned_quantity > 0 else None,
        unit_ok,
        quantity_ok,
        reason_ok,
    )


def _first_mass(root: ET.Element, local: str) -> Decimal | None:
    matches = _nodes(root, local)
    if not matches:
        return None
    value = _first(matches[0], "volume")
    return Decimal(value) if value is not None else None


def _first_places(root: ET.Element, local: str) -> Decimal | None:
    matches = _nodes(root, local)
    if not matches:
        return None
    return _places_of(matches[0])


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
    (
        source_uuid,
        receiver,
        accepted_mass,
        accepted_quantity,
        returned_mass,
        returned_quantity,
        unit_ok,
        quantity_ok,
        reason_ok,
    ) = _real_evidence(scope, intent)
    # Compact sanitized simulator fixtures use explicit link fields; the real
    # Mercury response above is preferred whenever it is present.
    source_uuid = source_uuid or _first(scope, "sourceVetDocumentUuid", "vetDocumentUuid")
    receiver = receiver or _first(scope, "receiverEnterpriseGuid", "enterpriseGuid")
    if accepted_mass is None:
        accepted_mass = _first_mass(scope, "acceptedConsignment")
    if returned_mass is None:
        returned_mass = _first_mass(scope, "returnedDelivery")
    if accepted_quantity is None:
        accepted_quantity = _first_places(scope, "acceptedConsignment")
    if returned_quantity is None:
        returned_quantity = _first_places(scope, "returnedDelivery")
    decision = intent.decision
    if decision == "RETURN_ALL" and accepted_mass is None:
        accepted_mass = Decimal("0")
    if decision == "ACCEPT_ALL" and returned_mass is None:
        returned_mass = Decimal("0")
    # An absent part of the split is zero on BOTH dimensions at once.
    if accepted_mass == 0 and intent.accepted_quantity == 0 and accepted_quantity is None:
        accepted_quantity = Decimal("0")
    if returned_mass == 0 and intent.returned_quantity == 0 and returned_quantity is None:
        returned_quantity = Decimal("0")
    complete = (
        source_uuid == str(intent.source_evsd_uuid)
        and receiver == intent.receiver_enterprise_id
        and accepted_mass == intent.accepted_mass_kg
        and accepted_quantity == intent.accepted_quantity
        and returned_mass == intent.returned_mass_kg
        and returned_quantity == intent.returned_quantity
        and unit_ok
        and quantity_ok
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
                    "accepted_mass": bool(accepted_mass == intent.accepted_mass_kg),
                    "accepted_quantity": bool(accepted_quantity == intent.accepted_quantity),
                    "returned_mass": bool(returned_mass == intent.returned_mass_kg),
                    "returned_quantity": bool(returned_quantity == intent.returned_quantity),
                    "unit": unit_ok,
                    "quantity": quantity_ok,
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
        documentary_mass_kg=intent.documentary_mass_kg,
        documentary_quantity=intent.documentary_quantity,
        delivered_mass_kg=intent.delivered_mass_kg,
        delivered_quantity=intent.delivered_quantity,
        accepted_mass_kg=intent.accepted_mass_kg,
        accepted_quantity=intent.accepted_quantity,
        returned_mass_kg=intent.returned_mass_kg,
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
