"""ТЗ DR19 §5.1/§7: the namespace-aware extraction of
``vd:certifiedConsignment/vd:transportInfo/vd:transportType`` and the single
Russian dictionary (codes 1–7, v2.1 included).

The raw code stays in the snapshot AS A STRING (never a number, never taken
from vehicleNumber); the Russian label is a READ projection only
(vetis.transport_types). A missing node stays absent (no fictitious mark); an
unknown future code keeps the raw code, renders the honest fallback, is never
auto-matched and never rejects the import (R-DR19-2/3). The live
``ProcessIncomingConsignment`` is never called here.
"""

from __future__ import annotations

import uuid

from backend.src.modules.integrations.vetis.contracts import VetisScope
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.normalizer import (
    filter_entries,
    normalize_snapshot,
    parse_vet_document_list,
)
from backend.src.modules.integrations.vetis.transport_types import (
    TRANSPORT_TYPE_LABELS,
    UNKNOWN_TRANSPORT_LABEL,
    transport_type_label,
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
  <vd:issueDate>2026-11-13</vd:issueDate>
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
    <vd:transportInfo>{info}</vd:transportInfo>
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


def _document(transport_type: str | None, *, with_vehicle: bool = True) -> str:
    vehicle = (
        "<vd:transportNumber><vd:vehicleNumber>А123ВВ116</vd:vehicleNumber></vd:transportNumber>"
        if with_vehicle
        else ""
    )
    type_node = "" if transport_type is None else f"<vd:transportType>{transport_type}</vd:transportType>"
    return DOC_TEMPLATE.format(info=vehicle + type_node)


def _kept_snapshot(transport_type: str | None, *, with_vehicle: bool = True):
    wrapped = (
        f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">'
        f"{_document(transport_type, with_vehicle=with_vehicle)}</w>"
    )
    entries = parse_vet_document_list(wrapped)
    kept, _, _ = filter_entries(entries, SCOPE)
    assert len(kept) == 1
    return normalize_snapshot(kept[0])


def test_dictionary_codes_1_7_have_exact_russian_names() -> None:
    assert TRANSPORT_TYPE_LABELS == {
        "1": "Автомобильный",
        "2": "Железнодорожный",
        "3": "Авиатранспортный",
        "4": "Морской (контейнер)",
        "5": "Морской (трюм)",
        "6": "Речной",  # v2.1, supported like every other code
        "7": "Перегон (скота)",  # v2.1, supported like every other code
    }


def test_code_is_kept_as_a_string_not_from_vehicle_number() -> None:
    snapshot = _kept_snapshot("1")
    # The raw code survives AS A STRING, and it is NOT the vehicle number.
    assert snapshot.vd_document.transport_type == "1"
    assert isinstance(snapshot.vd_document.transport_type, str)
    assert snapshot.vd_document.transport_number == "А123ВВ116"


def test_unknown_code_is_kept_with_honest_fallback_and_never_auto_matches() -> None:
    snapshot = _kept_snapshot("9")
    # The RAW source code survives for XML гашение and diagnostics...
    assert snapshot.vd_document.transport_type == "9"
    # ...while the Russian label is the honest fallback, never a known match.
    assert transport_type_label("9") == UNKNOWN_TRANSPORT_LABEL
    assert UNKNOWN_TRANSPORT_LABEL not in TRANSPORT_TYPE_LABELS.values()


def test_absent_node_stays_absent_even_with_a_vehicle_number() -> None:
    snapshot = _kept_snapshot(None)
    assert snapshot.vd_document.transport_type is None
    assert transport_type_label(None) is None
    assert transport_type_label("") is None
    # The vehicle number must never be converted into a transport type.
    snapshot_number_only = _kept_snapshot(None, with_vehicle=True)
    assert snapshot_number_only.vd_document.transport_type is None
