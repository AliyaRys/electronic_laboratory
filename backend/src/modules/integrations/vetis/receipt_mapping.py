"""Exact offline mapping for Mercury ``ProcessIncomingConsignment``."""

from __future__ import annotations

import copy
from datetime import UTC
from decimal import Decimal
from xml.etree import ElementTree as ET

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.contracts import ReceiptIntent

APP_DEF_NS = "http://api.vetrf.ru/schema/cdm/application/ws-definitions"
APP_NS = "http://api.vetrf.ru/schema/cdm/application"
BASE_NS = "http://api.vetrf.ru/schema/cdm/base"
DICT_NS = "http://api.vetrf.ru/schema/cdm/dictionary/v2"
VD_NS = "http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
VU_NS = "http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2"

for prefix, namespace in (
    ("apldef", APP_DEF_NS), ("apl", APP_NS), ("bs", BASE_NS),
    ("dt", DICT_NS), ("vd", VD_NS), ("mercvu", VU_NS),
):
    ET.register_namespace(prefix, namespace)

__all__ = ["build_process_incoming_application", "validate_receipt_intent"]


def _invalid(detail: str) -> ProblemError:
    return ProblemError(status=422, code="VALIDATION_ERROR", title="Validation error", detail=detail)


def _text(parent: ET.Element, namespace: str, name: str, value: object) -> ET.Element:
    node = ET.SubElement(parent, f"{{{namespace}}}{name}")
    node.text = str(value)
    return node


def _local(node: ET.Element) -> str:
    return node.tag.rsplit("}", 1)[-1]


def _find_local(root: ET.Element, name: str) -> ET.Element | None:
    return next((node for node in root.iter() if _local(node) == name), None)


def _desc_text(root: ET.Element | None, name: str) -> str | None:
    node = _find_local(root, name) if root is not None else None
    return node.text if node is not None else None


def _copy_named(parent: ET.Element, source: ET.Element, name: str) -> ET.Element | None:
    child = next((item for item in source if _local(item) == name), None)
    if child is None:
        return None
    clone = copy.deepcopy(child)
    parent.append(clone)
    return clone


def _set_volume(consignment: ET.Element, volume: Decimal) -> None:
    node = _find_local(consignment, "volume")
    if node is None:
        raise _invalid("Исходный XML не содержит объём партии.")
    node.text = format(volume, "f")


def _delivery(
    request: ET.Element,
    source: ET.Element,
    intent: ReceiptIntent,
    *,
    returned: bool,
    authentication_template: ET.Element | None = None,
) -> ET.Element:
    delivery = ET.SubElement(request, f"{{{VU_NS}}}{'returnedDelivery' if returned else 'delivery'}")
    _text(delivery, VD_NS, "deliveryDate", intent.delivery_date.astimezone(UTC).isoformat())
    consignor = next((item for item in source if _local(item) == "consignor"), None)
    consignee = next((item for item in source if _local(item) == "consignee"), None)
    if consignor is None or consignee is None:
        raise _invalid("Исходный XML не содержит участников перевозки.")
    delivery.append(copy.deepcopy(consignee if returned else consignor))
    delivery[-1].tag = f"{{{VD_NS}}}consignor"
    delivery.append(copy.deepcopy(consignor if returned else consignee))
    delivery[-1].tag = f"{{{VD_NS}}}consignee"

    volume = intent.returned_quantity if returned else intent.accepted_quantity
    if volume > 0:
        batch = next((item for item in source if _local(item) in {"batch", "consignment"}), None)
        if batch is None:
            raise _invalid("Исходный XML не содержит состав партии.")
        consignment = copy.deepcopy(batch)
        consignment.tag = f"{{{VD_NS}}}consignment"
        _set_volume(consignment, volume)
        delivery.append(consignment)
    for child_name in ("transportInfo", "transportStorageType", "accompanyingForms"):
        _copy_named(delivery, source, child_name)
    certificate = _find_local(delivery, "vetCertificate")
    if certificate is None:
        raise _invalid("Исходный XML не содержит электронный ветеринарный сертификат.")
    if returned:
        for child in list(certificate):
            certificate.remove(child)
        if authentication_template is None:
            raise _invalid("Исходный XML не содержит authentication для возвратного ВСД.")
        authentication = copy.deepcopy(authentication_template)
        for child in list(authentication):
            if _local(child) == "specialMarks":
                authentication.remove(child)
        reason = f"Причина возврата: {intent.return_reason_code}"
        if intent.return_reason_code == "OTHER_REASON":
            reason = f"{reason} {intent.return_reason_text or ''}".strip()
        _text(authentication, VD_NS, "specialMarks", reason)
        certificate.append(authentication)
    return delivery


