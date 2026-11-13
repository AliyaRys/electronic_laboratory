"""eVSD XML normalizer (ТЗ-10 V01): source-faithful snapshot + local filters.

The normalizer preserves each classification level (``product`` / ``subProduct``
/ ``productItem``) with its OWN source ``guid``/``uuid``/``name`` — the shared
local dictionary is never consulted here and an unknown dictionary GUID never
blocks a document that carries its source name. Decimal precision is kept as
the source decimal string.

The missing server-side filters are applied LOCALLY, before anything is
persisted (plan Global Constraints / mercury-test-integration-contract):

    recipient == pinned enterprise AND INCOMING AND TRANSPORT AND CONFIRMED
    AND certifiedConsignment/batch/productType == 1

A missing/unparseable ``productType`` never counts as meat.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from xml.etree import ElementTree as ET

from pydantic import BaseModel, ConfigDict, Field

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.schemas import (
    Batch,
    ConsignorConsignee,
    ExternalRef,
    ProductMark,
    PurposeRef,
    SourceSnapshot,
    VdDocument,
)
from backend.src.modules.integrations.vetis.contracts import VetisScope
from backend.src.modules.integrations.vetis.models import VetisContour

__all__ = [
    "NormalizedEntry",
    "parse_vet_document_list",
    "normalize_snapshot",
    "filter_entries",
    "extract_raw_documents",
    "package_quantity",
]

_NS = {
    "bs": "http://api.vetrf.ru/schema/cdm/base",
    "vu": "http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2",
    "vd": "http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2",
    "dt": "http://api.vetrf.ru/schema/cdm/dictionary/v2",
    "app": "http://api.vetrf.ru/schema/cdm/application/v2",
}


class NormalizedEntry(BaseModel):
    """The parsed, still-source-faithful content of one ``vetDocument``."""

    model_config = ConfigDict(extra="forbid")

    evsd_uuid: uuid.UUID | None
    document_type: str
    document_status: str
    issue_series: str | None
    issue_number: str | None
    issue_date: str | None
    consignor: dict[str, Any]
    consignee: dict[str, Any]
    batch: dict[str, Any]
    transport_number: str | None
    # DR16: the raw vd:certifiedConsignment/vd:transportStorageType code.
    transport_storage_type: str | None = None
    trailer_number: str | None = None
    purpose_guid: str | None = None
    purpose_uuid: str | None = None
    packages: list[dict[str, Any]] = Field(default_factory=list)
    package_quantity: str | None = None


def dependency_unavailable(detail: str) -> ProblemError:
    return ProblemError(status=503, code="DEPENDENCY_UNAVAILABLE", title="Dependency unavailable", detail=detail)


def _text(element: ET.Element | None) -> str | None:
    if element is None or element.text is None:
        return None
    value = element.text.strip()
    return value or None


def _find(element: ET.Element | None, path: str) -> ET.Element | None:
    if element is None:
        return None
    return element.find(path, _NS)


def _ref(element: ET.Element | None) -> dict[str, Any]:
    if element is None:
        return {}
    return {
        "guid": _text(_find(element, "bs:guid")),
        "uuid": _text(_find(element, "bs:uuid")),
        "name": _text(_find(element, "dt:name")) or _text(_find(element, "bs:name")),
    }


def _transport_number(transport: ET.Element | None) -> str | None:
    """The vehicle-branch number of the source (ТЗ DR17 R-DR17-1).

    ``vd:trailerNumber`` is parsed SEPARATELY (``_trailer_number``) and is
    NEVER merged into this value: the doctor must see the ТС and the trailer
    as two independent source fields.
    """
    number = _find(transport, "vd:transportNumber")
    if number is None:
        return None
    for tag in ("vehicleNumber", "containerNumber", "wagonNumber", "shipName", "flightNumber"):
        value = _text(_find(number, f"vd:{tag}"))
        if value:
            return value
    return _text(number)


def _trailer_number(transport: ET.Element | None) -> str | None:
    """The separate ``vd:transportNumber/vd:trailerNumber`` source fact.

    Namespace-aware and independent from the vehicle number; an absent or
    empty node stays ABSENT (the UI text is projected later, never stored).
    """
    number = _find(transport, "vd:transportNumber")
    if number is None:
        return None
    return _text(_find(number, "vd:trailerNumber"))


def _int_text(element: ET.Element | None) -> int | None:
    """An integer source value; anything unparseable stays ABSENT (no 0, no raise)."""
    raw = _text(element)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _decimal_sum(values: list[str]) -> str | None:
    """The exact decimal sum of source strings, without float precision loss."""
    from decimal import Decimal, InvalidOperation

    total = Decimal(0)
    for value in values:
        try:
            total += Decimal(value)
        except InvalidOperation:
            return None
    rendered = format(total.normalize(), "f")
    return rendered


def package_quantity(packages: list[dict[str, Any]]) -> str | None:
    """The Mercury package-count rule: sum of ``dt:quantity`` of ONLY the
    maximal numeric ``dt:level``; different levels are never added together.

    Without a maximal level or without any populated quantity on it the source
    quantity stays ABSENT — ``volume`` is mass and is NEVER substituted.
    """
    levels = [level for level in (item.get("level") for item in packages) if isinstance(level, int)]
    if not levels:
        return None
    top = max(levels)
    quantities = [
        str(item["quantity"])
        for item in packages
        if item.get("level") == top and item.get("quantity") not in (None, "")
    ]
    if not quantities:
        return None
    return _decimal_sum(quantities)


def _packages(batch: ET.Element | None) -> list[dict[str, Any]]:
    package_list = _find(batch, "vd:packageList") if batch is not None else None
    if package_list is None:
        return []
    packages: list[dict[str, Any]] = []
    for package in package_list.findall("dt:package", _NS):
        packing = _find(package, "dt:packingType")
        packages.append(
            {
                "level": _int_text(_find(package, "dt:level")),
                "packingType": {
                    "guid": _text(_find(packing, "bs:guid")),
                    "uuid": _text(_find(packing, "bs:uuid")),
                    "name": _text(_find(packing, "dt:name")),
                    "globalID": _text(_find(packing, "dt:globalID")),
                }
                if packing is not None
                else None,
                "quantity": _text(_find(package, "dt:quantity")),
                "productMarks": [
                    {"class": mark.get("class"), "value": (mark.text or "").strip()}
                    for mark in package.findall("dt:productMarks", _NS)
                ],
            }
        )
    return packages


def _parse_document(element: ET.Element, max_depth: int) -> NormalizedEntry | None:
    if _depth(element) > max_depth:
        raise dependency_unavailable("Ответ ВетИС превышает допустимую глубину XML.")
    raw_uuid = _text(_find(element, "bs:uuid"))
    consignment = _find(element, "vd:certifiedConsignment")
    consignor = _find(consignment, "vd:consignor") if consignment is not None else None
    consignee = _find(consignment, "vd:consignee") if consignment is not None else None
    batch = _find(consignment, "vd:batch") if consignment is not None else None
    transport = _find(consignment, "vd:transportInfo") if consignment is not None else None
    try:
        evsd_uuid = uuid.UUID(raw_uuid) if raw_uuid else None
    except ValueError:
        evsd_uuid = None
    volume = _text(_find(batch, "vd:volume")) if batch is not None else None
    quantity = _text(_find(batch, "vd:quantity")) if batch is not None else None
    product_type = _text(_find(batch, "vd:productType")) if batch is not None else None
    packages = _packages(batch)
    authentication = _find(element, "vd:authentication")
    purpose = _find(authentication, "vd:purpose") if authentication is not None else None
    return NormalizedEntry(
        evsd_uuid=evsd_uuid,
        document_type=_text(_find(element, "vd:vetDType")) or "",
        document_status=_text(_find(element, "vd:vetDStatus")) or "",
        issue_series=_text(_find(element, "vd:issueSeries")),
        issue_number=_text(_find(element, "vd:issueNumber")),
        issue_date=_text(_find(element, "vd:issueDate")),
        consignor={
            "name": _text(_find(consignor, "dt:name")) if consignor is not None else None,
            "businessEntity": _ref(_find(consignor, "dt:businessEntity")),
            "enterprise": _ref(_find(consignor, "dt:enterprise")),
        },
        consignee={
            "name": _text(_find(consignee, "dt:name")) if consignee is not None else None,
            "businessEntity": _ref(_find(consignee, "dt:businessEntity")),
            "enterprise": _ref(_find(consignee, "dt:enterprise")),
        },
        batch={
            "productType": product_type,
            "product": _ref(_find(batch, "vd:product")),
            "subProduct": _ref(_find(batch, "vd:subProduct")),
            "productItem": _ref(_find(batch, "vd:productItem")),
            "volume": volume,
            "quantity": quantity,
            "unit": _ref(_find(batch, "vd:unit")),
            "packageList": packages,
        },
        transport_number=_transport_number(transport),
        transport_storage_type=_text(_find(consignment, "vd:transportStorageType")),
        trailer_number=_trailer_number(transport),
        purpose_guid=_text(_find(purpose, "bs:guid")),
        purpose_uuid=_text(_find(purpose, "bs:uuid")),
        packages=packages,
        package_quantity=package_quantity(packages),
    )


def _depth(element: ET.Element) -> int:
    return 1 + max((_depth(child) for child in element), default=0)


def parse_vet_document_list(
    result_xml: str, *, xml_max_bytes: int = 32 * 1024 * 1024, xml_max_depth: int = 128
) -> list[NormalizedEntry]:
    """Parse a receiveApplicationResult page into source-faithful entries."""
    if len(result_xml.encode("utf-8")) > xml_max_bytes:
        raise dependency_unavailable("Ответ ВетИС превышает допустимый размер XML (32 МиБ).")
    try:
        root = ET.fromstring(result_xml)
    except ET.ParseError as exc:
        raise dependency_unavailable("Ответ ВетИС не является корректным XML.") from exc
    if _depth(root) > xml_max_depth:
        raise dependency_unavailable("Ответ ВетИС превышает допустимую глубину XML.")
    entries: list[NormalizedEntry] = []
    for element in root.findall(".//vd:vetDocument", _NS):
        entry = _parse_document(element, xml_max_depth)
        if entry is not None:
            entries.append(entry)
    return entries


def extract_raw_documents(result_xml: str) -> dict[str, str]:
    """The raw ``vetDocument`` XML per external UUID (ТЗ-10 V02 journal).

    The subtree is serialized exactly as received (namespaces and all); the
    raw source stays inside the vetis package and is journalled by the sync
    worker with a checksum per external UUID.
    """
    root = ET.fromstring(result_xml)
    raw: dict[str, str] = {}
    for element in root.findall(".//vd:vetDocument", _NS):
        uuid_text = _text(_find(element, "bs:uuid"))
        if uuid_text:
            raw[uuid_text] = ET.tostring(element, encoding="unicode")
    return raw


def _participant(raw: dict[str, Any]) -> dict[str, str | None]:
    entity = raw.get("businessEntity") or {}
    enterprise = raw.get("enterprise") or {}
    return {
        "name": raw.get("name") or enterprise.get("name") or entity.get("name"),
        "guid": entity.get("guid"),
        "uuid": entity.get("uuid"),
        "enterprise_guid": enterprise.get("guid"),
        # ТЗ DR18 §7: the enterprise object keeps its own uuid — the name
        # cache stores it per (contour, kind, guid), never merged with the
        # businessEntity identity.
        "enterprise_uuid": enterprise.get("uuid"),
    }


def filter_entries(
    entries: list[NormalizedEntry], scope: VetisScope
) -> tuple[list[NormalizedEntry], dict[str, int], dict[str, list[str]]]:
    """Apply the locally-enforced predicate; return (kept, counters, filtered UUIDs).

    Unsuitable receiver / non-transport / non-CONFIRMED / ``productType != 1``
    (including a missing or unparseable type) are filtered before persisting.
    The filtered external UUIDs are returned BY REASON (ТЗ DR9 §5): the sync
    needs the FULL observed set (kept + filtered + errors), never only the
    imported documents, so a full pass can honestly mark staleness.
    """
    kept: list[NormalizedEntry] = []
    filtered = {"receiver": 0, "transport": 0, "status": 0, "product_type": 0}
    filtered_documents: dict[str, list[str]] = {}
    for entry in entries:
        consignee = _participant(entry.consignee)
        enterprise_guid = consignee.get("enterprise_guid")
        reason: str | None = None
        if not enterprise_guid or enterprise_guid != scope.enterprise_id:
            reason = "receiver"
        elif entry.document_type != "TRANSPORT":
            reason = "transport"
        elif entry.document_status != "CONFIRMED":
            reason = "status"
        else:
            batch = entry.batch
            product_type = batch.get("productType")
            if not isinstance(product_type, str) or product_type.strip() != "1":
                reason = "product_type"
        if reason is not None:
            filtered[reason] += 1
            if entry.evsd_uuid is not None:
                filtered_documents.setdefault(reason, []).append(str(entry.evsd_uuid))
            continue
        kept.append(entry)
    return kept, filtered, filtered_documents


def normalize_snapshot(entry: NormalizedEntry) -> SourceSnapshot:
    """Build the DATA-02 ``source_snapshot`` from one kept entry."""
    consignor = _participant(entry.consignor)
    consignee = _participant(entry.consignee)
    batch = entry.batch

    def _external_ref(raw: object) -> ExternalRef | None:
        if not isinstance(raw, dict):
            return None
        guid = raw.get("guid")
        ref_uuid = raw.get("uuid")
        name = raw.get("name")
        global_id = raw.get("globalID")
        if guid is None and ref_uuid is None and name is None and global_id is None:
            return None
        return ExternalRef.model_validate(
            {
                "guid": str(guid) if guid else None,
                "uuid": str(ref_uuid) if ref_uuid else None,
                "name": name,
                "globalID": global_id,
            }
        )

    volume = batch.get("volume")
    # §5.2: source quantity comes ONLY from the package list of the top packing
    # level; `vd:batch/vd:quantity` is never substituted (no fallback at all).
    package_quantity_value = entry.package_quantity
    package_entries = []
    for package in entry.packages:
        packing = package.get("packingType") or {}
        package_entries.append(
            {
                "level": package.get("level"),
                "packingType": _external_ref(packing),
                "quantity": package.get("quantity"),
                "productMarks": [
                    ProductMark.model_validate(mark) for mark in (package.get("productMarks") or [])
                ],
            }
        )
    purpose = PurposeRef(
        guid=uuid.UUID(entry.purpose_guid) if entry.purpose_guid else None,
        external_uuid=uuid.UUID(entry.purpose_uuid) if entry.purpose_uuid else None,
    )
    return SourceSnapshot(
        vd_document=VdDocument(
            type=entry.document_type,
            status=entry.document_status,
            issue_series=entry.issue_series,
            issue_number=entry.issue_number or "",
            issue_date=entry.issue_date,
            consignor=ConsignorConsignee(
                name=consignor["name"] or "",
                business_entity=_external_ref(
                    {"guid": consignor.get("guid"), "uuid": consignor.get("uuid"), "name": consignor["name"]}
                ),
                enterprise=_external_ref(
                    {
                        "guid": consignor.get("enterprise_guid"),
                        "uuid": consignor.get("enterprise_uuid"),
                        "name": consignor["name"],
                    }
                ),
            ),
            consignee=ConsignorConsignee(
                name=consignee["name"] or "",
                business_entity=_external_ref(
                    {"guid": consignee.get("guid"), "uuid": consignee.get("uuid"), "name": consignee["name"]}
                ),
                enterprise=_external_ref(
                    {
                        "guid": consignee.get("enterprise_guid"),
                        "uuid": consignee.get("enterprise_uuid"),
                        "name": consignee["name"],
                    }
                ),
            ),
            batch=Batch(
                product=_external_ref(batch["product"]) or ExternalRef(),
                sub_product=_external_ref(batch["subProduct"]),
                product_item=_external_ref(batch["productItem"]),
                volume=volume or "0",
                quantity=package_quantity_value,
                unit=_external_ref(batch["unit"]),
                package_list=package_entries,
            ),
            transport_number=entry.transport_number,
            transport_storage_type=entry.transport_storage_type,
            trailer_number=entry.trailer_number,
            purpose=purpose if (purpose.guid or purpose.external_uuid) else None,
        ),
        vet_documents=[],
    )


def normalize_document(
    entry: NormalizedEntry,
    *,
    contour: VetisContour,
    laboratory_id: uuid.UUID | None,
    fetched_at: datetime,
) -> tuple[uuid.UUID | None, str, SourceSnapshot]:
    """Return (evsd_uuid, external_status, snapshot) for the arrivals upsert DTO."""
    return entry.evsd_uuid, entry.document_status, normalize_snapshot(entry)
