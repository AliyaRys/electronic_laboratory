"""ТЗ DR9 API/read-model tests: EXPECTED gate, freshness view, stale гашение.

API items 1–6 of ТЗ DR9 §8, proven on fixtures only (no live VetIS, no write
port). The queue gate, the totals and the direct-read guard are exercised
through the real read models and the real receipt preview builder.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands, queries
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation, Reconciliation
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentInput
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.integrations.vetis.models import VetisBinding, VetisContour, VetisSourceDocument
from backend.tests.arrivals.test_import_and_queues import UNIT_KG, document

STALE = "NOT_IN_CURRENT_CONFIRMED_LIST"
CURRENT = "CURRENT_CONFIRMED"


@pytest.fixture
async def dr9_lab(db_session: AsyncSession) -> Laboratory:
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(
        territory_id=territory.id, name="Лаборатория №1", address="ул. Тестовая, 1", organization="ГБУ"
    )
    user = User(
        login="vet-dr9",
        full_name="Ветеринарный врач",
        email="vet-dr9@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(laboratory)
    db_session.add(user)
    await db_session.commit()
    return laboratory


async def import_document(db: AsyncSession, doc: IncomingDocumentInput) -> Party:
    party = await commands.upsert_incoming(db, doc)
    await db.commit()
    return party


async def document_of(db: AsyncSession, evsd: uuid.UUID) -> IncomingDocument:
    row = (await db.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))).scalar_one()
    return row


def set_presence(document_row: IncomingDocument, presence: str) -> None:
    """Apply the DR9 deactivation/restoration verdict of a FULL successful sync."""
    document_row.source_presence = presence
    document_row.source_presence_reason = None if presence == CURRENT else "not_in_confirmed_list"
    document_row.presence_changed_at = datetime.now(UTC) if presence == STALE else None


async def test_expected_excludes_stale_and_work_is_untouched(db_session: AsyncSession, dr9_lab: Laboratory) -> None:
    """Item 1: stale is not EXPECTED; local WORK (started reconciliation) is intact."""
    stale_uuid, fresh_uuid = uuid.uuid4(), uuid.uuid4()
    await import_document(db_session, document(stale_uuid, dr9_lab.id))
    await import_document(db_session, document(fresh_uuid, dr9_lab.id))
    stale_row = await document_of(db_session, stale_uuid)
    set_presence(stale_row, STALE)
    await db_session.commit()

    _, _, expected_total = await queries.arrival_page(
        db_session, laboratory_id=dr9_lab.id, queue="EXPECTED", result=None, query=None, page=1
    )
    assert expected_total == 1  # only the fresh document

    # A started reconciliation keeps the stale document in WORK — facts intact.
    user = (await db_session.execute(select(User).where(User.login == "vet-dr9"))).scalar_one()
    stale_party = (
        await db_session.execute(select(Party).where(Party.incoming_document_id == stale_row.id))
    ).scalar_one()
    db_session.add(
        Reconciliation(
            party_id=stale_party.id,
            checks={},
            services={},
            delivered_mass_kg=Decimal("1"),
            delivered_quantity=Decimal("1"),
            delivered_unit_id=str(UNIT_KG),
            accepted_mass_kg=Decimal("1"),
            accepted_quantity=Decimal("1"),
            accepted_unit_id=str(UNIT_KG),
            returned_mass_kg=Decimal("0"),
            returned_quantity=Decimal("0"),
            returned_unit_id=str(UNIT_KG),
            actor_id=user.id,
            state="OPEN",
        )
    )
    await db_session.commit()
    _, _, work_total = await queries.arrival_page(
        db_session, laboratory_id=dr9_lab.id, queue="WORK", result=None, query=None, page=1
    )
    assert work_total == 1


async def test_totals_after_freshness_and_scope(db_session: AsyncSession, dr9_lab: Laboratory) -> None:
    """Item 2: total counts AFTER freshness AND the laboratory scope filter."""
    own_stale, own_fresh = uuid.uuid4(), uuid.uuid4()
    await import_document(db_session, document(own_stale, dr9_lab.id))
    await import_document(db_session, document(own_fresh, dr9_lab.id))
    set_presence(await document_of(db_session, own_stale), STALE)
    await db_session.commit()
    territory = (await db_session.execute(select(Territory).limit(1))).scalar_one()
    foreign = Laboratory(territory_id=territory.id, name="Чужая лаборатория", address="—", organization="—")
    db_session.add(foreign)
    await db_session.commit()
    await import_document(db_session, document(uuid.uuid4(), foreign.id))

    parties, _, total = await queries.arrival_page(
        db_session, laboratory_id=dr9_lab.id, queue="EXPECTED", result=None, query=None, page=1
    )
    assert total == 1  # stale excluded, the foreign laboratory never counted
    view = await queries.build_incoming_view(db_session, parties[0], await document_of(db_session, own_fresh))
    assert view.source_presence == CURRENT
    assert view.last_seen_sync_at is not None


async def test_direct_read_stale_shows_cause_and_blocks_receipt(db_session: AsyncSession, dr9_lab: Laboratory) -> None:
    """Item 3: a stale direct read carries the reason and blocks the repeat гашение."""
    stale_uuid = uuid.uuid4()
    party = await import_document(db_session, document(stale_uuid, dr9_lab.id))
    document_row = await document_of(db_session, stale_uuid)
    document_row.external_status = "CONFIRMED"  # the гашение precondition is met
    await db_session.commit()

    view = await queries.build_incoming_view(db_session, party, document_row)
    assert view.source_presence == CURRENT
    assert view.source_presence_reason is None

    set_presence(document_row, STALE)
    await db_session.commit()
    await db_session.refresh(document_row)
    view = await queries.build_incoming_view(db_session, party, document_row)
    assert view.source_presence == STALE
    assert view.source_presence_reason == "not_in_confirmed_list"

    rows = await _receipt_rows(db_session, dr9_lab, party, document_row)
    with pytest.raises(ProblemError) as raised:
        await _preview(db_session, rows)
    assert raised.value.status == 409
    assert raised.value.code == "SOURCE_PRESENCE_STALE"


async def test_fresh_document_is_not_blocked_by_the_guard(db_session: AsyncSession, dr9_lab: Laboratory) -> None:
    """The guard never touches a CURRENT_CONFIRMED document (other grounds may still refuse)."""
    fresh_uuid = uuid.uuid4()
    party = await import_document(db_session, document(fresh_uuid, dr9_lab.id))
    document_row = await document_of(db_session, fresh_uuid)
    document_row.external_status = "CONFIRMED"
    await db_session.commit()
    rows = await _receipt_rows(db_session, dr9_lab, party, document_row)
    with pytest.raises(ProblemError) as raised:
        await _preview(db_session, rows)
    assert raised.value.code != "SOURCE_PRESENCE_STALE"


async def test_confirmation_survives_reimport_and_freshness(db_session: AsyncSession, dr9_lab: Laboratory) -> None:
    """Item 4: ReceiptConfirmation is never removed by an external sync/re-import."""
    evsd = uuid.uuid4()
    party = await import_document(db_session, document(evsd, dr9_lab.id))
    db_session.add(
        ReceiptConfirmation(
            party_id=party.id,
            operation_id=uuid.uuid4(),
            source_evsd_uuid=evsd,
            fingerprint="fixture-fingerprint",
            evidence={"fixture": True},
            accepted_mass_kg=Decimal("2"),
            accepted_quantity=Decimal("2"),
            accepted_unit_id=str(UNIT_KG),
            classification_snapshot={},
        )
    )
    await db_session.commit()

    # A re-import (same UUID, same content) refreshes freshness WITHOUT
    # duplicating the party and WITHOUT touching the legal fact.
    await import_document(db_session, document(evsd, dr9_lab.id))
    confirmations = (await db_session.execute(select(ReceiptConfirmation))).scalars().all()
    assert len(confirmations) == 1
    assert len((await db_session.execute(select(Party))).scalars().all()) == 1
    row = await document_of(db_session, evsd)
    assert row.source_presence == CURRENT


# --- receipt-preview row builder (guard-level fixture) --------------------------


async def _receipt_rows(
    db: AsyncSession, laboratory: Laboratory, party: Party, document_row: IncomingDocument
) -> tuple[Reconciliation, VetisSourceDocument, VetisBinding]:
    user = (await db.execute(select(User).where(User.login == "vet-dr9"))).scalar_one()
    raw_xml = "<fixture-xml/>"
    db.add(
        VetisSourceDocument(
            contour=document_row.contour,
            evsd_uuid=document_row.evsd_uuid,
            laboratory_id=laboratory.id,
            raw_xml=raw_xml,
            checksum=hashlib.sha256(raw_xml.encode()).hexdigest(),
        )
    )
    db.add(
        VetisBinding(
            laboratory_id=laboratory.id,
            contour=VetisContour.PILOT,
            business_member_id="fixture-member",
            enterprise_id="fixture-enterprise",
            initiator="fixture-initiator",
        )
    )
    db.add(
        Reconciliation(
            party_id=party.id,
            checks={},
            services={},
            delivered_mass_kg=Decimal("1"),
            delivered_quantity=Decimal("1"),
            delivered_unit_id=str(UNIT_KG),
            accepted_mass_kg=Decimal("1"),
            accepted_quantity=Decimal("1"),
            accepted_unit_id=str(UNIT_KG),
            returned_mass_kg=Decimal("0"),
            returned_quantity=Decimal("0"),
            returned_unit_id=str(UNIT_KG),
            decision="ACCEPT_ALL",
            actor_id=user.id,
            state="OPEN",
        )
    )
    await db.commit()
    reconciliation = (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one()
    source = (
        await db.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == document_row.evsd_uuid))
    ).scalar_one()
    return reconciliation, source


async def _preview(
    db: AsyncSession, rows: tuple[Reconciliation, VetisSourceDocument]
) -> object:
    from backend.src.modules.integrations.vetis.receipt import build_receipt_preview

    reconciliation, source = rows
    return await build_receipt_preview(
        db,
        party_id=reconciliation.party_id,
        source_revision=source.revision,
        reconciliation_revision=reconciliation.rev,
        vet_inspection="CORRESPONDS",
    )