def validate_receipt_intent(intent: ReceiptIntent) -> None:
    if not all((intent.initiator.strip(), intent.receiver_enterprise_id.strip(), intent.business_member_id.strip())):
        raise _invalid("Не задан инициатор или область ВетИС; гашение не сформировано.")
    quantities = (
        intent.documentary_quantity,
        intent.delivered_quantity,
        intent.accepted_quantity,
        intent.returned_quantity,
    )
    if any(value < 0 for value in quantities) or intent.delivered_quantity <= 0:
        raise _invalid("Количество продукции для гашения недействительно.")
    if intent.accepted_quantity + intent.returned_quantity != intent.delivered_quantity:
        raise _invalid("Принятая и возвращаемая части не равны доставленному количеству.")
    if intent.decision == "ACCEPT_ALL" and (
        intent.accepted_quantity != intent.delivered_quantity or intent.returned_quantity
    ):
        raise _invalid("Полное принятие не может содержать возврат.")
    if intent.decision == "PARTIALLY" and not (intent.accepted_quantity > 0 and intent.returned_quantity > 0):
        raise _invalid("Частичное принятие требует положительные принятую и возвращаемую части.")
    if intent.decision == "RETURN_ALL" and (
        intent.accepted_quantity or intent.returned_quantity != intent.delivered_quantity
    ):
        raise _invalid("При полном возврате принятое количество должно быть нулевым.")
    if intent.decision != "ACCEPT_ALL" and not intent.return_reason_code:
        raise _invalid("Для возврата требуется справочный GUID причины/назначения Меркурия.")
    if intent.return_reason_code == "OTHER_REASON" and not (intent.return_reason_text or "").strip():
        raise _invalid("Для причины OTHER_REASON требуется пояснение.")
    if intent.doc_inspection == "MISMATCH" and intent.decision != "RETURN_ALL" and not intent.discrepancy_items:
        raise _invalid("Расхождение при принятии требует акта несоответствия.")
    if any(bool(item.get("blocking")) for item in intent.discrepancy_items) and intent.decision != "RETURN_ALL":
        raise _invalid("Блокирующее расхождение допускает только полный возврат.")


def build_process_incoming_application(
    intent: ReceiptIntent,
    *,
    source_xml: str,
    service_id: str,
    issuer_id: str,
    api_key: str | None = None,
) -> str:
    """Build the application wrapper and exact VU request from the frozen source XML."""
    validate_receipt_intent(intent)
    try:
        source_root = ET.fromstring(source_xml)
    except ET.ParseError as exc:
        raise _invalid("Закреплённый исходный XML не разбирается.") from exc
    source = _find_local(source_root, "certifiedConsignment")
    if source is None:
        raise _invalid("Исходный эВСД не содержит certifiedConsignment.")
    source_uuid = next((node.text for node in source_root if _local(node) == "uuid"), None)
    consignee = next((item for item in source if _local(item) == "consignee"), None)
    receiver = _desc_text(consignee, "guid")
    batch = next((item for item in source if _local(item) in {"batch", "consignment"}), None)
    unit = _find_local(batch, "unit") if batch is not None else None
    unit_guid = _desc_text(unit, "guid")
    if (
        source_uuid != str(intent.source_evsd_uuid)
        or receiver != intent.receiver_enterprise_id
        or unit_guid != intent.unit_id
    ):
        raise _invalid("UUID, получатель или единица исходного XML не совпадают с закреплённым intent.")

    root = ET.Element(f"{{{APP_DEF_NS}}}submitApplicationRequest")
    _text(root, APP_DEF_NS, "apiKey", api_key or "")
    application = ET.SubElement(root, f"{{{APP_NS}}}application")
    _text(application, APP_NS, "serviceId", service_id)
    _text(application, APP_NS, "issuerId", issuer_id)
    _text(application, APP_NS, "issueDate", intent.delivery_date.astimezone(UTC).isoformat())
    data = ET.SubElement(application, f"{{{APP_NS}}}data")
    request = ET.SubElement(data, f"{{{VU_NS}}}processIncomingConsignmentRequest")
    _text(request, VU_NS, "localTransactionId", intent.local_transaction_id)
    initiator = ET.SubElement(request, f"{{{VU_NS}}}initiator")
    _text(initiator, VD_NS, "login", intent.initiator)
    authentication_template = _find_local(source_root, "authentication")
    _delivery(request, source, intent, returned=False)

    facts = ET.SubElement(request, f"{{{VU_NS}}}deliveryFacts")
    _text(facts, VD_NS, "vetCertificatePresence", "ELECTRONIC")
    for name, result in (("docInspection", intent.doc_inspection), ("vetInspection", intent.vet_inspection)):
        inspection = ET.SubElement(facts, f"{{{VD_NS}}}{name}")
        responsible = ET.SubElement(inspection, f"{{{VD_NS}}}responsible")
        _text(responsible, VD_NS, "login", intent.initiator)
        _text(inspection, VD_NS, "result", result)
    _text(facts, VD_NS, "decision", intent.decision)

    if intent.doc_inspection == "MISMATCH" and intent.decision != "RETURN_ALL":
        report = ET.SubElement(request, f"{{{VU_NS}}}discrepancyReport")
        if intent.act_number:
            _text(report, VD_NS, "issueNumber", intent.act_number)
        reason = ET.SubElement(report, f"{{{VD_NS}}}reason")
        _text(reason, VD_NS, "name", intent.discrepancy_items[0].get("reason") or "MISMATCH")
        descriptions = [
            str(item.get("description") or item.get("actual") or item.get("field_id") or "")
            for item in intent.discrepancy_items
        ]
        _text(report, VD_NS, "description", "; ".join(filter(None, descriptions)))
    if intent.decision in {"PARTIALLY", "RETURN_ALL"}:
        _delivery(
            request,
            source,
            intent,
            returned=True,
            authentication_template=authentication_template,
        )
    return ET.tostring(root, encoding="unicode", short_empty_elements=True)
