"""ТЗ DR40 §5.3/§10-7: the targeted idempotent referenced-documents backfill.

Re-parses ONLY the direct ``vd:referencedDocument`` list (+ the compatibility
``transportDocument`` projection) from the saved raw XML; the raw XML, its
checksum, the UUID and the revisions of local facts stay untouched; a second
run changes nothing.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from backend.src.modules.arrivals.commands import upsert_incoming
from backend.src.modules.arrivals.models import IncomingDocument as IncomingDocumentRow
from backend.src.modules.arrivals.models import Party
from backend.src.modules.arrivals.schemas import (
    IncomingDocument as IncomingDocumentInput,
)
from backend.src.modules.arrivals.schemas import SourceSnapshot
from backend.src.modules.integrations.vetis.backfill import run_referenced_documents_backfill
from backend.src.modules.integrations.vetis.models import VetisContour, VetisSourceDocument
from backend.src.modules.integrations.vetis.normalizer import normalize_snapshot, parse_vet_document_list
from backend.tests.arrivals.test_dr8_unit import UNIT_GUID
from backend.tests.arrivals.test_import_and_queues import lab  # noqa: F401 - pytest fixture re-export

DOC_UUID = uuid.uuid4()


def _xml(*referenced: str) -> str:
    referenced_xml = "".join(referenced)
    return f"""
<vd:vetDocument xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
                xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
                xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
  <bs:uuid>{DOC_UUID}</bs:uuid>
  <vd:vetDType>TRANSPORT</vd:vetDType>
  <vd:vetDStatus>CONFIRMED</vd:vetDStatus>
  <vd:issueDate>2026-11-16</vd:issueDate>
  <vd:certifiedConsignment>
    <vd:consignor><dt:enterprise><bs:guid>aa367f30-9701-4c8e-b468-1fbf820d4184</bs:guid><dt:name>Отправитель</dt:name></dt:enterprise></vd:consignor>
    <vd:consignee><dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Получатель</dt:name></dt:enterprise></vd:consignee>
    <vd:batch>
      <vd:productType>1</vd:productType>
      <vd:product><bs:guid>362aa885-9b9f-ae95-05d0-f9570f4fbdc6</bs:guid><dt:name>Говядина</dt:name></vd:product>
      <vd:volume>500.0</vd:volume>
      <vd:unit><bs:guid>{UNIT_GUID}</bs:guid><dt:name>кг</dt:name></vd:unit>
    </vd:batch>
  </vd:certifiedConsignment>
  {referenced_xml}
</vd:vetDocument>
"""


def _wrap(source: str) -> str:
    return f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{source}</w>'


TTN = (
    "<vd:referencedDocument><vd:issueSeries>0006</vd:issueSeries><vd:issueNumber>5555</vd:issueNumber>"
    "<vd:issueDate>2026-11-16</vd:issueDate><vd:type>1</vd:type><vd:relationshipType>1</vd:relationshipType>"
    "</vd:referencedDocument>"
)
TORG = (
    "<vd:referencedDocument><vd:issueSeries>33333</vd:issueSeries><vd:issueNumber>66666</vd:issueNumber>"
    "<vd:issueDate>2026-11-16</vd:issueDate><vd:type>6</vd:type><vd:relationshipType>6</vd:relationshipType>"
    "</vd:referencedDocument>"
)


def _snapshot_dict() -> dict:
    return normalize_snapshot(parse_vet_document_list(_wrap(_xml()))[0]).model_dump(mode="json", by_alias=True)


async def test_backfill_fills_referenced_documents_idempotently(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine  # noqa: F811 - imported pytest fixture
) -> None:
    # A snapshot saved BEFORE the fix: no referencedDocuments at all.
    await upsert_incoming(
        db_session,
        IncomingDocumentInput(
            contour=VetisContour.PILOT,
            evsd_uuid=DOC_UUID,
            laboratory_id=lab.id,
            external_status="CONFIRMED",
            snapshot=SourceSnapshot.model_validate(_snapshot_dict()),
            fetched_at=datetime.now(UTC),
        ),
    )
    await db_session.commit()

    raw = _wrap(_xml(TTN, TORG))
    db_session.add(
        VetisSourceDocument(
            contour="PILOT",
            evsd_uuid=DOC_UUID,
            laboratory_id=lab.id,
            raw_xml=raw,
            checksum="checksum-of-the-raw-source",
        )
    )
    await db_session.commit()

    async def _document() -> IncomingDocumentRow:
        return (
            await db_session.execute(select(IncomingDocumentRow).where(IncomingDocumentRow.evsd_uuid == DOC_UUID))
        ).scalar_one()

    document = await _document()
    party_before = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    raw_before = (
        await db_session.execute(select(VetisSourceDocument.raw_xml).where(VetisSourceDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()

    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)
    counters = await run_referenced_documents_backfill(factory)
    assert counters["fixed"] == 1 and counters["error"] == 0

    db_session.expire_all()
    document = await _document()
    payload = document.source_snapshot["vdDocument"]
    documents = payload["referencedDocuments"]
    assert [item["type"] for item in documents] == ["1", "6"]
    assert documents[0]["issueSeries"] == "0006" and documents[1]["issueNumber"] == "66666"
    # The compatibility projection is recomputed from the same raw XML.
    assert payload["transportDocument"]["issueNumber"] == "5555"
    # The raw source and its checksum are never rewritten, no revision moves.
    assert raw_before == raw
    party_after = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    assert int(party_after.rev) == int(party_before.rev)

    # Idempotence: the second run changes nothing, order preserved.
    counters = await run_referenced_documents_backfill(factory)
    assert counters["fixed"] == 0 and counters["unchanged"] >= 1 and counters["error"] == 0
    db_session.expire_all()
    payload = (await _document()).source_snapshot["vdDocument"]
    assert [item["type"] for item in payload["referencedDocuments"]] == ["1", "6"]
