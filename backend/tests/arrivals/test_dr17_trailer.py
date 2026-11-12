"""ТЗ DR17 §8: the separate trailer number (CHK-F11) of the transport block.

The trailer fact is parsed namespace-aware and stored SEPARATELY from the
vehicle number (R-DR17-1); an absent/empty ``vd:trailerNumber`` publishes the
agreed informational text «Прицеп отсутствует» (R-DR17-2/3) — never «—», never
a fictive number. The backfill repairs only the derived snapshot field.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from backend.src.modules.arrivals.models import IncomingDocument as IncomingDocumentRow
from backend.src.modules.arrivals.models import Party
from backend.src.modules.arrivals.reconciliation import source_projection
from backend.src.modules.arrivals.schemas import (
    ABSENT_TRAILER_TEXT,
    Comparison,
    QuantitySet,
    ReconciliationWrite,
    trailer_projection,
)
from backend.src.modules.arrivals.schemas import (
    IncomingDocument as IncomingDocumentInput,
)
from backend.src.modules.arrivals.validation import ReceiptCapabilities, validate_receipt
from backend.src.modules.integrations.vetis.backfill import run_backfill
from backend.src.modules.integrations.vetis.models import VetisContour, VetisSourceDocument
from backend.src.modules.integrations.vetis.normalizer import (
    normalize_snapshot,
    parse_vet_document_list,
)
from backend.tests.arrivals.test_dr8_unit import UNIT_GUID
from backend.tests.arrivals.test_import_and_queues import lab  # noqa: F401 - pytest fixture re-export

DOC_UUID = uuid.uuid4()


def _xml(trailer: str | None) -> str:
    """An anonymized transport eVSD with an optional trailerNumber node."""
    trailer_node = f"<vd:trailerNumber>{trailer}</vd:trailerNumber>" if trailer is not None else ""
    return f"""
<vd:vetDocument xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
                xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">
  <bs:uuid>{DOC_UUID}</bs:uuid>
  <vd:vetDType>TRANSPORT</vd:vetDType>
  <vd:vetDStatus>CONFIRMED</vd:vetDStatus>
  <vd:issueDate>2026-11-12</vd:issueDate>
  <vd:certifiedConsignment>
    <vd:consignor><dt:name xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">Поставщик</dt:name></vd:consignor>
    <vd:consignee><dt:name xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">Получатель</dt:name></vd:consignee>
    <vd:transportInfo>
      <vd:transportNumber><vd:vehicleNumber>А123АА116</vd:vehicleNumber>{trailer_node}</vd:transportNumber>
    </vd:transportInfo>
    <vd:batch>
      <vd:productType>1</vd:productType>
      <vd:product><bs:guid>362aa885-9b9f-ae95-05d0-f9570f4fbdc6</bs:guid><dt:name xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">говядина</dt:name></vd:product>
      <vd:subProduct><bs:guid>db988ef9-e34c-d51e-17f8-409d23209df9</bs:guid><dt:name xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">говядина</dt:name></vd:subProduct>
      <vd:productItem><bs:guid>de0931d0-e29c-433a-947e-dabf540c2790</bs:guid><dt:name xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">говядина</dt:name></vd:productItem>
      <vd:volume>120.0</vd:volume>
      <vd:unit><bs:guid>{UNIT_GUID}</bs:guid><dt:name xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">кг</dt:name></vd:unit>
    </vd:batch>
  </vd:certifiedConsignment>
