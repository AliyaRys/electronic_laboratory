"""W01 offline assertions: six receipt branches, no Mercury connection."""

from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from xml.etree import ElementTree as ET

import pytest

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.contracts import ReceiptIntent
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.receipt_mapping import build_process_incoming_application
from backend.src.modules.integrations.vetis.transport import ZeepApplicationTransport

SOURCE_EVSD = uuid.UUID("00000000-0000-0000-0000-000000000101")
SOURCE_RECEIVER = "00000000-0000-0000-0000-000000000102"
SOURCE_UNIT = "00000000-0000-0000-0000-000000000103"

SOURCE_XML = """<vd:vetDocument
 xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
 xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
 xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
 <bs:uuid>00000000-0000-0000-0000-000000000101</bs:uuid>
 <vd:authentication><vd:purpose><bs:guid>purpose-guid</bs:guid></vd:purpose></vd:authentication>
 <vd:certifiedConsignment>
  <vd:consignor><dt:enterprise><bs:guid>sender</bs:guid></dt:enterprise></vd:consignor>
  <vd:consignee><dt:enterprise><bs:guid>00000000-0000-0000-0000-000000000102</bs:guid></dt:enterprise></vd:consignee>
  <vd:batch><vd:volume>120</vd:volume><vd:unit><bs:guid>00000000-0000-0000-0000-000000000103</bs:guid></vd:unit></vd:batch>
  <vd:transportInfo><vd:transportType>1</vd:transportType></vd:transportInfo>
  <vd:transportStorageType>FROZEN</vd:transportStorageType>
  <vd:accompanyingForms><vd:vetCertificate><bs:uuid>source</bs:uuid></vd:vetCertificate></vd:accompanyingForms>
 </vd:certifiedConsignment>
</vd:vetDocument>"""


def intent(*, mismatch: bool, decision: str, vet: str = "CORRESPONDS") -> ReceiptIntent:
    delivered, delivered_quantity, accepted, accepted_quantity, returned, returned_quantity = {
        "ACCEPT_ALL": (Decimal("100"), Decimal("4"), Decimal("100"), Decimal("4"), Decimal("0"), Decimal("0")),
        "PARTIALLY": (Decimal("120"), Decimal("4"), Decimal("100"), Decimal("3"), Decimal("20"), Decimal("1")),
        "RETURN_ALL": (Decimal("120"), Decimal("4"), Decimal("0"), Decimal("0"), Decimal("120"), Decimal("4")),
    }[decision]
    return ReceiptIntent(
        operation_id=uuid.uuid4(),
        party_id=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        contour=VetisContour.PILOT,
        source_evsd_uuid=SOURCE_EVSD,
        source_checksum="a" * 64,
        source_revision=4,
        receiver_enterprise_id=SOURCE_RECEIVER,
        business_member_id=str(uuid.uuid4()),
        initiator="fixture-vet",
        delivery_date=datetime(2026, 11, 9, 10, 0, tzinfo=UTC),
        reconciliation_revision=7,
        decision=decision,  # type: ignore[arg-type]
        doc_inspection="MISMATCH" if mismatch else "CORRESPONDS",
        vet_inspection=vet,  # type: ignore[arg-type]
        documentary_mass_kg=Decimal("120"),
        documentary_quantity=Decimal("4"),
        delivered_mass_kg=delivered,
        delivered_quantity=delivered_quantity,
        accepted_mass_kg=accepted,
        accepted_quantity=accepted_quantity,
        returned_mass_kg=returned,
        returned_quantity=returned_quantity,
        issue_date=datetime(2026, 11, 9, 9, 0, tzinfo=UTC),
        return_date=datetime(2026, 11, 10, 12, 0, tzinfo=UTC) if decision != "ACCEPT_ALL" else None,
        unit_id=SOURCE_UNIT,
        discrepancy_items=[
            {
                "field_id": "CHK-F01",
                "reason": "QUANTITY",
                "actual": "100",
                "source": "120",
            }
        ]
        if mismatch
        else [],
        return_reason_code="OTHER_REASON" if returned else None,
        return_reason_text="Обезличенная причина возврата" if returned else None,
        act_number="ACT-FIXTURE" if mismatch and decision != "RETURN_ALL" else None,
        local_transaction_id=str(uuid.uuid4()),
        fingerprint="f" * 64,
    )


