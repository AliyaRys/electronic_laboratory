"""ТЗ DR20 §6/§8/§9: the CHK-F22/F23 read model, validation and backfill.

- the source projection publishes ``producedOn(From/To/Informal)`` and
  ``expiresOn(From/To/Informal)`` with the source value TYPE intact (§6);
- an absent source date creates no fictitious mandatory mark (FT-ARR-03);
- a mismatch demands the actual date and the reason (CHK-F42/F43);
- the strict calendar validation refuses a non-date fact and an expiry
  earlier than the production date (§8);
- the targeted backfill re-parses ONLY the two date fields from the saved
  raw XML, keeps raw XML/checksum/UUID/revision/local facts untouched and is
  idempotent (§5.3).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from backend.src.modules.arrivals.commands import upsert_incoming
from backend.src.modules.arrivals.models import IncomingDocument as IncomingDocumentRow
from backend.src.modules.arrivals.models import Party
from backend.src.modules.arrivals.reconciliation import source_projection
from backend.src.modules.arrivals.schemas import (
    Comparison,
    QuantitySet,
    ReconciliationWrite,
    SourceSnapshot,
)
from backend.src.modules.arrivals.schemas import (
    IncomingDocument as IncomingDocumentInput,
)
from backend.src.modules.arrivals.validation import ReceiptCapabilities, validate_receipt
from backend.src.modules.integrations.vetis.backfill import run_goods_date_backfill
from backend.src.modules.integrations.vetis.models import VetisContour, VetisSourceDocument
from backend.src.modules.integrations.vetis.normalizer import (
    normalize_snapshot,
    parse_vet_document_list,
)
from backend.tests.arrivals.test_dr8_unit import UNIT_GUID
from backend.tests.arrivals.test_import_and_queues import lab  # noqa: F401 - pytest fixture re-export

DOC_UUID = uuid.uuid4()


def _xml(production: str, expiry: str) -> str:
    """An anonymized transport eVSD with the given date XML fragments."""
    return f"""
<vd:vetDocument xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
                xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
                xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
  <bs:uuid>{DOC_UUID}</bs:uuid>
  <vd:vetDType>TRANSPORT</vd:vetDType>
  <vd:vetDStatus>CONFIRMED</vd:vetDStatus>
  <vd:issueDate>2026-11-12</vd:issueDate>
  <vd:certifiedConsignment>
    <vd:consignor><dt:enterprise><bs:guid>aa367f30-9701-4c8e-b468-1fbf820d4184</bs:guid><dt:name>Отправитель</dt:name></dt:enterprise></vd:consignor>
    <vd:consignee><dt:enterprise><bs:guid>d562919c-05d8-442f-840d-4c37d41dcae1</bs:guid><dt:name>Получатель</dt:name></dt:enterprise></vd:consignee>
    <vd:transportInfo><vd:transportNumber><vd:vehicleNumber>А123ВВ116</vd:vehicleNumber></vd:transportNumber></vd:transportInfo>
    <vd:batch>
      <vd:productType>1</vd:productType>
      <vd:product><bs:guid>362aa885-9b9f-ae95-05d0-f9570f4fbdc6</bs:guid><dt:name>Говядина</dt:name></vd:product>
      <vd:volume>500.0</vd:volume>
      <vd:unit><bs:guid>{UNIT_GUID}</bs:guid><dt:name>кг</dt:name></vd:unit>
      {production}
      {expiry}
    </vd:batch>
  </vd:certifiedConsignment>
</vd:vetDocument>
"""


def _wrap(source: str) -> str:
    return f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{source}</w>'


SINGLE_DATES = """
<vd:dateOfProduction>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>3</dt:day><dt:hour>0</dt:hour></vd:firstDate>
</vd:dateOfProduction>
<vd:expiryDate>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>10</dt:day><dt:hour>0</dt:hour></vd:firstDate>
</vd:expiryDate>
"""
INTERVAL_DATES = """
<vd:dateOfProduction>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>3</dt:day><dt:hour>0</dt:hour></vd:firstDate>
  <vd:secondDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>5</dt:day><dt:hour>0</dt:hour></vd:secondDate>
</vd:dateOfProduction>
<vd:expiryDate>
  <vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>10</dt:day><dt:hour>0</dt:hour></vd:firstDate>
  <vd:secondDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>16</dt:day><dt:hour>0</dt:hour></vd:secondDate>
