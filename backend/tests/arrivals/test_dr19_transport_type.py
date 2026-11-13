"""ТЗ DR19 §4.2/§6/§7: the CHK-F09 «Вид транспорта» projection, external
fields, validation matrix and the idempotent backfill of already saved raw
XML.

The read model publishes ``transportTypeCode`` (the raw string code) and
``transportType`` (the Russian label) separately; ``source_projection``
publishes ``transportKind`` from the SAME dictionary (no second dictionary).
The backfill repairs only the derived snapshot field: raw XML, checksum, UUID
and local facts are untouched (R-DR19-4).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from backend.src.modules.arrivals import commands, queries
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.arrivals.reconciliation import source_projection
from backend.src.modules.arrivals.schemas import (
    ClassificationEntry,
    ClassificationView,
    Comparison,
    QuantitySet,
    ReconciliationWrite,
    SourceSnapshot,
    Transaction,
)
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentInput
from backend.src.modules.arrivals.validation import (
    FIELD_REGISTRY,
    ReceiptCapabilities,
    validate_receipt,
)
from backend.src.modules.arrivals.validation import (
    IncomingDocument as SourceProjection,
)
from backend.src.modules.integrations.vetis.backfill import run_backfill
from backend.src.modules.integrations.vetis.models import VetisContour, VetisSourceDocument
from backend.src.modules.integrations.vetis.normalizer import normalize_snapshot, parse_vet_document_list
from backend.src.modules.integrations.vetis.transport_types import UNKNOWN_TRANSPORT_LABEL

DOC_UUID = uuid.UUID("e13bda81-7cf6-4b2b-b1aa-3c99e25adaac")
TYPE_DOC_TEMPLATE = """
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
      <dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Лаборатория</dt:name></dt:enterprise>
    </vd:consignee>
    <vd:transportInfo><vd:transportNumber><vd:vehicleNumber>А123ВВ116</vd:vehicleNumber></vd:transportNumber>{type_node}</vd:transportInfo>
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


def snapshot_with_type(transport_type: str | None) -> SourceSnapshot:
    type_node = "" if transport_type is None else f"<vd:transportType>{transport_type}</vd:transportType>"
    wrapped = f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{TYPE_DOC_TEMPLATE.format(type_node=type_node)}</w>'
    entries = parse_vet_document_list(wrapped)
    assert len(entries) == 1
    return normalize_snapshot(entries[0])


def document_input(laboratory_id: uuid.UUID, transport_type: str | None) -> IncomingDocumentInput:
    return IncomingDocumentInput(
        contour=VetisContour.PILOT,
        evsd_uuid=DOC_UUID,
        laboratory_id=laboratory_id,
        external_status="CONFIRMED",
        snapshot=snapshot_with_type(transport_type),
        fetched_at=datetime.now(UTC),
    )


@pytest.fixture
async def lab(db_session: AsyncSession):
    from backend.src.modules.identity.models import Laboratory, Territory

    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(territory_id=territory.id, name="Лаб", address="ул.", organization="ГБУ")
    db_session.add(laboratory)
    await db_session.commit()
    return laboratory


# --- §4.2 source projection -----------------------------------------------------------


async def test_projection_publishes_code_and_label_from_one_dictionary(db_session: AsyncSession, lab) -> None:
    await commands.upsert_incoming(db_session, document_input(lab.id, "1"))
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    party = (await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))).scalar_one()
    projection = source_projection(document, party).fields
    # The validator key comes from the SAME dictionary (no second one).
    assert projection["transportKind"] == "Автомобильный"


async def test_projection_absent_and_unknown_are_honest(db_session: AsyncSession, lab) -> None:
    await commands.upsert_incoming(db_session, document_input(lab.id, None))
    await commands.upsert_incoming(
        db_session,
        document_input(lab.id, "9").model_copy(update={"evsd_uuid": uuid.UUID("e13bda81-7cf6-4b2b-b1aa-3c99e25adaad")}),
    )
    await db_session.commit()
    absent = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    absent_party = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == absent.id))
    ).scalar_one()
    assert source_projection(absent, absent_party).fields["transportKind"] is None
    unknown = (
        await db_session.execute(
            select(IncomingDocument).where(
                IncomingDocument.evsd_uuid == uuid.UUID("e13bda81-7cf6-4b2b-b1aa-3c99e25adaad")
            )
        )
    ).scalar_one()
    unknown_party = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == unknown.id))
    ).scalar_one()
    assert source_projection(unknown, unknown_party).fields["transportKind"] == UNKNOWN_TRANSPORT_LABEL


