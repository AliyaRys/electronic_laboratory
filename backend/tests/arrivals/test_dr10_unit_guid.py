"""ТЗ DR10 tests: canonical unit contract of the arrivals read model.

§8 backend items: 3 (a new reconciliation inherits the GUID into all three
QuantitySets), 4 (documentary.unit_id == classification.unit.id), 5 (an empty
reconciliation with a source GUID raises no false missing-unit error).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from backend.src.modules.arrivals.commands import _entry
from backend.src.modules.arrivals.models import IncomingDocument as IncomingDocumentRow
from backend.src.modules.arrivals.models import Party
from backend.src.modules.arrivals.queries import _quantity_set, _unit_name
from backend.src.modules.arrivals.reconciliation import build_reconciliation_view
from backend.src.modules.arrivals.schemas import ExternalRef, ReconciliationWrite
from backend.src.modules.integrations.vetis.models import VetisContour

UNIT_GUID = "21ed96c9-337b-4a27-8761-c6e6ad3c9f5b"

# §8-1 fixture shape: the source unit carries ONLY a GUID (no dt:name).
SNAPSHOT = {
    "vdDocument": {
        "type": "TRANSPORT",
        "status": "CONFIRMED",
        "issueNumber": "DR10-1",
        "issueDate": "2026-11-12",
        "consignor": {"name": "Поставщик"},
        "consignee": {"name": "Получатель", "enterprise": {"guid": str(uuid.uuid4())}},
        "batch": {
            "product": {"guid": str(uuid.uuid4()), "name": "Мясо"},
            "volume": "120",
            "quantity": "4",
            "unit": {"guid": UNIT_GUID},
        },
        "purpose": {"guid": str(uuid.uuid4())},
    },
    "vetDocuments": [],
}


def document_row() -> IncomingDocumentRow:
    return IncomingDocumentRow(
        contour=VetisContour.PILOT,
        evsd_uuid=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        external_status="CONFIRMED",
        source_snapshot=SNAPSHOT,
        content_hash="d" * 64,
        fetched_at=datetime.now(UTC),
    )


def party() -> Party:
    return Party(
        incoming_document_id=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        classification_snapshot={
            "product": {"id": str(uuid.uuid4()), "name": "Мясо"},
            "unit": _entry(ExternalRef(guid=UNIT_GUID, name=None)),
        },
        rev=1,
        created_at=datetime.now(UTC),
    )


def test_documentary_and_classification_share_the_source_guid() -> None:
    """§8-4: documentary.unit_id and classification.unit.id are the SAME GUID."""
    batch = SNAPSHOT["vdDocument"]["batch"]  # type: ignore[index]
    quantities = _quantity_set(batch)
    classification_unit = _entry(ExternalRef(guid=UNIT_GUID, name=None))
    assert quantities.unit_id == UNIT_GUID
    assert classification_unit["id"] == UNIT_GUID
    assert quantities.unit_id == classification_unit["id"]


def test_empty_unit_name_is_not_a_missing_unit() -> None:
    """§8-1/§5: an absent source name keeps the unit PRESENT (GUID identity)."""
    batch = SNAPSHOT["vdDocument"]["batch"]  # type: ignore[index]
    assert _unit_name(batch) is None
    assert _quantity_set(batch).unit_id == UNIT_GUID


def test_new_reconciliation_inherits_guid_into_three_quantity_sets() -> None:
    """§8-3: delivered/accepted/returned all start with the source GUID."""
    view = build_reconciliation_view(None, party(), document_row())  # type: ignore[arg-type]
    assert view.delivered.unit_id == UNIT_GUID
    assert view.accepted.unit_id == UNIT_GUID
    assert view.returned.unit_id == UNIT_GUID


def test_empty_reconciliation_with_source_guid_has_no_false_missing() -> None:
    """§8-5: an empty reconciliation over a GUID-bearing snapshot carries no
    missing-unit diagnostic and never an empty unit identity."""
    view = build_reconciliation_view(None, party(), document_row())  # type: ignore[arg-type]
    for part in (view.delivered, view.accepted, view.returned):
        assert part.unit_id not in ("", "кг", "500.0", "8")
    assert all("не содержит единицу" not in item.message for item in view.errors)


async def test_saved_reconciliation_units_are_normalized_at_save(db_session) -> None:
    """Fix round 1 §5/R-DR10-3: through the REAL save path a stale/empty AND a
    mismatching saved unit are normalized from the immutable source snapshot;
    the persisted row can never keep a unit that differs from the source."""
    from sqlalchemy import select

    from backend.src.core.contracts import CommandContext
    from backend.src.modules.arrivals.models import Reconciliation
    from backend.src.modules.arrivals.reconciliation import save_reconciliation
    from backend.src.modules.identity.models import Laboratory, Territory, User

    territory = Territory(name="Тестовая территория DR10")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(
        territory_id=territory.id,
        name="Тестовая лаборатория DR10",
        address="адрес",
        organization="ГБУ",
    )
    db_session.add(lab)
    await db_session.flush()
    actor = User(
        login=f"vet-{uuid.uuid4()}",
        full_name="Ветеринар fixture",
        email=f"{uuid.uuid4()}@example.test",
        password_hash="fixture",
        role="VET",
    )
    db_session.add(actor)
    await db_session.flush()
    document = document_row()
    document.laboratory_id = lab.id
    db_session.add(document)
    await db_session.flush()
    owner = party()
    owner.laboratory_id = lab.id
    owner.incoming_document_id = document.id
    db_session.add(owner)
    await db_session.flush()
    payload = ReconciliationWrite.model_validate(
        {
            "checks": {},
            "inspection": {"compartment": "COMPLIANT", "jointCarriage": "NONE"},
            "delivered": {"mass_kg": "120", "quantity": "4", "unit_id": ""},
            "accepted": {"mass_kg": "120", "quantity": "4", "unit_id": ""},
            "returned": {"mass_kg": "0", "quantity": "0", "unit_id": ""},
            "decision": None,
            "transaction": {"planned": False},
            "services": [],
        }
    )
    ctx = CommandContext(actor_id=actor.id, idempotency_key=str(uuid.uuid4()), expected_revision=owner.rev)
    await save_reconciliation(ctx, owner.id, payload, uow=db_session)  # type: ignore[arg-type]
    await db_session.commit()
    row = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == owner.id))
    ).scalar_one()
    # §8-3: an empty client unit is inherited from the source snapshot.
    assert row.delivered_unit_id == UNIT_GUID
    assert row.accepted_unit_id == UNIT_GUID
    assert row.returned_unit_id == UNIT_GUID

    # §5 fix round 1: a MISMATCHING saved GUID is normalized too.
    wrong = "11111111-2222-4333-8444-555555555555"
    row.accepted_unit_id = wrong
    await db_session.commit()
    ctx = CommandContext(actor_id=actor.id, idempotency_key=str(uuid.uuid4()), expected_revision=row.rev)
    await save_reconciliation(ctx, owner.id, payload, uow=db_session)  # type: ignore[arg-type]
    await db_session.commit()
    row = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == owner.id))
    ).scalar_one()
    assert row.delivered_unit_id == UNIT_GUID
    assert row.accepted_unit_id == UNIT_GUID
    assert row.returned_unit_id == UNIT_GUID
    view = build_reconciliation_view(row, owner, document)  # type: ignore[arg-type]
    assert view.accepted.unit_id == UNIT_GUID