</vd:expiryDate>
"""


def _snapshot_dict(production: str, expiry: str) -> dict:
    return normalize_snapshot(parse_vet_document_list(_wrap(_xml(production, expiry)))[0]).model_dump(
        mode="json", by_alias=True
    )


def _row(production: str, expiry: str) -> IncomingDocumentRow:
    return IncomingDocumentRow(
        contour=VetisContour.PILOT,
        evsd_uuid=DOC_UUID,
        laboratory_id=uuid.uuid4(),
        external_status="CONFIRMED",
        source_snapshot=_snapshot_dict(production, expiry),
        content_hash="d" * 64,
        fetched_at=datetime.now(UTC),
    )


def _party() -> Party:
    return Party(
        incoming_document_id=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        classification_snapshot={
            "product": {"id": "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", "name": "говядина"},
            "unit": {"id": UNIT_GUID, "name": "кг"},
        },
        rev=1,
        created_at=datetime.now(UTC),
    )


def _payload(checks: dict[str, Comparison]) -> ReconciliationWrite:
    return ReconciliationWrite.model_validate(
        {
            "checks": checks,
            "inspection": {"compartment": "COMPLIANT", "jointCarriage": "NONE"},
            "delivered": QuantitySet(mass_kg="500.0", quantity="0", unit_id=UNIT_GUID),
            "accepted": QuantitySet(mass_kg="500.0", quantity="0", unit_id=UNIT_GUID),
            "returned": QuantitySet(mass_kg="0", quantity="0", unit_id=UNIT_GUID),
            "decision": "ACCEPT_ALL",
            "transaction": {"planned": False},
            "fair": False,
            "services": [],
        }
    )


CAPS = ReceiptCapabilities()


# --- §9-6: CHK-F22/F23 appear in the source projection -----------------------------


def test_projection_publishes_single_dates_in_machine_readable_form() -> None:
    fields = source_projection(_row(SINGLE_DATES, ""), _party()).fields
    # The single production date: producedOn only, the interval keys stay null.
    assert fields["producedOn"] == "2026-11-03"
    assert fields["producedOnFrom"] is None
    assert fields["producedOnTo"] is None
    assert fields["producedOnInformal"] is None
    assert fields["expiresOn"] == "2026-11-10"
    assert fields["expiresOnFrom"] is None
    assert fields["expiresOnTo"] is None
    assert fields["expiresOnInformal"] is None


def test_projection_keeps_the_interval_type_without_collapse() -> None:
    fields = source_projection(_row(INTERVAL_DATES, ""), _party()).fields
    assert fields["producedOn"] is None
    assert fields["producedOnFrom"] == "2026-11-03"
    assert fields["producedOnTo"] == "2026-11-05"
    assert fields["expiresOnFrom"] == "2026-11-10"
    assert fields["expiresOnTo"] == "2026-11-16"


def test_projection_publishes_the_informal_text() -> None:
    fields = source_projection(
        _row("", "<vd:expiryDate><vd:informalDate>до конца месяца</vd:informalDate></vd:expiryDate>"), _party()
    ).fields
    assert fields["expiresOnInformal"] == "до конца месяца"
    assert fields["expiresOn"] is None
    assert fields["expiresOnFrom"] is None


# --- §9-7: absent fields create no fictitious mark ---------------------------------


def test_absent_dates_demand_no_mark_and_fictive_mark_is_refused() -> None:
    source = source_projection(_row("", ""), _party())
    result = validate_receipt(_payload({}), source, CAPS)
    assert all(item.field_id not in ("CHK-F22", "CHK-F23") for item in result.all_errors())  # type: ignore[attr-defined]
    # A mark on an absent source value is a blocking structural violation.
    result = validate_receipt(_payload({"CHK-F22": Comparison(matches=True)}), source, CAPS)
    assert any(item.field_id == "CHK-F22" for item in result.blocking)  # type: ignore[attr-defined]


# --- §9-8: a mismatch requires the actual date and the reason ----------------------


def test_date_mismatch_requires_actual_and_reason() -> None:
    source = source_projection(_row(SINGLE_DATES, ""), _party())
    result = validate_receipt(_payload({"CHK-F22": Comparison(matches=False)}), source, CAPS)
    ids = {item.field_id for item in result.all_errors()}  # type: ignore[attr-defined]
    assert "CHK-F42" in ids
    assert "CHK-F43" in ids
    result = validate_receipt(
        _payload({"CHK-F22": Comparison(matches=False, actual="2026-11-04", reason="Дата отличается")}),
        source,
        CAPS,
    )
    assert all(item.field_id != "CHK-F22" for item in result.all_errors())  # type: ignore[attr-defined]
    # The marked mismatch participates in the derived act (CHK-F44) with
    # source, actual and reason.
    item = next(item for item in result.act.items if item.field_id == "CHK-F22")  # type: ignore[attr-defined]
    assert item.source == "2026-11-03"
    assert item.actual == "2026-11-04"
    assert item.reason == "Дата отличается"


# --- §9-8b/§8: the strict calendar validation --------------------------------------


def test_non_date_fact_is_refused_with_a_clear_error() -> None:
    source = source_projection(_row(SINGLE_DATES, ""), _party())
    result = validate_receipt(
        _payload({"CHK-F22": Comparison(matches=False, actual="3 ноября", reason="Дата отличается")}),
        source,
        CAPS,
    )
    assert any(
        item.field_id == "CHK-F22" and "календарной датой" in item.message
        for item in result.blocking  # type: ignore[attr-defined]
    )


# --- §9-9: expiry earlier than production is blocked with a clear error ------------


def test_expiry_before_production_is_blocked() -> None:
    source = source_projection(
        _row(
            "<vd:dateOfProduction><vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>10</dt:day></vd:firstDate></vd:dateOfProduction>",
            "<vd:expiryDate><vd:firstDate><dt:year>2026</dt:year><dt:month>11</dt:month><dt:day>3</dt:day></vd:firstDate></vd:expiryDate>",
        ),
        _party(),
    )
    result = validate_receipt(_payload({}), source, CAPS)
    assert any(
        item.field_id == "CHK-F23" and "раньше даты выработки" in item.message
        for item in result.blocking  # type: ignore[attr-defined]
    )


# --- §9-10: the targeted idempotent backfill ---------------------------------------


def _factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _import_snapshot(db_session: AsyncSession, lab_id: uuid.UUID, snapshot: dict) -> None:
    await upsert_incoming(
        db_session,
        IncomingDocumentInput(
            contour=VetisContour.PILOT,
            evsd_uuid=DOC_UUID,
            laboratory_id=lab_id,
            external_status="CONFIRMED",
            snapshot=SourceSnapshot.model_validate(snapshot),
            fetched_at=datetime.now(UTC),
        ),
    )


async def test_backfill_fills_dates_idempotently_and_keeps_local_facts(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine  # noqa: F811 - imported pytest fixture
) -> None:
    # A snapshot saved BEFORE the fix: no typed date structures at all.
    old_snapshot = _snapshot_dict("", "")
    old_snapshot["vdDocument"]["batch"].pop("dateOfProduction", None)
    old_snapshot["vdDocument"]["batch"].pop("expiryDate", None)
    await _import_snapshot(db_session, lab.id, old_snapshot)
    await db_session.commit()

    raw = _wrap(_xml(SINGLE_DATES, ""))
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
    document = (
        await db_session.execute(select(IncomingDocumentRow).where(IncomingDocumentRow.evsd_uuid == DOC_UUID))
    ).scalar_one()
    party_before = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    rev_before = int(party_before.rev)
    doc_rev_before = int(document.rev)

    counters = await run_goods_date_backfill(_factory(test_db_engine))
    assert counters["fixed"] == 1 and counters["error"] == 0

    db_session.expire_all()
    document = (
        await db_session.execute(select(IncomingDocumentRow).where(IncomingDocumentRow.evsd_uuid == DOC_UUID))
    ).scalar_one()
    batch = document.source_snapshot["vdDocument"]["batch"]
    assert batch["dateOfProduction"]["firstDate"] == "2026-11-03"
    assert "secondDate" not in batch["dateOfProduction"]
    assert batch["expiryDate"]["firstDate"] == "2026-11-10"
    # The raw source and its checksum are never rewritten...
    source_row = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert source_row.raw_xml == raw
    assert source_row.checksum == "checksum-of-the-raw-source"
    # ...and no revision moves for a derived read-model repair (R-DR20-4).
    party_after = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    assert int(party_after.rev) == rev_before
    assert int(document.rev) == doc_rev_before

    # Idempotence: the second run changes nothing.
    counters = await run_goods_date_backfill(_factory(test_db_engine))
    assert counters["fixed"] == 0 and counters["unchanged"] >= 1 and counters["error"] == 0


async def test_backfill_without_raw_xml_is_an_honest_error(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine  # noqa: F811 - imported pytest fixture
) -> None:
    await _import_snapshot(db_session, lab.id, _snapshot_dict("", ""))
    await db_session.commit()
    counters = await run_goods_date_backfill(_factory(test_db_engine))
    assert counters["fixed"] == 0 and counters["error"] >= 1
