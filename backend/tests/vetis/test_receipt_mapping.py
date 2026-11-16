"""W01 offline assertions: six receipt branches, no Mercury connection."""

from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
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
                "field_id": "CHK-F20",
                "label": "Количество",
                "reason": "Фактическое количество меньше заявленного",
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


def test_missing_accompanying_forms_synthesizes_vet_certificate() -> None:
    """Live regression: a transport LIC2 eVSD carries no accompanyingForms.

    Per docs/integration/mercury-test-integration-contract.md the electronic
    certificate reference in delivery/accompanyingForms/vetCertificate is the
    UUID of the source eVSD itself, so the builder synthesizes the block
    instead of failing.
    """
    source = SOURCE_XML_CONSIGNEE_FULL.replace(
        "<vd:accompanyingForms><vd:vetCertificate><bs:uuid>source</bs:uuid></vd:vetCertificate></vd:accompanyingForms>",
        "",
    )
    assert "vetCertificate" not in source
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="ACCEPT_ALL"),
        source_xml=source,
        service_id="s",
        issuer_id="i",
    )
    delivery = _delivery_element(xml, returned=False)
    assert delivery is not None
    cert = delivery.find(f"{VD}accompanyingForms/{VD}vetCertificate/{BS}uuid")
    assert cert is not None and cert.text == str(SOURCE_EVSD)


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
    """ТЗ DR38 §6: ровно один specialMarks в формате «Причина возврата: CODE»."""
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="RETURN_ALL"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    root = ET.fromstring(xml)
    marks = [(node.text or "") for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "specialMarks"]
    assert len(marks) == 1
    assert marks[0] == "Причина возврата: OTHER_REASON Обезличенная причина возврата"


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


# --- ТЗ DR38 §1/§4.3/§5: structure helpers -----------------------------------

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "vetis" / "process_incoming_consignment"

DISCREPANCY_TEXT_LIMIT = 2000


def signature(element: ET.Element) -> object:
    """Точная структура: локальное имя и порядок дочерних элементов."""
    return element.tag.rsplit("}", 1)[-1], [signature(child) for child in element]


def child_locals(element: ET.Element) -> list[str]:
    return [node.tag.rsplit("}", 1)[-1] for node in element]


def text_of_parent(xml: str, parent_local: str, child_local: str) -> str | None:
    """Текст ровно у прямого ребёнка с проверкой родителя (не поиск по всему дереву)."""
    root = ET.fromstring(xml)
    parent = next(
        (node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == parent_local),
        None,
    )
    if parent is None:
        return None
    for node in parent:
        if node.tag.rsplit("}", 1)[-1] == child_local:
            return node.text
    return None


def inspection_of(xml: str, inspection_local: str) -> ET.Element:
    root = ET.fromstring(xml)
    facts = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "deliveryFacts")
    inspection = next(child for child in facts if child.tag.rsplit("}", 1)[-1] == inspection_local)
    assert inspection.tag.startswith("{http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2}")
    return inspection


def test_reproduce_invalid_receipt_discrepancy_xml() -> None:
    """ТЗ DR38 §1: воспроизведение отклонённого ВетИС XML.

    ВетИС отклонил приложение 31ad1307-… с текстом «Элемент 'info' не
    предусмотрен»: ``vd:info`` не принадлежит типу DiscrepancyReport —
    детальное описание передаётся ``vd:description``, а ``vd:info``
    находится внутри ``vd:docInspection`` после ``vd:result``.
    """
    value = intent(mismatch=True, decision="PARTIALLY")
    xml = build_process_incoming_application(value, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    root = ET.fromstring(xml)
    report = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "discrepancyReport")
    # vd:info внутри discrepancyReport запрещён схемой DiscrepancyReport.
    assert not any(node.tag.rsplit("}", 1)[-1] == "info" for node in report)
    # Вместо него — description, после reason.
    assert child_locals(report) == ["issueNumber", "reason", "description"]
    reason = next(node for node in report if node.tag.rsplit("}", 1)[-1] == "reason")
    assert child_locals(reason) == ["name"]
    description = next(node for node in report if node.tag.rsplit("}", 1)[-1] == "description")
    assert description is not None and description.text
    # Документарное расхождение описывается внутри docInspection.
    inspection = inspection_of(xml, "docInspection")
    assert child_locals(inspection) == ["responsible", "result", "info"]
    assert inspection.find(f"{VD}result").text == "MISMATCH"  # type: ignore[union-attr]