def count(xml: str, local: str) -> int:
    root = ET.fromstring(xml)
    return sum(node.tag.rsplit("}", 1)[-1] == local for node in root.iter())


def _delivery_element(xml: str, returned: bool) -> ET.Element | None:
    parent_local = "returnedDelivery" if returned else "delivery"
    root = ET.fromstring(xml)
    for node in root.iter():
        if node.tag.rsplit("}", 1)[-1] == parent_local:
            return node
    return None


VDT_NS_PREFIX = (
    'xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2" '
    'xmlns:bs="http://api.vetrf.ru/schema/cdm/base" '
    'xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2"'
)

# ТЗ DR8 §6 / live regression 2026-11-13: a real consignee carries
# businessEntity BEFORE enterprise, each with its own guid. The receiver of
# the intent is the ENTERPRISE guid; the builder must not take the first
# guid in the consignee subtree (the businessEntity one).
SOURCE_XML_CONSIGNEE_FULL = f"""<vd:vetDocument
 {VDT_NS_PREFIX}>
 <bs:uuid>{SOURCE_EVSD}</bs:uuid>
 <vd:authentication><vd:purpose><bs:guid>purpose-guid</bs:guid></vd:purpose></vd:authentication>
 <vd:certifiedConsignment>
  <vd:consignor><dt:enterprise><bs:guid>sender</bs:guid></dt:enterprise></vd:consignor>
  <vd:consignee>
   <dt:businessEntity><bs:guid>business-entity-guid</bs:guid></dt:businessEntity>
   <dt:enterprise><bs:guid>{SOURCE_RECEIVER}</bs:guid></dt:enterprise>
  </vd:consignee>
  <vd:batch><vd:volume>120</vd:volume><vd:unit><bs:guid>{SOURCE_UNIT}</bs:guid></vd:unit></vd:batch>
  <vd:transportInfo><vd:transportType>1</vd:transportType></vd:transportInfo>
  <vd:transportStorageType>FROZEN</vd:transportStorageType>
  <vd:accompanyingForms><vd:vetCertificate><bs:uuid>source</bs:uuid></vd:vetCertificate></vd:accompanyingForms>
 </vd:certifiedConsignment>
</vd:vetDocument>"""


def test_consignee_business_entity_does_not_break_receiver_match() -> None:
    """Live regression: consignee = businessEntity guid first, then enterprise.

    The builder must compare against the enterprise guid (the intent's
    receiver_enterprise_id), not the first guid inside the consignee
    subtree; otherwise every real гашение fails with the intent-mismatch
    VALIDATION_ERROR.
    """
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="ACCEPT_ALL"),
        source_xml=SOURCE_XML_CONSIGNEE_FULL,
        service_id="s",
        issuer_id="i",
    )
    delivery = _delivery_element(xml, returned=False)
    assert delivery is not None
    receiver = delivery.find(f".//{VD}consignee/{DT}enterprise/{BS}guid")
    assert receiver is not None and receiver.text == SOURCE_RECEIVER
    business = delivery.find(f".//{VD}consignee/{DT}businessEntity/{BS}guid")
    assert business is not None and business.text == "business-entity-guid"