# --- §4.2 external fields ---------------------------------------------------------------


async def test_external_fields_carry_transport_type_code_and_label(db_session: AsyncSession, lab) -> None:
    party = await commands.upsert_incoming(db_session, document_input(lab.id, "1"))
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    view = await queries.build_incoming_view(db_session, party, document)
    fields = view.external.fields
    assert fields["transportTypeCode"] == "1"
    assert fields["transportType"] == "Автомобильный"


# --- §6 validation matrix -----------------------------------------------------------------


def _payload(checks: dict[str, Comparison]) -> ReconciliationWrite:
    unit = uuid.uuid4()
    return ReconciliationWrite(
        checks=checks,
        delivered=QuantitySet(mass_kg="500.0", quantity="0", unit_id=str(unit)),
        accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=str(unit)),
        returned=QuantitySet(mass_kg="500.0", quantity="0", unit_id=str(unit)),
        decision="RETURN_ALL",
        return_reason=None,
        repeat=None,
        transaction=Transaction(planned=False),
        fair=False,
        services=[],
    )


def _source(transport_kind: str | None) -> SourceProjection:
    classification = ClassificationView(
        product=ClassificationEntry(id="p", name="Говядина"),
    )
    fields: dict[str, str | int | None] = {"massKg": "500.0"}
    if transport_kind is not None:
        fields["transportKind"] = transport_kind
    return SourceProjection(snapshot=snapshot_with_type(None), classification=classification, fields=fields)


def test_chk_f09_is_an_inadmissible_transport_ground() -> None:
    spec = FIELD_REGISTRY["CHK-F09"]
    assert spec.key == "transportKind"
    assert spec.block == "транспорт"
    assert spec.ground == "inadmissible"


def test_chk_f09_mismatch_requires_actual_and_reason() -> None:
    source = _source("Автомобильный")
    payload = _payload({"CHK-F09": Comparison(matches=False)})
    validation = validate_receipt(payload, source, ReceiptCapabilities())
    messages = " | ".join(item.message for item in validation.all_errors())
    assert "фактическое значение" in messages
    assert "причина" in messages


def test_chk_f09_absent_value_demands_no_mark() -> None:
    source = _source(None)
    payload = _payload({})
    validation = validate_receipt(payload, source, ReceiptCapabilities())
    messages = " | ".join(item.message for item in validation.all_errors())
    assert "CHK-F09" not in messages
    fictive = _payload({"CHK-F09": Comparison(matches=True)})
    validation = validate_receipt(fictive, source, ReceiptCapabilities())
    assert any(item.field_id == "CHK-F09" for item in validation.blocking)


# --- §4.2 backfill --------------------------------------------------------------------------


def _factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def test_backfill_adds_transport_type_without_touching_checksum(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine
) -> None:
    # A saved document whose snapshot predates the DR19 normalizer: no type.
    stale = snapshot_with_type(None)
    await commands.upsert_incoming(
        db_session,
        IncomingDocumentInput(
            contour=VetisContour.PILOT,
            evsd_uuid=DOC_UUID,
            laboratory_id=lab.id,
            external_status="CONFIRMED",
            snapshot=stale,
            fetched_at=datetime.now(UTC),
        ),
    )
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    raw_xml = TYPE_DOC_TEMPLATE.format(type_node="<vd:transportType>1</vd:transportType>")
    source_row = VetisSourceDocument(
        contour="PILOT",
        evsd_uuid=DOC_UUID,
        laboratory_id=lab.id,
        raw_xml=raw_xml,
        checksum="checksum-of-the-raw-source",
    )
    db_session.add(source_row)
    await db_session.commit()
    checksum_before = source_row.checksum

    counters = await run_backfill(_factory(test_db_engine))
    assert counters["viewed"] == 1 and counters["fixed"] == 1 and counters["error"] == 0

    db_session.expire_all()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    payload = document.source_snapshot["vdDocument"]
    assert payload["transportType"] == "1"
    row = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert row.checksum == checksum_before  # the raw source is untouched
    assert row.raw_xml == raw_xml

    # Idempotence: a second run makes zero changes.
    counters = await run_backfill(_factory(test_db_engine))
    assert counters["viewed"] == 1 and counters["fixed"] == 0 and counters["error"] == 0
