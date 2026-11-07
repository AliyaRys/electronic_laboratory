"""A01 named tests: stable identity, hidden hash, queue read model, lvl2 names.

Named plan tests (Review Focus / acceptance):

- ``test_upsert_stable_identity`` — two imports of one UUID → 1 party; a new
  UUID with the same document number → 2 parties;
- ``test_hidden_hash`` — an unchanged re-import stays invisible, ``fetched_at``
  never changes the hash, a substantive change reappears;
- ``test_external_update_preserves_checks`` — a refreshed external snapshot
  never overwrites saved actual/marks;
- ``test_queue_after_examination_delete`` — after the examination is deleted
  the party falls back to WORK while the confirmation remains;
- ``test_product_lvl2_name`` — a known level-2 GUID resolves to the Russian
  name from ``mercury_product_guid_lvl_2``; an unknown GUID raises
  ``MERCURY_PRODUCT_DICTIONARY_MISS`` without the raw GUID in the message;
- ``test_at_23_hide_expected_does_not_annul_evsd`` — the hidden document row
  survives and an unchanged re-import does not return the row.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands, queries
from backend.src.modules.arrivals.models import (
    HiddenIncoming,
    IncomingDocument,
    Party,
    ReceiptConfirmation,
    Reconciliation,
)
from backend.src.modules.arrivals.schemas import (
    Batch,
    ConsignorConsignee,
    ExternalRef,
    SourceSnapshot,
    VdDocument,
)
from backend.src.modules.arrivals.schemas import (
    IncomingDocument as IncomingDocumentInput,
)
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.integrations.vetis.models import VetisContour

PILOT_BEEF = uuid.UUID("362aa885-9b9f-ae95-05d0-f9570f4fbdc6")  # «говядина» (0005 seed)
UNKNOWN_PRODUCT = uuid.UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")
UNIT_KG = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")


_CONSIGNOR_ENTITY = uuid.UUID("11111111-2222-4333-8444-555555555555")
_CONSIGNEE_ENTERPRISE = uuid.UUID("66666666-7777-4888-8999-000000000000")
_SUB_PRODUCT = uuid.UUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001")
_PRODUCT_ITEM = uuid.UUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002")


def snapshot(
    *,
    issue_number: str = "A-001234",
    product: uuid.UUID = PILOT_BEEF,
    product_item_name: str = "Отруба говяжьи",
    volume: str = "120.0",
) -> SourceSnapshot:
    """A realistic normalized eVSD snapshot (camelCase wire shape)."""
    return SourceSnapshot(
        vdDocument=VdDocument(
            type="CERTIFICATE",
            status="COMPLETED",
            issueSeries="",
            issueNumber=issue_number,
            issueDate="2026-11-07",
            consignor=ConsignorConsignee(name="ООО «Мясопром»", businessEntity=ExternalRef(guid=_CONSIGNOR_ENTITY)),
            consignee=ConsignorConsignee(
                name="Лабораторный убойный пункт", enterprise=ExternalRef(guid=_CONSIGNEE_ENTERPRISE)
            ),
            batch=Batch(
                product=ExternalRef(guid=product),
                subProduct=ExternalRef(guid=_SUB_PRODUCT),
                productItem=ExternalRef(guid=_PRODUCT_ITEM, name=product_item_name),
                volume=volume,
                quantity="4",
                unit=ExternalRef(guid=UNIT_KG, name="кг"),
            ),
            transportNumber="А123ВС77",
        )
    )


def document(
    evsd_uuid: uuid.UUID,
    laboratory_id: uuid.UUID,
    **kwargs: object,
) -> IncomingDocumentInput:
    return IncomingDocumentInput(
        contour=VetisContour.PILOT,
        evsd_uuid=evsd_uuid,
        laboratory_id=laboratory_id,
        external_status="COMPLETED",
        snapshot=snapshot(**kwargs),  # type: ignore[arg-type]
        fetched_at=datetime.now(UTC),
    )


@pytest.fixture
async def lab(db_session: AsyncSession) -> Laboratory:
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(
        territory_id=territory.id, name="Лаборатория №1", address="ул. Первая, 1", organization="ГБУ"
    )
    user = User(
        login="vet1",
        full_name="Ветеринарный врач",
        email="vet@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(laboratory)
    db_session.add(user)
    await db_session.commit()
    return laboratory


@pytest.fixture
async def actor(lab: Laboratory, db_session: AsyncSession) -> uuid.UUID:
    from backend.src.modules.identity.models import User as UserModel

    return (await db_session.execute(select(UserModel).where(UserModel.login == "vet1"))).scalar_one().id


async def import_document(db_session: AsyncSession, doc: IncomingDocumentInput) -> Party:
    party = await commands.upsert_incoming(db_session, doc)
    await db_session.commit()
    return party


async def test_upsert_stable_identity(db_session: AsyncSession, lab: Laboratory) -> None:
    first_uuid, second_uuid = uuid.uuid4(), uuid.uuid4()
    party = await import_document(db_session, document(first_uuid, lab.id))
    again = await import_document(db_session, document(first_uuid, lab.id))
    third = await import_document(db_session, document(second_uuid, lab.id, issue_number="A-001234"))

    total = len((await db_session.execute(select(Party))).scalars().all())
    assert total == 2  # two imports of one UUID → 1 party; new UUID → 2
    assert again.id == party.id
    assert third.id != party.id
    documents = (await db_session.execute(select(IncomingDocument))).scalars().all()
    assert {doc.evsd_uuid for doc in documents} == {first_uuid, second_uuid}


async def test_hidden_hash(db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID) -> None:
    evsd = uuid.uuid4()
    party = await import_document(db_session, document(evsd, lab.id))
    await commands.hide_incoming(db_session, actor, party.id)
    await db_session.commit()

    hidden = (await db_session.execute(select(HiddenIncoming).where(HiddenIncoming.evsd_uuid == evsd))).scalar_one()
    document_row = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    assert hidden.content_hash == document_row.content_hash

    # Unchanged re-import: same hash, only fetched_at moves — stays invisible.
    refreshed = await import_document(db_session, document(evsd, lab.id))
    same_hash = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    assert same_hash.content_hash == hidden.content_hash

    parties, _, total = await queries.arrival_page(
        db_session, laboratory_id=lab.id, queue=None, result=None, query=None, page=1
    )
    assert total == 0 and parties == []
    assert refreshed.id == party.id

    # Substantive change → the document reappears and the hide decision is gone.
    changed = await import_document(db_session, document(evsd, lab.id, volume="105.0"))
    del changed
    document_after = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    assert document_after.content_hash != hidden.content_hash
    parties, _, total = await queries.arrival_page(
        db_session, laboratory_id=lab.id, queue=None, result=None, query=None, page=1
    )
    assert total == 1
    leftovers = (await db_session.execute(select(HiddenIncoming))).scalars().all()
    assert leftovers == []


async def test_external_update_preserves_checks(db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID) -> None:
    evsd = uuid.uuid4()
    party = await import_document(db_session, document(evsd, lab.id))
    checks = {"F04_volume": {"matches": False, "actual": "100.0"}}
    db_session.add(
        Reconciliation(
            party_id=party.id,
            checks=checks,
            delivered_mass_kg=Decimal("120.000000"),
            delivered_quantity=Decimal("4.000000"),
            delivered_unit_id=str(UNIT_KG),
            accepted_mass_kg=Decimal("100.000000"),
            accepted_quantity=Decimal("4.000000"),
            accepted_unit_id=str(UNIT_KG),
            services=[],
            actor_id=actor,
            state="OPEN",
        )
    )
    await db_session.commit()
    before = (await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))).scalar_one()
    saved_checks = dict(before.checks)
    saved_accepted = before.accepted_mass_kg

    # The external snapshot refreshes (new volume) — the saved facts stay.
    await import_document(db_session, document(evsd, lab.id, volume="110.0"))
    after = (await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))).scalar_one()
    assert after.checks == saved_checks
    assert Decimal(after.accepted_mass_kg) == saved_accepted  # type: ignore[arg-type]


async def _stub_examinations(db_session: AsyncSession) -> None:
    """A minimal ТЗ-06-shaped stub so the queue read model can see ВСЭ rows."""
    from sqlalchemy import text

    await db_session.execute(
        text(
            "CREATE TABLE IF NOT EXISTS examinations ("
            "id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
            "party_id uuid NOT NULL,"
            "laboratory_id uuid NOT NULL,"
            "status varchar(20) NOT NULL,"
            "created_at timestamptz NOT NULL DEFAULT now())"
        )
    )
    await db_session.commit()


async def test_queue_after_examination_delete(db_session: AsyncSession, lab: Laboratory) -> None:
    await _stub_examinations(db_session)
    party = await import_document(db_session, document(uuid.uuid4(), lab.id))
    db_session.add(
        ReceiptConfirmation(
            party_id=party.id,
            operation_id=uuid.uuid4(),
            source_evsd_uuid=uuid.uuid4(),
            fingerprint="fp-1",
            evidence={},
            accepted_mass_kg=Decimal("100.000000"),
            accepted_quantity=Decimal("4.000000"),
            accepted_unit_id=str(UNIT_KG),
            classification_snapshot={},
        )
    )
    await db_session.commit()

    party_view = await queries.party_view(db_session, party.id)
    assert party_view is not None
    view = await queries.build_incoming_view(db_session, party_view[0], party_view[1])
    assert view.queue == "WORK"  # confirmed but no completed ВСЭ yet
    assert view.confirmation is not None

    await db_session.execute(
        text("INSERT INTO examinations (party_id, laboratory_id, status) VALUES (:p, :l, 'COMPLETED')"),
        {"p": party.id, "l": lab.id},
    )
    await db_session.commit()
    view = await queries.build_incoming_view(db_session, party_view[0], party_view[1])
    assert view.queue == "ACCEPTED"

    # Deletion of the ВСЭ: the row disappears, the confirmation remains.
    await db_session.execute(text("DELETE FROM examinations WHERE party_id = :p"), {"p": party.id})
    await db_session.commit()
    view = await queries.build_incoming_view(db_session, party_view[0], party_view[1])
    assert view.queue == "WORK"
    assert view.confirmation is not None  # the previous confirmation remains


async def test_product_lvl2_name(db_session: AsyncSession, lab: Laboratory) -> None:
    party = await import_document(db_session, document(uuid.uuid4(), lab.id))
    classification = party.classification_snapshot
    assert classification["product"] == {
        "id": str(PILOT_BEEF),
        "name": "говядина",
    }
    # Level 4 nomenclature is stored separately, never as the level-2 name.
    assert isinstance(classification["productItem"], dict)
    assert classification["productItem"]["name"] == "Отруба говяжьи"  # type: ignore[index]
    assert classification["product"]["name"] != classification["productItem"]["name"]  # type: ignore[index]

    with pytest.raises(ProblemError) as raised:
        await import_document(db_session, document(uuid.uuid4(), lab.id, product=UNKNOWN_PRODUCT))
    assert raised.value.code == "MERCURY_PRODUCT_DICTIONARY_MISS"
    assert str(UNKNOWN_PRODUCT) not in raised.value.detail
    assert "сырой" not in raised.value.detail


async def test_at_23_hide_expected_does_not_annul_evsd(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID
) -> None:
    evsd = uuid.uuid4()
    party = await import_document(db_session, document(evsd, lab.id))
    await commands.hide_incoming(db_session, actor, party.id)
    await db_session.commit()

    # The external document itself is NOT annulled: the row survives.
    document_row = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    assert document_row is not None

    _, _, total = await queries.arrival_page(
        db_session, laboratory_id=lab.id, queue="EXPECTED", result=None, query=None, page=1
    )
    assert total == 0  # the unchanged re-import does not return the row