def test_gashenie_keeps_source_trailer_number() -> None:
    """ТЗ DR17 §7: the source trailerNumber stays a source requisite of the
    гашение XML — the user's discrepancy fact never replaces it."""
    source = SOURCE_XML.replace(
        "<vd:transportInfo><vd:transportType>1</vd:transportType></vd:transportInfo>",
        "<vd:transportInfo><vd:transportType>1</vd:transportType>"
        "<vd:transportNumber><vd:vehicleNumber>А123АА116</vd:vehicleNumber>"
        "<vd:trailerNumber>Т456РР116</vd:trailerNumber></vd:transportNumber></vd:transportInfo>",
    )
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="PARTIALLY"),
        source_xml=source,
        service_id="s",
        issuer_id="i",
    )
    accepted = _delivery_element(xml, returned=False)
    assert accepted is not None
    trailer = accepted.find(f".//{VD}transportInfo/{VD}transportNumber/{VD}trailerNumber")
    assert trailer is not None and trailer.text == "Т456РР116"
    vehicle = accepted.find(f".//{VD}transportInfo/{VD}transportNumber/{VD}vehicleNumber")
    assert vehicle is not None and vehicle.text == "А123АА116"


VD = "{http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2}"
BS = "{http://api.vetrf.ru/schema/cdm/base}"
DT = "{http://api.vetrf.ru/schema/cdm/dictionary/v2}"
VU = "{http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2}"


def _consignment(xml: str, returned: bool) -> ET.Element | None:
    root = ET.fromstring(xml)
    parent_local = "returnedDelivery" if returned else "delivery"
    for delivery in root.iter():
        if delivery.tag.rsplit("}", 1)[-1] != parent_local:
            continue
        for child in delivery:
            if child.tag.rsplit("}", 1)[-1] == "consignment":
                return child
    return None


def test_volume_is_mass_and_package_quantity_is_places() -> None:
    """ТЗ DR8 §5.2/R-DR8-2: volume = mass, dt:package/dt:quantity = places."""
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="PARTIALLY"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    accepted = _consignment(xml, returned=False)
    returned = _consignment(xml, returned=True)
    assert accepted is not None and returned is not None
    assert accepted.find(f"{VD}volume").text == "100"  # type: ignore[union-attr]
    assert accepted.find(f".//{DT}quantity").text == "3"  # type: ignore[union-attr]
    assert returned.find(f"{VD}volume").text == "20"  # type: ignore[union-attr]
    assert returned.find(f".//{DT}quantity").text == "1"  # type: ignore[union-attr]
    assert accepted.find(f".//{VD}unit/{BS}guid").text == SOURCE_UNIT  # type: ignore[union-attr]
    assert returned.find(f".//{VD}unit/{BS}guid").text == SOURCE_UNIT  # type: ignore[union-attr]


def test_returned_delivery_copies_source_purpose() -> None:
    """ТЗ DR8 §6.1/R-DR8-3: the returned ВСД keeps the source purpose."""
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="RETURN_ALL"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    root = ET.fromstring(xml)
    returned = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "returnedDelivery")
    authentication = next(node for node in returned.iter() if node.tag.rsplit("}", 1)[-1] == "authentication")
    purpose = next(node for node in authentication if node.tag.rsplit("}", 1)[-1] == "purpose")
    assert purpose.find(f"{BS}guid").text == "purpose-guid"  # type: ignore[union-attr]


def test_return_without_source_purpose_is_refused() -> None:
    """ТЗ DR8 §6.1: no incomplete return XML without the source purpose."""
    removed = "<vd:authentication><vd:purpose><bs:guid>purpose-guid</bs:guid></vd:purpose></vd:authentication>"
    source = SOURCE_XML.replace(removed, "")
    with pytest.raises(ProblemError):
        build_process_incoming_application(
            intent(mismatch=False, decision="RETURN_ALL"),
            source_xml=source,
            service_id="s",
            issuer_id="i",
        )


def test_reason_code_then_other_reason_text_in_special_marks() -> None:
    """ТЗ DR8 §6.2/R-DR8-4: exact code first; OTHER_REASON adds its text."""
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="RETURN_ALL"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    root = ET.fromstring(xml)
    marks = [(node.text or "") for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "specialMarks"]
    assert marks[0] == "OTHER_REASON"
    assert marks[1] == "OTHER_REASON: Обезличенная причина возврата"


