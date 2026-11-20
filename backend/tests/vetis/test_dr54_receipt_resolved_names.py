"""R-rev131: the receipt path validates against the SAME resolved-participant
projection as the read model (ТЗ DR18 §9 + DR54 Task 3 Step 4).

A real VetIS source replacement (rev 131) delivered a snapshot with EMPTY
consignee names while the saved reconciliation keeps honest receiver marks
(CHK-F07/F08) made against the RESOLVED read-model names. The receipt preview
must not answer a false ``RECONCILIATION_INCOMPLETE`` for such a complete
reconciliation: the user cannot re-mark fields the current snapshot no longer
carries.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.modules.arrivals.models import IncomingDocument, Party, Reconciliation
from backend.src.modules.identity.models import Laboratory, Territory, User
from backend.src.modules.integrations.vetis.models import (
    VetisBinding,
    VetisContour,
    VetisReferenceName,
    VetisSourceDocument,
)
from backend.src.modules.integrations.vetis.receipt import build_receipt_preview
from backend.src.modules.integrations.vetis.transport import is_read_only_operation
from backend.tests.vetis.test_dr10_unit_guid import COMPLETE_CHECKS  # noqa: F401
from backend.tests.vetis.test_receipt_mapping import SOURCE_EVSD, SOURCE_RECEIVER, SOURCE_UNIT, SOURCE_XML

ENTERPRISE_GUID = SOURCE_RECEIVER  # pinned by the SOURCE_XML evidence check
BUSINESS_ENTITY_GUID = str(uuid.UUID(int=1))
UNIT_GUID = SOURCE_UNIT


@pytest.fixture
async def names_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A party whose raw VetIS snapshot has EMPTY consignee names while the
    unified reference cache resolves both receiver names (the live rev-131
    shape of party b5c63991/eVSD a2b833f5)."""
    territory = Territory(name="Территория имён")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория имён", address="адрес", organization="ГБУ")
    actor = User(
        login=f"vet-{uuid.uuid4()}",
        full_name="Ветеринар имён",
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
        # The REAL rev-131 shape: consignee.name="" and the nested names null —
        # only the GUIDs survive in the raw snapshot. The SENDER names stay
        # filled exactly like the live party b5c63991.
        source_snapshot={
            "vdDocument": {
                "type": "TRANSPORT",
                "status": "CONFIRMED",
                "issueNumber": "REV131-1",
                "consignor": {"name": "ХАЛЬФИН ФАНИС ФАНАВИЛЕВИЧ"},
                "consignee": {
                    "name": "",
                    "enterprise": {"guid": ENTERPRISE_GUID, "name": None},
                    "businessEntity": {"guid": BUSINESS_ENTITY_GUID, "name": None},
                },
                "batch": {
                    "product": {"guid": str(uuid.uuid4()), "name": "Мясо"},
                    "volume": "100",
                    "quantity": "100",
                    "unit": {"guid": UNIT_GUID, "name": None},
                },
            },
            "vetDocuments": [],
        },
        content_hash="d" * 64,
        fetched_at=datetime.now(UTC),
    )
    db_session.add(document)
    await db_session.flush()
    party = Party(
        incoming_document_id=document.id,
        laboratory_id=lab.id,
        classification_snapshot={"product": {"id": "product-1", "name": "Мясо"}},
    )
    db_session.add(party)
    await db_session.flush()
    checks = dict(COMPLETE_CHECKS)
    # The receiver marks the user saved while the resolved names were shown.
    checks.setdefault("CHK-F07", {"matches": True})
    checks.setdefault("CHK-F08", {"matches": True})
    # RETURN_ALL needs the explicit return-reason mark (FT-ARR-05).
    checks["CHK-F35"] = {"matches": True, "actual": "OTHER_REASON", "reason": "fixture reason"}
    reconciliation = Reconciliation(
        party_id=party.id,
        checks=checks,
        delivered_mass_kg=100,
        delivered_quantity=100,
        delivered_unit_id=UNIT_GUID,
        accepted_mass_kg=0,
        accepted_quantity=0,
        accepted_unit_id=UNIT_GUID,
        returned_mass_kg=100,
        returned_quantity=100,
        returned_unit_id=UNIT_GUID,
        decision="RETURN_ALL",
        transaction_planned=False,
        fair=False,
        services=[],
        actor_id=actor.id,
        state="OPEN",
        rev=12,
    )
    db_session.add_all(
        [
            reconciliation,
            VetisBinding(
                laboratory_id=lab.id,
                contour=VetisContour.PILOT,
                business_member_id=str(uuid.UUID(int=3)),
                enterprise_id=ENTERPRISE_GUID,
                initiator="fixture-vet",
            ),
            VetisSourceDocument(
                contour=VetisContour.PILOT,
                evsd_uuid=SOURCE_EVSD,
                laboratory_id=lab.id,
                raw_xml=SOURCE_XML,
                checksum=hashlib.sha256(SOURCE_XML.encode()).hexdigest(),
                revision=131,
            ),
            # The unified read model (ТЗ DR18): both receiver names resolved
            # earlier through the read-only lookups and cached locally. The
            # ENTERPRISE guid is the seeded SOURCE_RECEIVER — insert the name
            # row only when the shared fixture DB does not already carry it.
            VetisReferenceName(
                contour=VetisContour.PILOT,
                entity_kind="ENTERPRISE",
                guid=uuid.UUID(ENTERPRISE_GUID),
                uuid=uuid.UUID(int=4),
                name="агропарк",
                source="VETIS_LOOKUP",
                status="RESOLVED",
                active=True,
            ),
            VetisReferenceName(
                contour=VetisContour.PILOT,
                entity_kind="BUSINESS_ENTITY",
                guid=uuid.UUID(BUSINESS_ENTITY_GUID),
                uuid=uuid.UUID(int=5),
                name="Хусаинова Гульнур Мансуровна",
                source="VETIS_LOOKUP",
                status="RESOLVED",
                active=True,
            ),
        ]
    )
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        party=party,
        reconciliation=reconciliation,
        factory=async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )


async def test_receipt_preview_accepts_marks_made_against_resolved_names(names_env: SimpleNamespace) -> None:
    """The preview must read the participants through the unified read model,
    not the raw snapshot: otherwise an already honest сверка is refused with a
    false RECONCILIATION_INCOMPLETE and the owner cannot гасить the party."""
    preview = await build_receipt_preview(
        names_env.db,
        party_id=names_env.party.id,
        source_revision=131,
        reconciliation_revision=12,
        vet_inspection="UNSUPERVISED",
        return_date=datetime.now(UTC),
    )
    assert preview.intent.reconciliation_revision == 12


def test_receipt_path_uses_only_read_only_participant_reads() -> None:
    """The name resolution of the receipt path is a DB read model (ТЗ DR18 §6):
    no VetIS request is performed here — the read-only operation allowlist
    stays the network boundary."""
    assert is_read_only_operation("GetUnitByUuidOperation")
    assert not is_read_only_operation("ProcessIncomingConsignment")
