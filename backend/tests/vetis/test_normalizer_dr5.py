"""ТЗ DR5 §14.1: the fixed incoming-XML normalizer on the REAL fixture.

The fixture is the actual incoming transport eVSD answer (item 1 of
``docs/TZ_development/plans/API REQUESTS.txt``): packageList on the maximal
level, volume 500.0, purpose GUID 0778b8cb…, UUID e13bda81….
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from backend.src.modules.arrivals.schemas import SourceSnapshot
from backend.src.modules.integrations.vetis.normalizer import (
    NormalizedEntry,
    extract_raw_documents,
    normalize_snapshot,
    package_quantity,
    parse_vet_document_list,
)
from backend.src.modules.integrations.vetis.status import status_label

DOC_UUID = "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac"
PURPOSE_UUID = "d4f9b0ea-f4d9-4cd7-92f0-016e1299160e"
PURPOSE_GUID = "0778b8cb-f49d-4ed9-88b9-5f70af00a211"

REAL_DOC = """
<vd:vetDocument xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
                xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
                xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
  <bs:uuid>e13bda81-7cf6-4b2b-b1aa-3c99e25adaac</bs:uuid>
  <vd:issueDate>2026-11-03</vd:issueDate>
  <vd:vetDForm>LIC2</vd:vetDForm>
  <vd:vetDType>TRANSPORT</vd:vetDType>
  <vd:vetDStatus>CONFIRMED</vd:vetDStatus>
  <vd:lastUpdateDate>2026-11-03T17:04:29+03:00</vd:lastUpdateDate>
  <vd:certifiedConsignment>
    <vd:consignor>
      <dt:enterprise><bs:guid>aa367f30-9701-4c8e-b468-1fbf820d4184</bs:guid>
        <dt:name>ХАЛЬФИН ФАНИС ФАНАВИЛЕВИЧ</dt:name></dt:enterprise>
    </vd:consignor>
    <vd:consignee>
      <dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Лаборатория</dt:name></dt:enterprise>
    </vd:consignee>
    <vd:transportInfo><vd:transportNumber><vd:vehicleNumber>А123АА116</vd:vehicleNumber></vd:transportNumber></vd:transportInfo>
    <vd:batch>
      <vd:productType>1</vd:productType>
      <vd:product><bs:guid>362aa885-9b9f-ae95-05d0-f9570f4fbdc6</bs:guid><dt:name>говядина</dt:name></vd:product>
      <vd:subProduct><bs:guid>db988ef9-e34c-d51e-17f8-409d23209df9</bs:guid><dt:name>говядина</dt:name></vd:subProduct>
      <vd:productItem><bs:guid>de0931d0-e29c-433a-947e-dabf540c2790</bs:guid><dt:name>говядина</dt:name></vd:productItem>
      <vd:volume>500.0</vd:volume>
      <vd:unit><bs:guid>21ed96c9-337b-4a27-8761-c6e6ad3c9f5b</bs:guid><dt:name>кг</dt:name></vd:unit>
      <vd:packageList>
        <dt:package>
          <dt:level>6</dt:level>
          <dt:packingType>
            <bs:uuid>9c777ffa-5cc7-439c-9e86-e92a36f52411</bs:uuid>
            <bs:guid>fedf6240-053c-11e1-99b4-d8d385fbc9e8</bs:guid>
            <dt:globalID>HN</dt:globalID>
            <dt:name>Крюк</dt:name>
          </dt:packingType>
          <dt:quantity>8</dt:quantity>
          <dt:productMarks class="UNDEFINED">112211</dt:productMarks>
        </dt:package>
      </vd:packageList>
    </vd:batch>
  </vd:certifiedConsignment>
  <vd:authentication>
    <vd:purpose>
      <bs:uuid>d4f9b0ea-f4d9-4cd7-92f0-016e1299160e</bs:uuid>
      <bs:guid>0778b8cb-f49d-4ed9-88b9-5f70af00a211</bs:guid>
    </vd:purpose>
  </vd:authentication>
  <vd:referencedDocument>
    <vd:issueNumber>123</vd:issueNumber>
    <vd:issueDate>2026-11-03</vd:issueDate>
  </vd:referencedDocument>