def test_request_dates_are_not_mixed() -> None:
    """ТЗ DR8 §9/R-DR8-6: issueDate = formation time; delivery/return dates."""
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="PARTIALLY"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    root = ET.fromstring(xml)
    application = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "application")
    issue_date = next(node.text for node in application if node.tag.rsplit("}", 1)[-1] == "issueDate")
    deliveries = {
        node.tag.rsplit("}", 1)[-1]: next(
            child.text for child in node if child.tag.rsplit("}", 1)[-1] == "deliveryDate"
        )
        for node in root.iter()
        if node.tag.rsplit("}", 1)[-1] in {"delivery", "returnedDelivery"}
    }
    assert issue_date == "2026-11-09T09:00:00+00:00"
    assert deliveries["delivery"] == "2026-11-09T10:00:00+00:00"
    assert deliveries["returnedDelivery"] == "2026-11-10T12:00:00+00:00"


def test_return_all_forward_delivery_has_no_consignment() -> None:
    """ТЗ DR8 §8: RETURN_ALL → forward delivery without consignment."""
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="RETURN_ALL"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    root = ET.fromstring(xml)
    forward = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "delivery")
    assert not any(child.tag.rsplit("}", 1)[-1] == "consignment" for child in forward)


def test_return_all_has_no_discrepancy_report() -> None:
    xml = build_process_incoming_application(
        intent(mismatch=True, decision="RETURN_ALL"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    assert count(xml, "discrepancyReport") == 0


def test_discrepancy_report_carries_every_item() -> None:
    """ТЗ DR8 §9: mismatch + ACCEPT_ALL/PARTIALLY → full report, all items."""
    value = intent(mismatch=True, decision="PARTIALLY").model_copy(
        update={
            "discrepancy_items": [
                {"field_id": "CHK-F01", "reason": "QUANTITY", "actual": "100", "source": "120"},
                {"field_id": "CHK-F10", "reason": "TRANSPORT", "actual": "А000ВВ", "source": "А123ВС"},
            ]
        }
    )
    xml = build_process_incoming_application(value, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    root = ET.fromstring(xml)
    report = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "discrepancyReport")
    info = next(node.text for node in report if node.tag.rsplit("}", 1)[-1] == "info")
    assert "CHK-F01" in info and "CHK-F10" in info
    assert "120" in info and "А123ВС" in info


SOURCE_XML_MULTI_PACKAGE = SOURCE_XML.replace(
    "<vd:volume>120</vd:volume>",
    """<vd:volume>120</vd:volume><dt:packageList>
     <dt:package><dt:level>3</dt:level><dt:quantity>1</dt:quantity></dt:package>
     <dt:package><dt:level>4</dt:level><dt:quantity>2</dt:quantity><dt:productMarks><bs:class>VAT</bs:class></dt:productMarks></dt:package>
     <dt:package><dt:level>4</dt:level><dt:quantity>2</dt:quantity></dt:package>
   </dt:packageList>""",
)


def test_two_top_level_packages_collapse_to_aggregate_places() -> None:
    """ТЗ DR8 §5.2: the aggregate is the truth — sum of top-level quantities
    written equals the intent quantity, never total×N; the reader-side
    evidence extraction agrees."""
    value = intent(mismatch=False, decision="PARTIALLY")
    xml = build_process_incoming_application(value, source_xml=SOURCE_XML_MULTI_PACKAGE, service_id="s", issuer_id="i")
    root = ET.fromstring(xml)
    forward = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "delivery")
    packages = [
        (node, node.find(f"{DT}quantity")) for node in forward.iter() if node.tag.rsplit("}", 1)[-1] == "package"
    ]
    top = [
        item
        for item in packages
        if item[0].find(f"{DT}level") is not None and item[0].find(f"{DT}level").text == "4"  # type: ignore[union-attr]
    ]
    assert len(top) == 1  # redundant max-level siblings omitted, marks preserved
    total = sum(Decimal(node.text) for _, node in top if node is not None and node.text)
    assert total == value.accepted_quantity
    # The evidence reader extracts the SAME aggregate from the written XML.
    consignment = _consignment(xml, returned=False)
    assert consignment is not None
    package_list = next((node for node in consignment if node.tag.rsplit("}", 1)[-1] == "packageList"), None)
    assert package_list is not None
    batch = ET.Element(f"{VD}batch")
    batch.append(copy.deepcopy(package_list))
    from backend.src.modules.integrations.vetis.evidence import _places_of as _read_places

    assert _read_places(batch) == value.accepted_quantity
    marks = [mark.text for mark in root.iter() if (mark.tag.rsplit("}", 1)[-1] == "class" and mark.text)]
    assert "VAT" in marks  # source packaging detail of the kept package is intact


@pytest.mark.parametrize("mismatch", [False, True])
@pytest.mark.parametrize("decision", ["ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"])
def test_six_contract_scenarios(mismatch: bool, decision: str) -> None:
    value = intent(mismatch=mismatch, decision=decision)
    xml = build_process_incoming_application(
        value, source_xml=SOURCE_XML, service_id="mercury-vu.service:2.0", issuer_id="fixture"
    )
    assert count(xml, "processIncomingConsignmentRequest") == 1
    assert count(xml, "vetCertificatePresence") == 1
    assert "ELECTRONIC" in xml
    assert count(xml, "delivery") == 1
    assert count(xml, "consignment") == (1 if decision in {"ACCEPT_ALL", "RETURN_ALL"} else 2)
    assert count(xml, "returnedDelivery") == (0 if decision == "ACCEPT_ALL" else 1)
    assert count(xml, "discrepancyReport") == (1 if mismatch and decision != "RETURN_ALL" else 0)
    assert "Обезличенная причина возврата" in xml if decision != "ACCEPT_ALL" else True


@pytest.mark.parametrize("vet", ["CORRESPONDS", "MISMATCH", "UNSUPERVISED"])
def test_vet_inspection_is_independent(vet: str) -> None:
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="ACCEPT_ALL", vet=vet),
        source_xml=SOURCE_XML,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
    )
    assert f">{vet}<" in xml


