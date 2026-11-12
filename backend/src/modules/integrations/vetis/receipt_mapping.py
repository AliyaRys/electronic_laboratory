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


def _set_package_quantity(consignment: ET.Element, quantity: Decimal) -> None:
    """ТЗ DR8 §5.2: the places count lives in ``dt:package/dt:quantity``.

    The top-level (max numeric ``dt:level``) packages carry the transport
    quantity; a missing packageList is created honestly rather than writing
    the count into ``vd:volume``.
    """
    package_list = _find_local(consignment, "packageList")
    if package_list is None:
        package_list = ET.SubElement(consignment, f"{{{VD_NS}}}packageList")
        package = ET.SubElement(package_list, f"{{{DICT_NS}}}package")
        node = ET.SubElement(package, f"{{{DICT_NS}}}quantity")
        node.text = format(quantity, "f")
        return
    packages = [item for item in package_list if _local(item) == "package"]
    levels: list[tuple[int, ET.Element]] = []
    for package in packages:
        level_node = _find_local(package, "level")
        if level_node is not None and (level_node.text or "").strip().isdigit():
            levels.append((int(level_node.text), package))
    targets = (
        [package for level, package in levels if level == max(level for level, _ in levels)] if levels else packages
    )
    if not targets:
        targets = [packages[0]] if packages else []
    if not targets:
        package = ET.SubElement(package_list, f"{{{DICT_NS}}}package")
        targets = [package]
    for package in targets:
        node = _find_local(package, "quantity")
        if node is None:
            node = ET.SubElement(package, f"{{{DICT_NS}}}quantity")
        node.text = format(quantity, "f")


def _purpose_identifiers(source_root: ET.Element) -> tuple[str | None, str | None]:
    """ТЗ DR8 §6.1: the source purpose GUID/UUID of the original ВСД."""
    authentication = _find_local(source_root, "authentication")
    purpose = _find_local(authentication, "purpose") if authentication is not None else None
    if purpose is None:
        return None, None
    return _desc_text(purpose, "guid"), _desc_text(purpose, "uuid")


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

    volume = intent.returned_mass_kg if returned else intent.accepted_mass_kg
    quantity = intent.returned_quantity if returned else intent.accepted_quantity
    if volume > 0:
        batch = next((item for item in source if _local(item) in {"batch", "consignment"}), None)
        if batch is None:
            raise _invalid("Исходный XML не содержит состав партии.")
        consignment = copy.deepcopy(batch)
        consignment.tag = f"{{{VD_NS}}}consignment"
        _set_volume(consignment, volume)
        if quantity > 0:
            _set_package_quantity(consignment, quantity)
        unit = _find_local(consignment, "unit")
        if unit is None:
            raise _invalid("Исходный XML не содержит единицу измерения партии.")
        unit_node = _find_local(unit, "guid")
        if unit_node is None:
            raise _invalid("Исходный XML не содержит GUID единицы измерения партии.")
        unit_node.text = intent.unit_id
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
        # ТЗ DR8 §9: the returned delivery carries the ENTERED return date.
        returned_date_node = _find_local(delivery, "deliveryDate")
        if returned_date_node is not None and intent.return_date is not None:
            returned_date_node.text = intent.return_date.astimezone(UTC).isoformat()
        authentication = copy.deepcopy(authentication_template)
        # ТЗ DR8 §6.1: the source purpose is preserved; without it no
        # incomplete return XML may be sent.
        purpose = _find_local(authentication, "purpose")
        if purpose is None:
            raise _invalid("Исходный XML не содержит назначение груза; неполный возвратный ВСД не формируется.")
        for child in list(authentication):
            if _local(child) == "specialMarks":
                authentication.remove(child)
        # ТЗ DR8 §6.2: the exact reason code first; OTHER_REASON adds its own
        # text as a separate mark. The Russian label is never sent.
        _text(authentication, VD_NS, "specialMarks", intent.return_reason_code or "")
        if intent.return_reason_code == "OTHER_REASON" and (intent.return_reason_text or "").strip():
            _text(authentication, VD_NS, "specialMarks", f"OTHER_REASON: {intent.return_reason_text.strip()}")
        certificate.append(authentication)
    return delivery