def test_discrepancy_report_carries_every_item() -> None:
    """ТЗ DR38 §5: одно описание из всех items, русские названия полей."""
    value = intent(mismatch=True, decision="PARTIALLY").model_copy(
        update={
            "discrepancy_items": [
                {
                    "field_id": "CHK-F20",
                    "label": "Количество",
                    "source": "5",
                    "actual": "6",
                    "reason": "Фактическое количество больше заявленного",
                },
                {
                    "field_id": "CHK-F21",
                    "label": "Вес, кг",
                    "source": "60",
                    "actual": "80",
                    "reason": "Фактический вес больше заявленного",
                },
            ]
        }
    )
    xml = build_process_incoming_application(value, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    expected = (
        "Количество: в ВСД 5, фактически 6 (Фактическое количество больше заявленного); "
        "Вес, кг: в ВСД 60, фактически 80 (Фактический вес больше заявленного)"
    )
    report = next(node for node in ET.fromstring(xml).iter() if node.tag.rsplit("}", 1)[-1] == "discrepancyReport")
    description = next(node for node in report if node.tag.rsplit("}", 1)[-1] == "description")
    assert description.text == expected
    assert description.text == text_of_parent(xml, "docInspection", "info")
    # Технические CHK-ID не показываются пользователю в XML.
    assert "CHK-F" not in (description.text or "")
    # Причина акта — понятная формулировка, не технический код первой строки.
    reason_name = text_of_parent(xml, "reason", "name")
    assert reason_name == "Причина несоответствия (акт)"


def test_corresponds_never_carries_info_or_report() -> None:
    """ТЗ DR38 §4.3: CORRESPONDS не содержит ни docInspection/info, ни акта."""
    for decision in ("ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"):
        xml = build_process_incoming_application(
            intent(mismatch=False, decision=decision),
            source_xml=SOURCE_XML,
            service_id="s",
            issuer_id="i",
        )
        root = ET.fromstring(xml)
        assert [n for n in root.iter() if n.tag.rsplit("}", 1)[-1] == "info"] == []
        assert [n for n in root.iter() if n.tag.rsplit("}", 1)[-1] == "discrepancyReport"] == []


def test_mismatch_return_all_keeps_doc_inspection_info_without_act() -> None:
    """ТЗ DR38 §5: RETURN_ALL сохраняет docInspection/info, но без акта."""
    xml = build_process_incoming_application(
        intent(mismatch=True, decision="RETURN_ALL"),
        source_xml=SOURCE_XML,
        service_id="s",
        issuer_id="i",
    )
    info = text_of_parent(xml, "docInspection", "info")
    assert info and "Количество" in info
    assert count(xml, "discrepancyReport") == 0


def test_discrepancy_description_too_long_is_refused_before_submit() -> None:
    """ТЗ DR38 §5: превышение лимита описания — отказ, а не тихая обрезка."""
    value = intent(mismatch=True, decision="PARTIALLY").model_copy(
        update={
            "discrepancy_items": [
                {
                    "field_id": "CHK-F20",
                    "label": "Количество",
                    "source": "5",
                    "actual": "6",
                    "reason": "П" * (DISCREPANCY_TEXT_LIMIT + 10),
                }
            ]
        }
    )
    with pytest.raises(ProblemError):
        build_process_incoming_application(value, source_xml=SOURCE_XML, service_id="s", issuer_id="i")


SPECIAL_MARK_REASON = "Причина возврата"


@pytest.mark.parametrize(
    ("code", "text", "expected"),
    [
        ("QUANTITY_DISCREPANCY", None, f"{SPECIAL_MARK_REASON}: QUANTITY_DISCREPANCY"),
        ("OTHER_REASON", "  Пояснение пользователя  ", f"{SPECIAL_MARK_REASON}: OTHER_REASON Пояснение пользователя"),
    ],
)
def test_return_reason_is_one_special_mark(code: str, text: str | None, expected: str) -> None:
    """ТЗ DR38 §6: стандартный код без русской подписи; OTHER_REASON с текстом."""
    value = intent(mismatch=False, decision="PARTIALLY").model_copy(
        update={"return_reason_code": code, "return_reason_text": text}
    )
    xml = build_process_incoming_application(value, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    root = ET.fromstring(xml)
    marks = [(node.text or "") for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "specialMarks"]
    assert marks == [expected]


def test_existing_special_marks_are_merged_not_lost() -> None:
    """ТЗ DR38 §6: существующие особые отметки не теряются и не дублируют причину."""
    source = SOURCE_XML.replace(
        "</vd:authentication>",
        "<vd:specialMarks>Груз осмотрен, клеймо сохранено</vd:specialMarks>"
        "<vd:specialMarks>Причина возврата: старая причина</vd:specialMarks></vd:authentication>",
    )
    value = intent(mismatch=False, decision="PARTIALLY")
    xml = build_process_incoming_application(value, source_xml=source, service_id="s", issuer_id="i")
    root = ET.fromstring(xml)
    marks = [(node.text or "") for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "specialMarks"]
    assert len(marks) == 1
    assert "Груз осмотрен, клеймо сохранено" in marks[0]
    assert "старая причина" not in marks[0]
    assert marks[0].endswith("Причина возврата: OTHER_REASON Обезличенная причина возврата")
    assert marks[0].count("Причина возврата:") == 1


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
    """ТЗ DR38 §4.3: точная матрица шести сценариев (родители, порядок, состав)."""
    value = intent(mismatch=mismatch, decision=decision).model_copy(
        update={"return_reason_code": "QUANTITY_DISCREPANCY", "return_reason_text": None}
    )
    xml = build_process_incoming_application(
        value, source_xml=SOURCE_XML, service_id="mercury-vu.service:2.0", issuer_id="fixture"
    )
    root = ET.fromstring(xml)
    request = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "processIncomingConsignmentRequest")
    # Namespace каждого блока закреплён (mercvu = vu/applications/v2, vd = vet-document/v2).
    assert request.tag == f"{VU}processIncomingConsignmentRequest"
    expected_request = ["localTransactionId", "initiator", "delivery", "deliveryFacts"]
    if mismatch and decision != "RETURN_ALL":
        expected_request.append("discrepancyReport")
    if decision != "ACCEPT_ALL":
        expected_request.append("returnedDelivery")
    assert child_locals(request) == expected_request
    facts = next(child for child in request if child.tag.rsplit("}", 1)[-1] == "deliveryFacts")
    assert child_locals(facts) == [
        "vetCertificatePresence",
        "docInspection",
        "vetInspection",
        "decision",
    ]
    doc_inspection = next(child for child in facts if child.tag.rsplit("}", 1)[-1] == "docInspection")
    assert doc_inspection.tag == f"{VD}docInspection"
    expected = ["responsible", "result"] + (["info"] if mismatch else [])
    assert child_locals(doc_inspection) == expected
    assert count(xml, "discrepancyReport") == (1 if mismatch and decision != "RETURN_ALL" else 0)
    if mismatch and decision != "RETURN_ALL":
        report = next(node for node in request if node.tag.rsplit("}", 1)[-1] == "discrepancyReport")
        assert report.tag == f"{VU}discrepancyReport"
        # document fields → reason → description (ТЗ DR38 §1).
        assert child_locals(report) == ["issueNumber", "reason", "description"]
    # Состав партий: принятая/возвращаемая части по матрице.
    deliveries = {
        child.tag.rsplit("}", 1)[-1]: child
        for child in request
        if child.tag.rsplit("}", 1)[-1] in {"delivery", "returnedDelivery"}
    }
    assert set(deliveries) == ({"delivery"} if decision == "ACCEPT_ALL" else {"delivery", "returnedDelivery"})
    accepted = _consignment(xml, returned=False)
    returned = _consignment(xml, returned=True)
    if decision == "ACCEPT_ALL":
        assert accepted is not None
        assert accepted.find(f"{VD}volume").text == "100"  # type: ignore[union-attr]
        assert returned is None
        assert count(xml, "returnedDelivery") == 0
    elif decision == "PARTIALLY":
        assert accepted is not None and returned is not None
        assert accepted.find(f"{VD}volume").text == "100"  # type: ignore[union-attr]
        assert accepted.find(f".//{DT}quantity").text == "3"  # type: ignore[union-attr]
        assert returned.find(f"{VD}volume").text == "20"  # type: ignore[union-attr]
        assert returned.find(f".//{DT}quantity").text == "1"  # type: ignore[union-attr]
        marks = [(n.text or "") for n in root.iter() if n.tag.rsplit("}", 1)[-1] == "specialMarks"]
        assert marks == ["Причина возврата: QUANTITY_DISCREPANCY"]
    else:
        assert accepted is None
        assert returned is not None
        assert returned.find(f"{VD}volume").text == "120"  # type: ignore[union-attr]
        assert returned.find(f".//{DT}quantity").text == "4"  # type: ignore[union-attr]
        marks = [(n.text or "") for n in root.iter() if n.tag.rsplit("}", 1)[-1] == "specialMarks"]
        assert marks == ["Причина возврата: QUANTITY_DISCREPANCY"]


@pytest.mark.parametrize(
    "scenario",
    ["1.1.1", "1.1.2", "1.1.3", "1.2.1", "1.2.2", "1.2.3"],
)
def test_six_scenarios_match_deidentified_owner_fragments(scenario: str) -> None:
    """ТЗ DR38 §1: структура совпадает с обезличенными примерами владельца."""
    mismatch = scenario.startswith("1.2")
    decision = {"1": "ACCEPT_ALL", "2": "PARTIALLY", "3": "RETURN_ALL"}[scenario[-1]]
    value = intent(mismatch=mismatch, decision=decision).model_copy(
        update={"return_reason_code": "QUANTITY_DISCREPANCY", "return_reason_text": None}
    )
    xml = build_process_incoming_application(
        value, source_xml=SOURCE_XML, service_id="mercury-vu.service:2.0", issuer_id="fixture"
    )
    root = ET.fromstring(xml)
    built = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "processIncomingConsignmentRequest")
    fragment = ET.parse(FIXTURES / f"scenario-{scenario}.xml").getroot()
    assert signature(built) == signature(fragment)


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