def test_other_reason_requires_text_and_blocking_forces_return() -> None:
    missing = intent(mismatch=False, decision="PARTIALLY").model_copy(update={"return_reason_text": None})
    with pytest.raises(ProblemError):
        build_process_incoming_application(missing, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    blocked = intent(mismatch=True, decision="ACCEPT_ALL").model_copy(
        update={"discrepancy_items": [{"field_id": "CHK-F01", "reason": "unsafe", "blocking": True}]}
    )
    with pytest.raises(ProblemError):
        build_process_incoming_application(blocked, source_xml=SOURCE_XML, service_id="s", issuer_id="i")


def test_missing_scope_refused_before_transport() -> None:
    calls: list[str] = []
    invalid = intent(mismatch=False, decision="ACCEPT_ALL").model_copy(update={"initiator": ""})
    with pytest.raises(ProblemError):
        build_process_incoming_application(invalid, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    assert calls == []


async def test_enabled_transport_uses_exact_submit_action_without_network() -> None:
    class CaptureTransport(ZeepApplicationTransport):
        def __init__(self) -> None:
            super().__init__(endpoint="https://fixture.invalid")
            self.captured: list[tuple[str, str]] = []

        def _post(self, action: str, body: str) -> str:
            self.captured.append((action, body))
            return "<response><applicationId>fixture-app</applicationId></response>"

    value = intent(mismatch=False, decision="ACCEPT_ALL")
    xml = build_process_incoming_application(
        value,
        source_xml=SOURCE_XML,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
        api_key="fixture-key",
    )
    transport = CaptureTransport()
    application_id = await transport.send_application(xml)
    assert application_id == "fixture-app"
    assert transport.captured == [("submitApplicationRequest", xml)]
