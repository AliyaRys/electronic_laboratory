"""ТЗ DR16 §5.2/§5.3/§7/§8: the CHK-F12 storage projection, the
IncomingView/external fields keys, the validator's decision matrix for a
CHK-F12 mismatch and the idempotent backfill of already saved raw XML.

The raw ``storageCode`` and the Russian ``storage`` label are published
SEPARATELY (R-DR16-1/4); an absent node never demands a fictitious mark
(R-DR16-3); the backfill re-derives only the snapshot storage field and never
touches the raw XML checksum or local facts (R-DR16-4).
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
from backend.src.modules.integrations.vetis.storage_types import UNKNOWN_STORAGE_LABEL

DOC_UUID = uuid.UUID("e13bda81-7cf6-4b2b-b1aa-3c99e25adaac")
STORAGE_DOC_TEMPLATE = """
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
      <dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Лаборатория</dt:name></dt:enterprise>
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


def snapshot_with_storage(storage_code: str | None) -> SourceSnapshot:
    storage = "" if storage_code is None else f"<vd:transportStorageType>{storage_code}</vd:transportStorageType>"
    wrapped = f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{STORAGE_DOC_TEMPLATE.format(storage=storage)}</w>'
    entries = parse_vet_document_list(wrapped)
    assert len(entries) == 1
    return normalize_snapshot(entries[0])


def document_input(laboratory_id: uuid.UUID, storage_code: str | None) -> IncomingDocumentInput:
    return IncomingDocumentInput(
        contour=VetisContour.PILOT,
        evsd_uuid=DOC_UUID,
        laboratory_id=laboratory_id,
        external_status="CONFIRMED",
        snapshot=snapshot_with_storage(storage_code),
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


# --- §5.2 projection ----------------------------------------------------------------


async def test_projection_publishes_code_and_russian_label_separately(db_session: AsyncSession, lab) -> None:
    await commands.upsert_incoming(db_session, document_input(lab.id, "CHILLED"))
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    party = (await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))).scalar_one()
    fields = source_projection(document, party).fields
    assert fields["storageCode"] == "CHILLED"
    assert fields["storage"] == "Охлажденный"


async def test_projection_absent_node_stays_absent(db_session: AsyncSession, lab) -> None:
    await commands.upsert_incoming(db_session, document_input(lab.id, None))
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    party = (await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))).scalar_one()
    fields = source_projection(document, party).fields
    assert fields["storageCode"] is None
    assert fields["storage"] is None


async def test_projection_unknown_code_is_present_with_fallback_label(db_session: AsyncSession, lab) -> None:
    await commands.upsert_incoming(db_session, document_input(lab.id, "RADIOACTIVE"))
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    party = (await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))).scalar_one()
    fields = source_projection(document, party).fields
    assert fields["storageCode"] == "RADIOACTIVE"
    assert fields["storage"] == UNKNOWN_STORAGE_LABEL


# --- §5.3 external fields ------------------------------------------------------------


async def test_external_fields_carry_storage_code_and_label(db_session: AsyncSession, lab) -> None:
    party = await commands.upsert_incoming(db_session, document_input(lab.id, "CHILLED"))
    await db_session.commit()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    view = await queries.build_incoming_view(db_session, party, document)
    fields = view.external.fields
    assert fields["storageCode"] == "CHILLED"
    assert fields["storage"] == "Охлажденный"


# --- §6/§8 validation matrix -----------------------------------------------------------


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


def _source(storage: str | None) -> SourceProjection:
    """A minimal IncomingDocument source projection carrying only the storage field."""
    classification = ClassificationView(
        product=ClassificationEntry(id="p", name="Говядина"),
    )
    fields: dict[str, str | int | None] = {"massKg": "500.0"}
    if storage is not None:
        fields["storage"] = storage
    return SourceProjection(snapshot=snapshot_with_storage(None), classification=classification, fields=fields)


def test_chk_f12_mismatch_restricts_decisions() -> None:
    source = _source("Охлажденный")
    payload = _payload(
        {"CHK-F12": Comparison(matches=False, actual="Замороженный", reason="Термограф показывает оттайку")}
    )
    validation = validate_receipt(payload, source, ReceiptCapabilities())
    assert validation.allowed_decisions == ["RETURN_ALL"]


def test_chk_f12_mismatch_requires_actual_and_reason() -> None:
    source = _source("Охлажденный")
    payload = _payload({"CHK-F12": Comparison(matches=False)})
    validation = validate_receipt(payload, source, ReceiptCapabilities())
    messages = " | ".join(item.message for item in validation.all_errors())
    assert "фактическое значение" in messages
    assert "причина" in messages


def test_chk_f12_absent_value_demands_no_mark() -> None:
    source = _source(None)
    payload = _payload({})
    validation = validate_receipt(payload, source, ReceiptCapabilities())
    messages = " | ".join(item.message for item in validation.all_errors())
    assert "CHK-F12" not in messages
    # A fictitious mark on an absent field is refused.
    fictive = _payload({"CHK-F12": Comparison(matches=True)})
    validation = validate_receipt(fictive, source, ReceiptCapabilities())
    assert any(item.field_id == "CHK-F12" for item in validation.blocking)


def test_chk_f12_registry_is_inadmissible_transport_ground() -> None:
    spec = FIELD_REGISTRY["CHK-F12"]
    assert spec.key == "storage"
    assert spec.block == "транспорт"
    assert spec.ground == "inadmissible"


# --- §5.3 backfill ---------------------------------------------------------------------


def _factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def test_backfill_adds_storage_without_touching_checksum(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine
) -> None:
    # A saved document whose snapshot predates the DR16 normalizer: no storage.
    stale = snapshot_with_storage(None)
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
    raw_xml = STORAGE_DOC_TEMPLATE.format(storage="<vd:transportStorageType>CHILLED</vd:transportStorageType>")
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
    assert payload["transportStorageType"] == "CHILLED"
    row = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert row.checksum == checksum_before == "checksum-of-the-raw-source"
    assert row.raw_xml == raw_xml

    # The second run is idempotent: zero changes.
    counters = await run_backfill(_factory(test_db_engine))
    assert counters["fixed"] == 0 and counters["unchanged"] == 1 and counters["error"] == 0