def validate_receipt_intent(intent: ReceiptIntent) -> None:
    if not all((intent.initiator.strip(), intent.receiver_enterprise_id.strip(), intent.business_member_id.strip())):
        raise _invalid("Не задан инициатор или область ВетИС; гашение не сформировано.")
    if not intent.unit_id.strip():
        raise _invalid("Единица измерения партии не задана; гашение не сформировано.")
    masses = (
        intent.documentary_mass_kg,
        intent.delivered_mass_kg,
        intent.accepted_mass_kg,
        intent.returned_mass_kg,
    )
    quantities = (
        intent.documentary_quantity,
        intent.delivered_quantity,
        intent.accepted_quantity,
        intent.returned_quantity,
    )
    if any(value < 0 for value in (*masses, *quantities)) or intent.delivered_mass_kg <= 0:
        raise _invalid("Масса продукции для гашения недействительна.")
    # ТЗ DR8 §8: the conservation holds SEPARATELY for mass and for quantity.
    if intent.accepted_mass_kg + intent.returned_mass_kg != intent.delivered_mass_kg:
        raise _invalid("Принятая и возвращаемая части не равны доставленной массе.")
    if intent.accepted_quantity + intent.returned_quantity != intent.delivered_quantity:
        raise _invalid("Принятая и возвращаемая части не равны доставленному количеству мест.")
    if intent.decision == "ACCEPT_ALL" and (
        intent.accepted_mass_kg != intent.delivered_mass_kg
        or intent.returned_mass_kg
        or intent.returned_quantity
    ):
        raise _invalid("Полное принятие не может содержать возврат.")
    if intent.decision == "PARTIALLY" and not (
        intent.accepted_mass_kg > 0
        and intent.returned_mass_kg > 0
        and intent.accepted_quantity > 0
        and intent.returned_quantity > 0
    ):
        raise _invalid("Частичное принятие требует положительные принятую и возвращаемую части.")
    if intent.decision == "RETURN_ALL" and (
        intent.accepted_mass_kg
        or intent.accepted_quantity
        or intent.returned_mass_kg != intent.delivered_mass_kg
        or intent.returned_quantity != intent.delivered_quantity
    ):
        raise _invalid("При полном возврате принятое должно быть нулевым, возвращается вся партия.")
    if intent.decision != "ACCEPT_ALL":
        if not intent.return_reason_code:
            raise _invalid("Для возврата требуется причина возврата.")
        if not (intent.return_reason_code.strip() == intent.return_reason_code and intent.return_reason_code):
            raise _invalid("Код причины возврата недопустим.")
        # ТЗ DR8 §9: the returned delivery carries the ENTERED return date.
        if intent.return_date is None:
            raise _invalid("Для возврата требуется дата возврата.")
    if intent.return_reason_code == "OTHER_REASON":
        text = (intent.return_reason_text or "").strip()
        if not text:
            raise _invalid("Для причины OTHER_REASON требуется пояснение.")
        if len(text) > 240:
            raise _invalid("Пояснение причины OTHER_REASON не должно превышать 240 символов.")
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
    # ТЗ DR8 §6.1: the returned delivery copies the source purpose; without it
    # no incomplete return XML is ever sent.
    purpose_guid, purpose_uuid = _purpose_identifiers(source_root)
    if intent.decision != "ACCEPT_ALL" and not (purpose_guid or purpose_uuid):
        raise _invalid("Исходный эВСД не содержит назначение груза; неполный возвратный ВСД не формируется.")
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
    # ТЗ DR8 §9: issueDate is the server time of the request formation; the
    # delivery and return dates are the entered dates of the operator.
    _text(application, APP_NS, "issueDate", intent.issue_date.astimezone(UTC).isoformat())
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
        # ТЗ DR8 §9: the full discrepancy report carries EVERY item with its
        # source, actual fact and reason (never only the first one).
        parts: list[str] = []
        for item in intent.discrepancy_items:
            field_id = str(item.get("field_id") or "")
            source_value = item.get("source")
            actual = item.get("actual")
            reason = str(item.get("reason") or "")
            fragment = field_id
            if source_value not in (None, ""):
                fragment = f"{fragment}: в ВСД {source_value}"
            if actual not in (None, ""):
                fragment = f"{fragment}, фактически {actual}"
            if reason:
                fragment = f"{fragment} ({reason})"
            parts.append(fragment.strip(": ,"))
        reason = ET.SubElement(report, f"{{{VD_NS}}}reason")
        _text(reason, VD_NS, "name", intent.discrepancy_items[0].get("reason") or "MISMATCH")
        _text(report, VD_NS, "info", "; ".join(parts))
    if intent.decision in {"PARTIALLY", "RETURN_ALL"}:
        _delivery(
            request,
            source,
            intent,
            returned=True,
            authentication_template=authentication_template,
        )
    return ET.tostring(root, encoding="unicode", short_empty_elements=True)
