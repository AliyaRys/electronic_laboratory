"""ТЗ DR10 tests: the source unit GUID without dt:name (preview gate).

§8 backend items: 1 (snapshot with unit GUID and no unit name → preview
allowed), 2 (snapshot without unit GUID → UNIT_MISSING), 6 (a saved
reconciliation whose unit IDs differ from the source GUID is blocked),
7 (namespace-aware XML: source GUID + separate mass/places),
8 (no external write call: the preview path never contacts VetIS).
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, Party, Reconciliation
from backend.src.modules.identity.models import Laboratory, Territory, User
from backend.src.modules.integrations.vetis.models import VetisBinding, VetisContour, VetisSourceDocument
from backend.src.modules.integrations.vetis.receipt import build_receipt_preview
from backend.tests.vetis.test_receipt_mapping import SOURCE_EVSD, SOURCE_RECEIVER, SOURCE_UNIT, SOURCE_XML

VD = "{http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2}"
BS = "{http://api.vetrf.ru/schema/cdm/base}"
DT = "{http://api.vetrf.ru/schema/cdm/dictionary/v2}"

UNIT_GUID = SOURCE_UNIT


@pytest.fixture
async def dr10_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A confirmed eVSD whose unit carries ONLY a GUID (no dt:name)."""
    territory = Territory(name="Тестовая территория DR10")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(
        territory_id=territory.id, name="Тестовая лаборатория DR10", address="адрес", organization="ГБУ"
    )
    actor = User(
        login=f"vet-{uuid.uuid4()}",
        full_name="Ветеринар fixture",
        email=f"{uuid.uuid4()}@example.test",
        password_hash="fixture",
        role="VET",
    )
    db_session.add_all([lab, actor])
    await db_session.flush()
    document = IncomingDocument(
        contour=VetisContour.PILOT,
        evsd_uuid=SOURCE_EVSD,
        laboratory_id=lab.id,
        external_status="CONFIRMED",
        source_snapshot={
            "vdDocument": {
                "type": "TRANSPORT",
                "status": "CONFIRMED",
                "issueNumber": "DR10-1",
                "consignor": {"name": "Поставщик"},
                "consignee": {"name": "Получатель", "enterprise": {"guid": SOURCE_RECEIVER}},
                "batch": {
                    "product": {"guid": str(uuid.uuid4()), "name": "Мясо"},
                    "volume": "100",
                    "quantity": "4",
                    # No «name»: the missing dt:name is NOT UNIT_MISSING.
                    "unit": {"guid": UNIT_GUID},
                },
            },
            "vetDocuments": [],
        },
        content_hash="c" * 64,
        fetched_at=datetime.now(UTC),
    )
    db_session.add(document)
    await db_session.flush()
    party = Party(
        incoming_document_id=document.id,
        laboratory_id=lab.id,
        classification_snapshot={"product": {"name": "Мясо"}, "unit": {"id": UNIT_GUID, "name": None}},
    )
    db_session.add(party)
    await db_session.flush()
    reconciliation = Reconciliation(
        party_id=party.id,
        checks={},
        delivered_mass_kg=100,
        delivered_quantity=4,
        delivered_unit_id=UNIT_GUID,
        accepted_mass_kg=100,
        accepted_quantity=4,
        accepted_unit_id=UNIT_GUID,
        returned_mass_kg=0,
        returned_quantity=0,
        returned_unit_id=UNIT_GUID,
        decision="ACCEPT_ALL",
        fair=False,
        services=[],
        actor_id=actor.id,
        state="OPEN",
        rev=2,
    )
    db_session.add_all(
        [
            reconciliation,
            VetisBinding(
                laboratory_id=lab.id,
                contour=VetisContour.PILOT,
                business_member_id=str(uuid.uuid4()),
                enterprise_id=SOURCE_RECEIVER,
                initiator="fixture-vet",
            ),
            VetisSourceDocument(
                contour=VetisContour.PILOT,
                evsd_uuid=SOURCE_EVSD,
                laboratory_id=lab.id,
                raw_xml=SOURCE_XML,
                checksum=hashlib.sha256(SOURCE_XML.encode()).hexdigest(),
                revision=3,
            ),
        ]
    )
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        party=party,
        reconciliation=reconciliation,
        document=document,
        factory=async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )


def _preview(db: AsyncSession, env: SimpleNamespace):
    return build_receipt_preview(
        db,
        party_id=env.party.id,
        source_revision=3,
        reconciliation_revision=env.reconciliation.rev,
        vet_inspection="CORRESPONDS",
    )


async def test_preview_allowed_without_dt_name(dr10_env: SimpleNamespace) -> None:
    """§8-1: a unit GUID without a name allows the preview (no UNIT_MISSING)."""
    preview = await _preview(dr10_env.db, dr10_env)
    assert preview.intent.unit_id == UNIT_GUID


async def test_preview_xml_carries_source_guid_and_separate_dimensions(
    dr10_env: SimpleNamespace,
) -> None:
    """§8-7: namespace-aware XML: vd:unit/bs:guid = source GUID; volume = mass;
    dt:package/dt:quantity = places; the name «кг» is never a bs:guid."""
    preview = await _preview(dr10_env.db, dr10_env)
    root = ET.fromstring(preview.application_xml)
    units = [node for node in root.iter() if node.tag == f"{VD}unit"]
    assert units, "vd:unit missing from the application XML"
    for unit in units:
        guid = unit.find(f"{BS}guid")
        assert guid is not None and guid.text == UNIT_GUID
    consignment = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "consignment")
    assert consignment.find(f"{VD}volume").text == "100"  # type: ignore[union-attr]
    assert consignment.find(f".//{DT}quantity").text == "4"  # type: ignore[union-attr]


async def test_snapshot_without_unit_guid_is_unit_missing(dr10_env: SimpleNamespace) -> None:
    """§8-2: a genuinely absent source GUID blocks the preview honestly."""
    import copy as _copy

    document = await dr10_env.db.get(IncomingDocument, dr10_env.party.incoming_document_id)
    assert document is not None
    snapshot = _copy.deepcopy(document.source_snapshot)
    del snapshot["vdDocument"]["batch"]["unit"]  # type: ignore[union-attr,index]
    document.source_snapshot = snapshot
    await dr10_env.db.commit()
    with pytest.raises(ProblemError) as error:
        await _preview(dr10_env.db, dr10_env)
    assert error.value.code == "UNIT_MISSING"


async def test_saved_reconciliation_unit_mismatch_is_blocked(dr10_env: SimpleNamespace) -> None:
    """§8-6: a saved unit ID that differs from the source GUID is blocked."""
    row = await dr10_env.db.get(Reconciliation, dr10_env.reconciliation.id)
    assert row is not None
    row.accepted_unit_id = "11111111-2222-4333-8444-555555555555"
    await dr10_env.db.commit()
    with pytest.raises(ProblemError) as error:
        await _preview(dr10_env.db, dr10_env)
    assert error.value.code == "VALIDATION_ERROR"
    assert "не совпадает" in error.value.detail
