"""ТЗ DR8 tests: source unit GUID propagation (CHK-F20 root cause)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from backend.src.modules.arrivals.models import IncomingDocument as IncomingDocumentRow
from backend.src.modules.arrivals.queries import _quantity_set
from backend.src.modules.arrivals.reconciliation import build_reconciliation_view, source_projection
from backend.src.modules.arrivals.schemas import QuantitySet, ReconciliationWrite
from backend.src.modules.arrivals.validation import ReceiptCapabilities, validate_receipt
from backend.src.modules.integrations.vetis.models import VetisContour

UNIT_GUID = str(uuid.uuid4())

SNAPSHOT = {
    "vdDocument": {
        "type": "TRANSPORT",
        "status": "CONFIRMED",
        "issueNumber": "DR8-1",
        "issueDate": "2026-11-10",
        "consignor": {"name": "Поставщик"},
        "consignee": {"name": "Получатель", "enterprise": {"guid": str(uuid.uuid4())}},
        "batch": {
            "product": {"guid": str(uuid.uuid4()), "name": "Мясо"},
            "volume": "120",
            "quantity": "4",
            "unit": {"guid": UNIT_GUID, "name": "кг"},
        },
        "purpose": {"guid": str(uuid.uuid4())},
    },
    "vetDocuments": [],
}


def document_row() -> IncomingDocumentRow:
    return IncomingDocumentRow(
        contour=VetisContour.PILOT,
        evsd_uuid=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        external_status="CONFIRMED",
        source_snapshot=SNAPSHOT,
        content_hash="d" * 64,
        fetched_at=datetime.now(UTC),
    )


def test_documentary_quantity_set_carries_source_unit_guid() -> None:
    """ТЗ DR8 §11-2: documentary.unit_id == batch.unit.guid, never blank/«кг»."""
    batch = SNAPSHOT["vdDocument"]["batch"]
    quantities = _quantity_set(batch)  # type: ignore[arg-type]
    assert quantities.unit_id == UNIT_GUID
    assert quantities.unit_id not in ("", "кг")


def party() -> object:
    from backend.src.modules.arrivals.models import Party

    return Party(
        incoming_document_id=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        classification_snapshot={
            "product": {"id": str(uuid.uuid4()), "name": "Мясо"},
        },
        rev=1,
        created_at=datetime.now(UTC),
    )


def test_new_reconciliation_view_inherits_unit_in_all_three_quantity_sets() -> None:
    """ТЗ DR8 §11-1: a NEW reconciliation fills delivered/accepted/returned."""
    view = build_reconciliation_view(None, party(), document_row())  # type: ignore[arg-type]
    assert view.delivered.unit_id == UNIT_GUID
    assert view.accepted.unit_id == UNIT_GUID
    assert view.returned.unit_id == UNIT_GUID


def test_source_projection_publishes_unit_guid_and_name_separately() -> None:
    """ТЗ DR8 §11-3: unitId is the GUID; the name is a separate UI field."""
    projection = source_projection(document_row(), party())  # type: ignore[arg-type]
    assert projection.fields["unitId"] == UNIT_GUID
    assert projection.fields["unitName"] == "кг"


def _payload(**overrides: object) -> ReconciliationWrite:
    base: dict[str, object] = {
        "checks": {},
        "inspection": {"compartment": "COMPLIANT", "jointCarriage": "NONE"},
        "delivered": QuantitySet(mass_kg="120", quantity="4", unit_id=UNIT_GUID),
        "accepted": QuantitySet(mass_kg="120", quantity="4", unit_id=UNIT_GUID),
        "returned": QuantitySet(mass_kg="0", quantity="0", unit_id=UNIT_GUID),
        "decision": "ACCEPT_ALL",
        "transaction": {"planned": False},
        "services": [],
    }
    base.update(overrides)
    return ReconciliationWrite.model_validate(base)  # type: ignore[arg-type]


def _source(**overrides: str | None) -> object:
    from backend.src.modules.arrivals.schemas import (
        ClassificationEntry,
        ClassificationView,
    )

    fields = {
        "documentNumber": "DR8-1",
        "issuedOn": "2026-11-10",
        "status": "CONFIRMED",
        "quantity": "4",
        "massKg": "120",
        "unitId": UNIT_GUID,
        "unitName": "кг",
        **overrides,
    }
    from backend.src.modules.arrivals.validation import IncomingDocument as SourceDocument

    return SourceDocument(
        snapshot=None,  # type: ignore[arg-type]
        classification=ClassificationView(
            product=ClassificationEntry(id="x", name="Мясо"),
            unit=ClassificationEntry(id=UNIT_GUID, name="кг"),
            productType=1,
        ),
        fields=fields,  # type: ignore[arg-type]
    )


def test_positive_quantities_without_unit_are_blocked() -> None:
    """ТЗ DR8 §11-4: positive quantities with an empty unit are CHK-F20 blocked."""
    payload = _payload(
        delivered=QuantitySet(mass_kg="120", quantity="4", unit_id=""),
        accepted=QuantitySet(mass_kg="120", quantity="4", unit_id=""),
        returned=QuantitySet(mass_kg="0", quantity="0", unit_id=""),
    )
    result = validate_receipt(payload, _source(), ReceiptCapabilities())  # type: ignore[arg-type]
    assert any(item.field_id == "CHK-F20" for item in result.blocking)
    assert any("единицу" in item.message for item in result.blocking)