</vd:vetDocument>
"""


def _parse(source: str) -> tuple[str | None, str | None]:
    wrapper = f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{source}</w>'
    entries = parse_vet_document_list(wrapper)
    assert len(entries) == 1
    snapshot = normalize_snapshot(entries[0])
    return snapshot.vd_document.transport_number, snapshot.vd_document.trailer_number


# --- §8.1/§8.3: separate parsing, no mixing --------------------------------------


def test_trailer_number_parsed_separately() -> None:
    vehicle, trailer = _parse(_xml("Т456РР116"))
    assert vehicle == "А123АА116"
    assert trailer == "Т456РР116"


def test_vehicle_and_trailer_never_merge() -> None:
    # A trailer-only document: the vehicle number stays ABSENT, never the
    # trailer value copied into it (and vice versa).
    vehicle, trailer = _parse(_xml("Т456РР116").replace("<vd:vehicleNumber>А123АА116</vd:vehicleNumber>", ""))
    assert vehicle is None
    assert trailer == "Т456РР116"
    vehicle, trailer = _parse(_xml(None))
    assert vehicle == "А123АА116"
    assert trailer is None


def test_long_trailer_number_is_preserved_in_full() -> None:
    long_number = "Т1234АВ" * 8  # 56 characters, within the snapshot length
    vehicle, trailer = _parse(_xml(long_number))
    assert trailer == long_number


# --- §8.2: the agreed absent text -------------------------------------------------


def test_absent_trailer_projects_the_agreed_text() -> None:
    snapshot_dict = normalize_snapshot(parse_vet_document_list(_wrap(_xml(None)))[0]).model_dump(
        mode="json", by_alias=True
    )
    assert trailer_projection(snapshot_dict["vdDocument"]["trailerNumber"]) == ABSENT_TRAILER_TEXT
    # An empty node counts as absent, not as a whitespace value.
    empty = _xml(None).replace("</vd:transportNumber>", "<vd:trailerNumber>   </vd:trailerNumber></vd:transportNumber>")
    snapshot_dict = normalize_snapshot(parse_vet_document_list(_wrap(empty))[0]).model_dump(mode="json", by_alias=True)
    assert trailer_projection(snapshot_dict["vdDocument"]["trailerNumber"]) == ABSENT_TRAILER_TEXT
    assert trailer_projection("Т456РР116") == "Т456РР116"


def _wrap(source: str) -> str:
    return f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{source}</w>'


# --- the projection + validator harness ------------------------------------------


def _row(trailer: str | None) -> IncomingDocumentRow:
    snapshot = normalize_snapshot(parse_vet_document_list(_wrap(_xml(trailer)))[0]).model_dump(
        mode="json", by_alias=True
    )
    return IncomingDocumentRow(
        contour=VetisContour.PILOT,
        evsd_uuid=DOC_UUID,
        laboratory_id=uuid.uuid4(),
        external_status="CONFIRMED",
        source_snapshot=snapshot,
        content_hash="d" * 64,
        fetched_at=datetime.now(UTC),
    )


def _party() -> Party:
    return Party(
        incoming_document_id=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        classification_snapshot={"product": {"id": str(uuid.uuid4()), "name": "говядина"}},
        rev=1,
        created_at=datetime.now(UTC),
    )


def _payload(checks: dict[str, Comparison]) -> ReconciliationWrite:
    return ReconciliationWrite.model_validate(
        {
            "checks": checks,
            "inspection": {"compartment": "COMPLIANT", "jointCarriage": "NONE"},
            "delivered": QuantitySet(mass_kg="120.0", quantity="4", unit_id=UNIT_GUID),
            "accepted": QuantitySet(mass_kg="120.0", quantity="4", unit_id=UNIT_GUID),
            "returned": QuantitySet(mass_kg="0", quantity="0", unit_id=UNIT_GUID),
            "decision": "ACCEPT_ALL",
            "transaction": {"planned": False},
            "fair": False,
            "services": [],
        }
    )


CAPS = ReceiptCapabilities()


def _f11_error_ids(result: object) -> set[str]:
    return {item.field_id for item in result.all_errors() if item.field_id == "CHK-F11"}  # type: ignore[attr-defined]


# --- §8.4: CHK-F11 in the projection and in validation ----------------------------


def test_projection_publishes_vehicle_and_trailer_separately() -> None:
    fields = source_projection(_row("Т456РР116"), _party()).fields
    assert fields["vehicleNumber"] == "А123АА116"
    assert fields["trailerNumber"] == "Т456РР116"


def test_chk_f11_source_number_demands_the_mark() -> None:
    source = source_projection(_row("Т456РР116"), _party())
    result = validate_receipt(_payload({}), source, CAPS)
    assert _f11_error_ids(result) == {"CHK-F11"}


# --- §8.5/§8.6: absence is never an error; mismatch needs fact + reason ------------


def test_absent_trailer_creates_no_error_and_allows_explicit_match() -> None:
    source = source_projection(_row(None), _party())
    assert source.fields["trailerNumber"] == ABSENT_TRAILER_TEXT
    # No mark: the absence itself is not an error and not an automatic mismatch.
    result = validate_receipt(_payload({}), source, CAPS)
    assert _f11_error_ids(result) == set()
    # The explicit «Совпадает» mark is accepted without any actual input.
    result = validate_receipt(_payload({"CHK-F11": Comparison(matches=True)}), source, CAPS)
    assert _f11_error_ids(result) == set()
    assert all(item.field_id != "CHK-F11" for item in result.blocking)  # type: ignore[attr-defined]


def test_trailer_mismatch_requires_actual_and_reason() -> None:
    source = source_projection(_row("Т456РР116"), _party())
    base = {"CHK-F11": Comparison(matches=False, actual="Т999УУ116")}
    result = validate_receipt(_payload(base), source, CAPS)
    assert "CHK-F43" in {item.field_id for item in result.all_errors()}  # type: ignore[attr-defined]
    with_reason = {"CHK-F11": Comparison(matches=False, actual="Т999УУ116", reason="Замена прицепа")}
    result = validate_receipt(_payload(with_reason), source, CAPS)
    assert _f11_error_ids(result) == set()
    # The marked mismatch participates in the derived act items (CHK-F44).
    assert any(item.field_id == "CHK-F11" for item in result.act.items)  # type: ignore[attr-defined]


def test_absent_trailer_mismatch_still_demands_fact_and_reason() -> None:
    source = source_projection(_row(None), _party())
    result = validate_receipt(_payload({"CHK-F11": Comparison(matches=False)}), source, CAPS)
    assert "CHK-F42" in {item.field_id for item in result.all_errors()}  # type: ignore[attr-defined]
    assert "CHK-F43" in {item.field_id for item in result.all_errors()}  # type: ignore[attr-defined]


# --- §8.7: the idempotent derived-field backfill ----------------------------------


def _factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def test_backfill_fills_trailer_number_idempotently(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine  # noqa: F811 - imported pytest fixture
) -> None:
    # A snapshot saved BEFORE the fix: no trailer_number key at all.
    old_snapshot = normalize_snapshot(parse_vet_document_list(_wrap(_xml(None)))[0]).model_dump(
        mode="json", by_alias=True
    )
    old_snapshot["vdDocument"].pop("trailerNumber", None)
    await commands_upsert(old_snapshot, db_session, lab.id)
    await db_session.commit()

    raw = _wrap(_xml("Т456РР116"))
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
    party_rev_before = int(party_before.rev)

    counters = await run_backfill(_factory(test_db_engine))
    assert counters["fixed"] == 1 and counters["error"] == 0

    db_session.expire_all()
    document = (
        await db_session.execute(select(IncomingDocumentRow).where(IncomingDocumentRow.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert document.source_snapshot["vdDocument"]["trailerNumber"] == "Т456РР116"
    source_row = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert source_row.raw_xml == raw
    assert source_row.checksum == "checksum-of-the-raw-source"

    # Idempotence: the second run changes nothing.
    counters = await run_backfill(_factory(test_db_engine))
    assert counters == {"viewed": counters["viewed"], "fixed": 0, "unchanged": counters["unchanged"], "error": 0}
    assert counters["fixed"] == 0
    party_after = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    assert party_after.rev == party_rev_before + 1


async def commands_upsert(snapshot: dict, db_session: AsyncSession, laboratory_id: uuid.UUID) -> None:
    from backend.src.modules.arrivals.commands import upsert_incoming
    from backend.src.modules.arrivals.schemas import SourceSnapshot

    await upsert_incoming(
        db_session,
        IncomingDocumentInput(
            contour=VetisContour.PILOT,
            evsd_uuid=DOC_UUID,
            laboratory_id=laboratory_id,
            external_status="CONFIRMED",
            snapshot=SourceSnapshot.model_validate(snapshot),
            fetched_at=datetime.now(UTC),
        ),
    )