async def test_transport_uses_wsdl_receive_action_with_request_element() -> None:
    class CaptureTransport(ZeepApplicationTransport):
        def __init__(self) -> None:
            super().__init__(endpoint="https://fixture.invalid", api_key="key", issuer_id="issuer")
            self.captured: list[tuple[str, str]] = []

        def _post(self, action: str, body: str) -> str:
            self.captured.append((action, body))
            return "<response><status>IN_PROCESS</status></response>"

    transport = CaptureTransport()
    await transport.receive_result("fixture-app")
    assert transport.captured[0][0] == "receiveApplicationResult"
    assert "receiveApplicationResultRequest" in transport.captured[0][1]


def test_package_quantity_is_serialized_as_schema_integer() -> None:
    value = intent(mismatch=False, decision="ACCEPT_ALL").model_copy(
        update={"delivered_quantity": Decimal("6.000000"), "accepted_quantity": Decimal("6.000000")}
    )
    xml = build_process_incoming_application(
        value,
        source_xml=SOURCE_XML,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
    )
    assert "<dt:quantity>6</dt:quantity>" in xml
    assert "<dt:quantity>6.000000</dt:quantity>" not in xml


def test_fractional_package_quantity_is_rejected_before_network() -> None:
    value = intent(mismatch=False, decision="ACCEPT_ALL").model_copy(
        update={"delivered_quantity": Decimal("6.5"), "accepted_quantity": Decimal("6.5")}
    )
    with pytest.raises(ProblemError, match="целым числом"):
        build_process_incoming_application(
            value,
            source_xml=SOURCE_XML,
            service_id="mercury-vu.service:2.0",
            issuer_id="fixture",
        )


