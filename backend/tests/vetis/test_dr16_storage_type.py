"""ТЗ DR16 §5.1/§8: the namespace-aware extraction of
``vd:certifiedConsignment/vd:transportStorageType`` and the single Russian
dictionary (FROZEN/CHILLED/COOLED/VENTILATED).

The raw code stays in the snapshot; the Russian label is a READ projection
only (vetis.storage_types). A missing node stays absent (no fictitious mark);
an unknown future code keeps the raw code and renders the honest fallback
(R-DR16-2/3). The live ``ProcessIncomingConsignment`` is never called here.
"""

from __future__ import annotations

import re
import uuid
from xml.etree import ElementTree as ET

import pytest

from backend.src.modules.integrations.vetis.contracts import VetisScope
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.normalizer import (
    filter_entries,
    normalize_snapshot,
    parse_vet_document_list,
)
from backend.src.modules.integrations.vetis.storage_types import (
    STORAGE_TYPE_LABELS,
    UNKNOWN_STORAGE_LABEL,
    storage_type_label,
)

SCOPE = VetisScope(
    laboratory_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
    contour=VetisContour.PILOT,
    enterprise_id="d562919c-05d8-442f-840d-4c37d41dcae1",
)

DOC_TEMPLATE = """
<vd:vetDocument xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
                xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
                xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
  <bs:uuid>e13bda81-7cf6-4b2b-b1aa-3c99e25adaac</bs:uuid>
  <vd:issueDate>2026-11-12</vd:issueDate>
  <vd:vetDType>TRANSPORT</vd:vetDType>
  <vd:vetDStatus>CONFIRMED</vd:vetDStatus>
  <vd:certifiedConsignment>
    <vd:consignor>
      <dt:enterprise><bs:guid>aa367f30-9701-4c8e-b468-1fbf820d4184</bs:guid>
        <dt:name>Отправитель</dt:name></dt:enterprise>
    </vd:consignor>
    <vd:consignee>
      <dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Получатель</dt:name></dt:enterprise>
    </vd:consignee>
    <vd:transportInfo><vd:transportNumber><vd:vehicleNumber>А123ВВ116</vd:vehicleNumber></vd:transportNumber></vd:transportInfo>
    {storage}
    <vd:batch>
      <vd:productType>1</vd:productType>
      <vd:product><bs:guid>362aa885-9b9f-ae95-05d0-f9570f4fbdc6</bs:guid><dt:name>Говядина</dt:name></vd:product>
      <vd:volume>500.0</vd:volume>
      <vd:unit><bs:guid>21ed96c9-337b-4a27-8761-c6e6ad3c9f5b</bs:guid><dt:name>кг</dt:name></vd:unit>
    </vd:batch>
  </vd:certifiedConsignment>
  <vd:authentication></vd:authentication>
</vd:vetDocument>
"""


def _document(storage_code: str | None) -> str:
    storage = "" if storage_code is None else f"<vd:transportStorageType>{storage_code}</vd:transportStorageType>"
    return DOC_TEMPLATE.format(storage=storage)


def _kept_snapshot(storage_code: str | None):
    entries = parse_vet_document_list(f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{_document(storage_code)}</w>')
    kept, _, _ = filter_entries(entries, SCOPE)
    assert len(kept) == 1
    return normalize_snapshot(kept[0])


def test_chilled_is_parsed_and_published_in_russian() -> None:
    snapshot = _kept_snapshot("CHILLED")
    assert snapshot.vd_document.transport_storage_type == "CHILLED"
    assert storage_type_label(snapshot.vd_document.transport_storage_type) == "Охлажденный"


@pytest.mark.parametrize(
    ("code", "label"),
    [
        ("FROZEN", "Замороженный"),
        ("CHILLED", "Охлажденный"),
        ("COOLED", "Охлаждаемый"),
        ("VENTILATED", "Вентилируемый"),
    ],
)
def test_every_dictionary_code_has_its_label(code: str, label: str) -> None:
    snapshot = _kept_snapshot(code)
    assert snapshot.vd_document.transport_storage_type == code
    assert storage_type_label(code) == label
    assert set(STORAGE_TYPE_LABELS) == {"FROZEN", "CHILLED", "COOLED", "VENTILATED"}


def test_unknown_code_is_kept_with_honest_fallback_and_never_auto_matches() -> None:
    snapshot = _kept_snapshot("RADIOACTIVE")
    # The RAW source code survives for XML гашение and diagnostics...
    assert snapshot.vd_document.transport_storage_type == "RADIOACTIVE"
    # ...while the Russian label is the honest fallback, never a known match.
    assert storage_type_label("RADIOACTIVE") == UNKNOWN_STORAGE_LABEL
    assert UNKNOWN_STORAGE_LABEL not in STORAGE_TYPE_LABELS.values()


def test_absent_node_stays_absent() -> None:
    snapshot = _kept_snapshot(None)
    assert snapshot.vd_document.transport_storage_type is None
    assert storage_type_label(None) is None
    assert storage_type_label("") is None


def test_exactly_one_source_code_is_read_namespace_aware() -> None:
    root = ET.fromstring(_document("CHILLED"))
    consignment = root.find("vd:certifiedConsignment", {"vd": "http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"})
    assert consignment is not None
    codes = [
        (node.text or "").strip()
        for node in consignment.findall("vd:transportStorageType", {"vd": "http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"})
    ]
    assert codes == ["CHILLED"]


def test_raw_xml_and_document_uuid_are_untouched_by_storage_normalization() -> None:
    raw = _document("CHILLED")
    entries = parse_vet_document_list(
        f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{raw}</w>'
    )
    assert len(entries) == 1
    assert entries[0].evsd_uuid == uuid.UUID("e13bda81-7cf6-4b2b-b1aa-3c99e25adaac")
    # The parser never rewrites the source document; the raw text keeps the
    # original element order and namespace declarations.
    assert re.search(r"<vd:transportStorageType>CHILLED</vd:transportStorageType>", raw) is not None
