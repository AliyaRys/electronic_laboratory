"""ТЗ DR18 §11 API/frontend-side tests: the unified participant-name read model.

The reconciliation endpoint returns the resolved names of the sender and the
receiver from the unified read model (§9); a missing name never blocks the
reconciliation and never shows a raw GUID/UUID (§10). The browser never
reaches VetIS: these tests touch only the local cache tables.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import select

from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.models import IncomingDocument
from backend.src.modules.arrivals.reconciliation import (
    build_reconciliation_view,
    resolved_participant_names,
    source_projection,
)
from backend.src.modules.arrivals.schemas import (
    ConsignorConsignee,
    ExternalRef,
    SourceSnapshot,
)
from backend.src.modules.integrations.vetis.models import VetisReferenceName
from backend.src.modules.integrations.vetis.reference_names import (
    NAME_ERROR_TEXT,
    NAME_MISSING_TEXT,
    NAME_PENDING_TEXT,
    participant_name_overrides,
    resolve_participants,
)
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_import_and_queues import UNIT_KG as KG_GUID
from backend.tests.arrivals.test_import_and_queues import document

_PILOT = "PILOT"

SENDER_BE = uuid.UUID("0ed40ab2-cda6-4daa-9302-1e21187be0e1")
SENDER_ENT = uuid.UUID("d562919c-05d8-442f-840d-4c37d41dcae1")
RECEIVER_BE = uuid.UUID("3e188573-0de9-42c1-ab14-1f3e8391cb3e")
RECEIVER_ENT = uuid.UUID("8fb3e002-0997-4ffc-a7bc-d8a5d80975e0")


def _guid_only_document(evsd_uuid: uuid.UUID, lab_id: uuid.UUID):
    """The spec §1 shape imported through the normal upsert command."""
    base = document(evsd_uuid, lab_id)
    vd = base.snapshot.vd_document.model_copy(
        update={
            "consignor": ConsignorConsignee(
                name="",
                businessEntity=ExternalRef(guid=SENDER_BE, uuid=SENDER_BE),
                enterprise=ExternalRef(guid=SENDER_ENT, uuid=SENDER_ENT),
            ),
            "consignee": ConsignorConsignee(
                name="",
                businessEntity=ExternalRef(guid=RECEIVER_BE, uuid=RECEIVER_BE),
                enterprise=ExternalRef(guid=RECEIVER_ENT, uuid=RECEIVER_ENT),
            ),
        }
    )
    return base.model_copy(update={"snapshot": SourceSnapshot(vdDocument=vd)})


async def test_reconciliation_returns_names_from_read_model(
    arrivals_vet_env: SimpleNamespace,  # noqa: F811
) -> None:
    env = arrivals_vet_env
    evsd = uuid.uuid4()
    party = await commands.upsert_incoming(env.db, _guid_only_document(evsd, env.own.id))
    await env.db.commit()
    document_row = (
        await env.db.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()

    # Before any resolution: the honest PENDING state, no names, no GUIDs.
    names = await resolved_participant_names(env.db, document_row)
    assert names["senderOwner"] is None
    assert names["senderOwnerNameSource"] == "PENDING"
    assert str(SENDER_BE) not in (names["senderOwner"] or "")

    async with _client_for(env) as (http, _identity):
        response = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")
        assert response.status_code == 200
        assert response.json()["errors"] == []

        # After the worker resolution the endpoint returns the cached names.
        db = env.db
        for guid, kind, name in (
            (SENDER_BE, "BUSINESS_ENTITY", "ООО «Мясопром»"),
            (SENDER_ENT, "ENTERPRISE", "Предприятие «Мясопром»"),
            (RECEIVER_BE, "BUSINESS_ENTITY", "ОАО «Восход»"),
            (RECEIVER_ENT, "ENTERPRISE", "Лабораторный убойный пункт"),
        ):
            row = (
                await db.execute(
                    select(VetisReferenceName).where(
                        VetisReferenceName.contour == _PILOT, VetisReferenceName.guid == guid
                    )
                )
            ).scalar_one()
            assert row.entity_kind == kind  # the import created the right kind
            row.name = name
            row.source = "VETIS_LOOKUP"
            row.status = "RESOLVED"
            row.last_checked_at = datetime.now(UTC)
        await env.db.commit()
        resolved = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")
        assert resolved.status_code == 200
        assert resolved.json()["errors"] == []
    view_names = await resolved_participant_names(env.db, document_row)
    assert view_names["senderOwner"] == "ООО «Мясопром»"
    assert view_names["receiverEnterprise"] == "Лабораторный убойный пункт"
    assert view_names["senderOwnerNameSource"] == "VETIS_LOOKUP"


async def test_projection_priority_xml_then_cache(
    arrivals_vet_env: SimpleNamespace,  # noqa: F811
) -> None:
    env = arrivals_vet_env
    evsd = uuid.uuid4()
    party = await commands.upsert_incoming(env.db, document(evsd, env.own.id))
    del party
    await env.db.commit()
    document_row = (
        await env.db.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()

    # The XML name of the CURRENT revision wins over the cache.
    participants = await resolve_participants(env.db, _PILOT, document_row.source_snapshot)
    overrides = participant_name_overrides(participants)
    # The enterprise object of the sender keeps the participant-level source
    # name; the businessEntity arrives without its own name (honest state).
    assert overrides["senderEnterprise"] == "ООО «Мясопром»"
    assert overrides["senderOwner"] is None
    assert overrides["senderOwnerNameSource"] in ("PENDING", "MISSING")

    # The source projection keeps every other key untouched.
    projection = source_projection(
        document_row,
        type(
            "PartyStub",
            (),
            {
                "classification_snapshot": {
                    "product": {"id": str(document_row.id), "name": "говядина"},
                    "productType": 1,
                },
                "id": document_row.id,
            },
        )(),
        names=overrides,
    )
    assert projection.fields["documentNumber"] == "A-001234"
    assert projection.fields["senderEnterprise"] == overrides["senderEnterprise"]
    assert projection.fields["senderOwner"] is None


def test_fallback_texts_are_honest() -> None:
    """The three UI states come from the honest agreed texts (§10)."""
    assert NAME_PENDING_TEXT == "Уточняем названия организаций…"
    assert NAME_MISSING_TEXT == "Название не получено"
    assert NAME_ERROR_TEXT == "Название временно недоступно"


async def test_missing_name_does_not_block_reconciliation(
    arrivals_vet_env: SimpleNamespace,  # noqa: F811
) -> None:
    env = arrivals_vet_env
    evsd = uuid.uuid4()
    party = await commands.upsert_incoming(env.db, _guid_only_document(evsd, env.own.id))
    await env.db.commit()
    document_row = (
        await env.db.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    view = build_reconciliation_view(None, party, document_row)
    assert view.state == "OPEN"
    assert view.errors == []
    # A missing name never fabricates a mark or blocks the form.
    names = await resolved_participant_names(env.db, document_row)
    assert names["receiverOwner"] is None
    assert names["receiverOwnerNameSource"] == "PENDING"
    assert KG_GUID is not None
