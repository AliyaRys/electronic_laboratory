"""ТЗ DR5 §14.3/§11: the fixed IncomingView, UUID search and the idempotent
backfill of already saved raw XML."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio.engine import AsyncEngine

from backend.src.modules.arrivals import commands, queries
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation, Reconciliation
from backend.src.modules.arrivals.reconciliation import source_projection
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentInput
from backend.src.modules.arrivals.schemas import (
    SourceSnapshot,
)
from backend.src.modules.integrations.vetis.backfill import run_backfill
from backend.src.modules.integrations.vetis.models import MercuryPurposeGuid, VetisContour, VetisSourceDocument
from backend.src.modules.integrations.vetis.normalizer import normalize_snapshot, parse_vet_document_list

DOC_UUID = uuid.UUID("e13bda81-7cf6-4b2b-b1aa-3c99e25adaac")
PURPOSE_GUID = uuid.UUID("0778b8cb-f49d-4ed9-88b9-5f70af00a211")
REAL_DOC = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "vetis"
    / "test_normalizer_dr5.py"
)


def real_snapshot() -> SourceSnapshot:
    text = REAL_DOC.read_text(encoding="utf-8")
    xml = re.search(r'REAL_DOC = """(.*?)"""', text, re.S).group(1)  # type: ignore[union-attr]
    wrapper = f'<w xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2">{xml}</w>'
    entries = parse_vet_document_list(wrapper)
    assert len(entries) == 1
    return normalize_snapshot(entries[0])


def real_document(laboratory_id: uuid.UUID) -> IncomingDocumentInput:
    return IncomingDocumentInput(
        contour=VetisContour.PILOT,
        evsd_uuid=DOC_UUID,
        laboratory_id=laboratory_id,
        external_status="CONFIRMED",
        snapshot=real_snapshot(),
        fetched_at=datetime.now(UTC),
    )


@pytest.fixture
async def lab(db_session: AsyncSession):
    from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole

    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(territory_id=territory.id, name="Лаб", address="ул.", organization="ГБУ")
    db_session.add(laboratory)
    db_session.add(
        User(
            login="vet1",
            full_name="Врач",
            email="vet@example.test",
            password_hash="x" * 60,
            role=UserRole.VET,
            active=True,
        )
    )
    await db_session.commit()
    return laboratory


async def import_document(db_session: AsyncSession, doc: IncomingDocumentInput) -> Party:
    party = await commands.upsert_incoming(db_session, doc)
    await db_session.commit()
    return party


# --- IncomingView ----------------------------------------------------------------


async def test_view_requisites_quantity_mass_distinct(db_session: AsyncSession, lab) -> None:
    party = await import_document(db_session, real_document(lab.id))
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    view = await queries.build_incoming_view(db_session, party, document)
    assert view.documentary.quantity == "8"
    assert view.documentary.mass_kg == "500.0"
    fields = view.external.fields
    assert fields["documentUuid"] == str(DOC_UUID)
    assert fields["issuedOn"] == "2026-11-03"
    assert fields["status"] == "CONFIRMED"
    assert fields["statusLabel"] == "Оформлен"
    # issueNumber is the deprecated alias — never the UUID.
    assert fields["documentNumber"] != str(DOC_UUID)
    assert fields["purposeGuid"] == str(PURPOSE_GUID)
    assert fields["purposeUuid"] == "d4f9b0ea-f4d9-4cd7-92f0-016e1299160e"


async def test_view_purpose_name_resolved_inside_contour(db_session: AsyncSession, lab) -> None:
    db_session.add(
        MercuryPurposeGuid(
            contour=VetisContour.PILOT,
            guid=PURPOSE_GUID,
            current_uuid=uuid.uuid4(),
            name="реализация в пищу людям",
            active=True,
            is_last=True,
            external_status=200,
            source="test",
        )
    )
    await db_session.commit()
    party = await import_document(db_session, real_document(lab.id))
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    view = await queries.build_incoming_view(db_session, party, document)
    assert view.external.fields["purpose"] == "реализация в пищу людям"


async def test_view_purpose_miss_is_honest_fallback(db_session: AsyncSession, lab) -> None:
    party = await import_document(db_session, real_document(lab.id))
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    view = await queries.build_incoming_view(db_session, party, document)
    assert view.external.fields["purpose"] == "Назначение не найдено в справочнике"
    assert view.external.fields["purposeGuid"] == str(PURPOSE_GUID)


async def test_chk_source_projection_separates_quantity_and_mass(db_session: AsyncSession, lab) -> None:
    party = await import_document(db_session, real_document(lab.id))
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    fields = source_projection(document, party).fields
    assert fields["quantity"] == "8"
    assert fields["massKg"] == "500.0"
    assert fields["documentUuid"] == str(DOC_UUID)
    assert fields["statusLabel"] == "Оформлен"


async def test_arrival_search_finds_document_by_uuid(db_session: AsyncSession, lab) -> None:
    await import_document(db_session, real_document(lab.id))
    parties, _, total = await queries.arrival_page(
        db_session, laboratory_id=lab.id, queue=None, result=None, query=str(DOC_UUID), page=1
    )
    assert total == 1
    parties, _, total = await queries.arrival_page(
        db_session, laboratory_id=lab.id, queue=None, result=None, query="e13bda81-7cf6", page=1
    )
    assert total == 1


# --- backfill ---------------------------------------------------------------------


def _factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def test_backfill_fixes_saved_snapshot_idempotently(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine
) -> None:
    # An OLD-style snapshot saved before the fix: no packageList, no purpose,
    # quantity fabricated from volume.
    old_snapshot = real_snapshot()
    payload = dict(old_snapshot.vd_document.model_dump(mode="json", by_alias=True))
    payload["batch"] = {**payload["batch"], "quantity": "500.0", "packageList": []}
    payload.pop("purpose", None)
    fixed_snapshot_dict = {"vdDocument": payload, "vetDocuments": []}
    stale = SourceSnapshot.model_validate(fixed_snapshot_dict)
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
    party_before = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    old_hash = document.content_hash
    party_rev_before = party_before.rev

    text = REAL_DOC.read_text(encoding="utf-8")
    raw_xml = re.search(r'REAL_DOC = """(.*?)"""', text, re.S).group(1)  # type: ignore[union-attr]
    db_session.add(
        VetisSourceDocument(
            contour="PILOT",
            evsd_uuid=DOC_UUID,
            laboratory_id=lab.id,
            raw_xml=raw_xml,
            checksum="checksum-of-the-raw-source",
        )
    )
    # A saved local reconciliation fact that must survive the backfill.
    actor = (await db_session.execute(select(Party))).scalar_one()
    del actor
    await db_session.commit()

    counters = await run_backfill(_factory(test_db_engine))
    assert counters["viewed"] == 1 and counters["fixed"] == 1 and counters["error"] == 0

    db_session.expire_all()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert document.content_hash != old_hash
    assert document.source_snapshot["vdDocument"]["batch"]["quantity"] == "8"
    assert document.source_snapshot["vdDocument"]["batch"]["packageList"][0]["quantity"] == "8"
    assert document.source_snapshot["vdDocument"]["purpose"]["guid"] == str(PURPOSE_GUID)
    party_after = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    assert party_after.rev == party_rev_before + 1
    source_row = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert source_row.raw_xml == raw_xml  # raw source is never rewritten

    # Idempotence: the second run changes nothing.
    counters = await run_backfill(_factory(test_db_engine))
    assert counters == {"viewed": 1, "fixed": 0, "unchanged": 1, "error": 0}
    db_session.expire_all()
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    assert document.source_snapshot["vdDocument"]["batch"]["quantity"] == "8"
    party_after = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == document.id))
    ).scalar_one()
    assert party_after.rev == party_rev_before + 1


async def test_backfill_without_raw_xml_is_an_honest_error(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine
) -> None:
    await import_document(db_session, real_document(lab.id))
    counters = await run_backfill(_factory(test_db_engine))
    assert counters == {"viewed": 1, "fixed": 0, "unchanged": 0, "error": 1}


async def test_backfill_does_not_touch_confirmed_facts(
    db_session: AsyncSession, lab, test_db_engine: AsyncEngine
) -> None:
    party = await import_document(db_session, real_document(lab.id))
    document = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == DOC_UUID))
    ).scalar_one()
    actor = (await db_session.execute(select(Party))).scalar_one()
    del actor
    from backend.src.modules.identity.models import User

    user = (
        await db_session.execute(select(User).where(User.login == "vet1"))
    ).scalar_one()
    confirmation = ReceiptConfirmation(
        party_id=party.id,
        operation_id=uuid.uuid4(),
        source_evsd_uuid=DOC_UUID,
        fingerprint="fingerprint",
        evidence={},
        accepted_mass_kg=500,
        accepted_quantity=8,
        accepted_unit_id="кг",
        classification_snapshot={},
    )
    reconciliation = Reconciliation(
        party_id=party.id,
        checks={},
        services=[],
        delivered_mass_kg=500,
        delivered_quantity=8,
        actor_id=user.id,
        state="OPEN",
    )
    del document
    db_session.add(confirmation)
    db_session.add(reconciliation)
    await db_session.commit()
    confirmation_before = (
        await db_session.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party.id))
    ).scalar_one()
    reconciliation_before = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one()
    del user
    from backend.src.modules.integrations.vetis.models import VetisSourceDocument as Raw

    del Raw
    counters = await run_backfill(_factory(test_db_engine))
    del counters
    confirmation_after = (
        await db_session.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party.id))
    ).scalar_one()
    reconciliation_after = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one()
    assert confirmation_after.evidence == confirmation_before.evidence
    assert confirmation_after.accepted_quantity == confirmation_before.accepted_quantity
    assert reconciliation_after.checks == reconciliation_before.checks
    assert reconciliation_after.delivered_quantity == reconciliation_before.delivered_quantity