</vd:vetDocument>
"""

ENVELOPE = (
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
    '<soap:Body><receiveApplicationResultResponse '
    'xmlns="http://api.vetrf.ru/schema/cdm/application/ws-definitions">'
    '<getVetDocumentListResponse xmlns:vu="http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2">'
    '<vd:vetDocumentList count="1" total="1" offset="0" '
    'xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">'
    + REAL_DOC
    + "</vd:vetDocumentList></getVetDocumentListResponse>"
    "</receiveApplicationResultResponse></soap:Body></soap:Envelope>"
)


def parse_one(xml: str = REAL_DOC) -> NormalizedEntry:
    entries = parse_vet_document_list(f'<root xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{xml}</root>')
    assert len(entries) == 1
    return entries[0]


# --- the required proof on the real document ------------------------------------


def test_document_uuid_is_top_level_bs_uuid() -> None:
    entry = parse_one()
    assert entry.evsd_uuid == uuid.UUID(DOC_UUID)


def test_issue_date_plain() -> None:
    assert parse_one().issue_date == "2026-11-03"


def test_status_code_and_russian_label() -> None:
    entry = parse_one()
    assert entry.document_status == "CONFIRMED"
    assert status_label(entry.document_status) == "Оформлен"


def test_mass_is_volume_not_quantity() -> None:
    snapshot = normalize_snapshot(parse_one())
    batch = snapshot.vd_document.batch
    assert batch.volume == Decimal("500.0")
    assert batch.quantity == Decimal("8")


def test_package_quantity_is_eight_kryuk_and_mark() -> None:
    snapshot = normalize_snapshot(parse_one())
    package = snapshot.vd_document.batch.package_list[0]
    assert package.level == 6
    assert package.quantity == "8"
    assert package.packing_type is not None
    assert package.packing_type.name == "Крюк"
    assert package.packing_type.global_id == "HN"
    assert package.product_marks[0].value == "112211"
    assert package.product_marks[0].mark_class == "UNDEFINED"


def test_purpose_identifiers() -> None:
    snapshot = normalize_snapshot(parse_one())
    purpose = snapshot.vd_document.purpose
    assert purpose is not None
    assert str(purpose.guid) == PURPOSE_GUID
    assert str(purpose.external_uuid) == PURPOSE_UUID
    # The NAME is never written into the snapshot (dictionary owns it).
    assert "name" not in purpose.model_dump()


def test_issue_number_is_not_uuid() -> None:
    snapshot = normalize_snapshot(parse_one())
    # The referencedDocument number stays in its place; the top-level document
    # has NO issueNumber in the real answer, and the UUID is never assembled.
    assert snapshot.vd_document.issue_number == ""


def test_raw_extraction_keeps_the_document() -> None:
    raw = extract_raw_documents(ENVELOPE)
    assert set(raw) == {DOC_UUID}


def test_quantity_never_falls_back_to_volume() -> None:
    entry = parse_one()
    entry_without_packages = entry.model_copy(update={"packages": [], "package_quantity": None})
    snapshot = normalize_snapshot(entry_without_packages)
    assert snapshot.vd_document.batch.quantity is None


def test_batch_quantity_is_never_a_package_fallback() -> None:
    """§5.2: even a present `vd:batch/vd:quantity` never becomes the source quantity."""
    doc = REAL_DOC.split("<vd:packageList>")[0] + "<vd:quantity>3</vd:quantity>" + REAL_DOC.split(
        "</vd:packageList>"
    )[1]
    entry = parse_one(doc)
    assert entry.package_quantity is None
    snapshot = normalize_snapshot(entry)
    assert snapshot.vd_document.batch.quantity is None


# --- edge cases (§5.2) -----------------------------------------------------------


def _doc_with_packages(packages_xml: str) -> str:
    prefix = REAL_DOC.split("<vd:packageList>")[0]
    suffix = "</vd:packageList>" + REAL_DOC.split("</vd:packageList>")[1]
    return prefix + "<vd:packageList>" + packages_xml + suffix


def test_only_maximal_level_counts() -> None:
    xml = _doc_with_packages(
        '<dt:package><dt:level>4</dt:level><dt:packingType><dt:name>Коробка</dt:name></dt:packingType>'
        "<dt:quantity>12</dt:quantity></dt:package>"
        '<dt:package><dt:level>6</dt:level><dt:packingType><dt:name>Крюк</dt:name></dt:packingType>'
        "<dt:quantity>8</dt:quantity></dt:package>"
    )
    entry = parse_one(xml)
    assert entry.package_quantity == "8"
    assert package_quantity(entry.packages) == "8"


def test_several_packages_of_maximal_level_are_summed() -> None:
    xml = _doc_with_packages(
        '<dt:package><dt:level>6</dt:level><dt:packingType><dt:name>Крюк</dt:name></dt:packingType>'
        "<dt:quantity>5</dt:quantity></dt:package>"
        '<dt:package><dt:level>6</dt:level><dt:packingType><dt:name>Ящик</dt:name></dt:packingType>'
        "<dt:quantity>3</dt:quantity></dt:package>"
        '<dt:package><dt:level>4</dt:level><dt:packingType><dt:name>Коробка</dt:name></dt:packingType>'
        "<dt:quantity>20</dt:quantity></dt:package>"
    )
    entry = parse_one(xml)
    assert entry.package_quantity == "8"
    types = [p["packingType"]["name"] for p in entry.packages if p["level"] == 6]
    assert types == ["Крюк", "Ящик"]


def test_absent_quantity_stays_absent() -> None:
    xml = _doc_with_packages(
        '<dt:package><dt:level>6</dt:level><dt:packingType><dt:name>Крюк</dt:name></dt:packingType></dt:package>'
    )
    entry = parse_one(xml)
    assert entry.package_quantity is None
    snapshot = normalize_snapshot(entry)
    assert snapshot.vd_document.batch.quantity is None
    assert snapshot.vd_document.batch.volume == Decimal("500.0")


def test_unparseable_level_never_crashes_the_batch() -> None:
    xml = _doc_with_packages(
        '<dt:package><dt:level>abc</dt:level><dt:quantity>8</dt:quantity></dt:package>'
        '<dt:package><dt:level>6</dt:level><dt:quantity>2</dt:quantity></dt:package>'
    )
    entry = parse_one(xml)
    assert entry.package_quantity == "2"


def test_decimal_sum_has_no_float_noise() -> None:
    packages = [
        {"level": 6, "quantity": "0.1"},
        {"level": 6, "quantity": "0.2"},
    ]
    assert package_quantity(packages) == "0.3"


def test_unknown_purpose_guid_still_imports() -> None:
    xml = REAL_DOC.replace(PURPOSE_GUID, "11111111-2222-4333-8444-555555555555")
    entry = parse_one(xml)
    snapshot = normalize_snapshot(entry)
    assert str(snapshot.vd_document.purpose.guid) == "11111111-2222-4333-8444-555555555555"


def test_unknown_status_is_never_confirmed() -> None:
    xml = REAL_DOC.replace("CONFIRMED", "SOMETHING_NEW")
    entry = parse_one(xml)
    assert status_label(entry.document_status) == "Неизвестный статус"


def test_plain_date_is_not_timezone_shifted() -> None:
    entry = parse_one()
    # The plain source date is kept verbatim: no datetime, no TZ, no fake time.
    assert "T" not in (entry.issue_date or "")
    assert entry.issue_date == "2026-11-03"


def test_parsing_is_namespace_aware() -> None:
    # A document in a foreign namespace must NOT match the vd: paths.
    foreign = '<vd:vetDocument xmlns:vd="http://example.com/other"><vd:vetDType>TRANSPORT</vd:vetDType></vd:vetDocument>'
    entries = parse_vet_document_list(foreign)
    assert entries == []


def test_snapshot_model_roundtrip_keeps_packages() -> None:
    snapshot: SourceSnapshot = normalize_snapshot(parse_one())
    revalidated = SourceSnapshot.model_validate(snapshot.model_dump(mode="json", by_alias=True))
    assert revalidated.vd_document.batch.package_list[0].quantity == "8"