def test_source_referenced_document_becomes_delivery_waybill() -> None:
    source = SOURCE_XML.replace(
        "<vd:certifiedConsignment>",
        """<vd:referencedDocument>
          <vd:issueSeries>005</vd:issueSeries><vd:issueNumber>222</vd:issueNumber>
          <vd:issueDate>2026-11-12</vd:issueDate><vd:type>1</vd:type>
          <vd:relationshipType>1</vd:relationshipType>
        </vd:referencedDocument><vd:certifiedConsignment>""",
    )
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="ACCEPT_ALL"),
        source_xml=source,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
    )
    root = ET.fromstring(xml)
    waybill = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "waybill")
    values = {node.tag.rsplit("}", 1)[-1]: node.text for node in waybill}
    assert values == {
        "issueSeries": "005",
        "issueNumber": "222",
        "issueDate": "2026-11-12",
        "type": "1",
    }


def test_nested_research_document_is_never_used_as_delivery_waybill() -> None:
    source = SOURCE_XML.replace(
        "<vd:authentication>",
        """<vd:laboratoryResearch><vd:referencedDocument>
          <vd:issueNumber>333</vd:issueNumber><vd:issueDate>2026-11-12</vd:issueDate>
          <vd:type>9</vd:type>
        </vd:referencedDocument></vd:laboratoryResearch>
        <vd:referencedDocument>
          <vd:issueNumber>111111</vd:issueNumber><vd:issueDate>2026-11-13</vd:issueDate>
          <vd:type>1</vd:type><vd:relationshipType>1</vd:relationshipType>
        </vd:referencedDocument><vd:authentication>""",
    )
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="ACCEPT_ALL"),
        source_xml=source,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
    )
    root = ET.fromstring(xml)
    waybill = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "waybill")
    values = {node.tag.rsplit("}", 1)[-1]: node.text for node in waybill}
    assert values == {"issueNumber": "111111", "issueDate": "2026-11-13", "type": "1"}
