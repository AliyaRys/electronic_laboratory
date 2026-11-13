"""ТЗ DR23 §7.6: the reconciliation endpoint returns the WORKER-resolved names.

The receiver names reach the GET only through ``resolve_due_reference_names``
(the pinned read-only lookups) — no manual SQL UPDATE of a name anywhere. The
VetIS boundary is a spy; live VetIS calls in tests are FORBIDDEN.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from sqlalchemy import select

from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.models import IncomingDocument
from backend.src.modules.arrivals.reconciliation import resolved_participant_names
from backend.src.modules.arrivals.schemas import (
    ConsignorConsignee,
    ExternalRef,
    SourceSnapshot,
)
from backend.src.modules.integrations.vetis.reference_names import resolve_due_reference_names
from backend.src.modules.integrations.vetis.transport import SpyEnterpriseLookupTransport
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_dr18_participant_names import _guid_only_document
from backend.tests.vetis.test_dr23_runtime_manifest import (
    RECEIVER_BE,
    RECEIVER_ENT,
    business_entity_response,
    enterprise_response,
)


async def test_tick_resolution_reaches_the_reconciliation_endpoint(
    arrivals_vet_env: SimpleNamespace,  # noqa: F811
) -> None:
    env = arrivals_vet_env
    evsd = uuid.uuid4()
    base = _guid_only_document(evsd, env.own.id)
    vd = base.snapshot.vd_document.model_copy(
        update={
            "consignor": ConsignorConsignee(name="", businessEntity=None, enterprise=None),
            "consignee": ConsignorConsignee(
                name="",
                businessEntity=ExternalRef(guid=RECEIVER_BE, uuid=RECEIVER_BE),
                enterprise=ExternalRef(guid=RECEIVER_ENT, uuid=RECEIVER_ENT),
            ),
        }
    )
    party = await commands.upsert_incoming(env.db, base.model_copy(update={"snapshot": SourceSnapshot(vdDocument=vd)}))
    await env.db.commit()
    document_row = (
        await env.db.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()

    # Before the worker tick: honest PENDING, no names, no GUIDs.
    names = await resolved_participant_names(env.db, document_row)
    assert names["receiverOwnerNameSource"] == "PENDING"
    assert names["receiverOwner"] is None

    async with _client_for(env) as (http, _identity):
        first = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")
        assert first.status_code == 200 and first.json()["errors"] == []

        # The worker tick resolves the receiver rows via the two read-only
        # lookups; the spy stands in for the pinned EnterpriseService.
        spy = SpyEnterpriseLookupTransport(
            enterprise_responses=[
                enterprise_response(RECEIVER_ENT, active=True, last=True),
                enterprise_response(RECEIVER_ENT, active=True, last=True),
            ],
            business_entity_responses=[
                business_entity_response(RECEIVER_BE),
                business_entity_response(RECEIVER_BE),
            ],
        )
        counters = await resolve_due_reference_names(env.db, spy, contour="PILOT")
        await env.db.commit()
        assert counters["resolved"] >= 2

        second = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")
        assert second.status_code == 200 and second.json()["errors"] == []
    final_names = await resolved_participant_names(env.db, document_row)
    assert final_names["receiverOwner"] == "ОАО «Восход»"
    assert final_names["receiverEnterprise"] == "Лабораторный убойный пункт"
    assert final_names["receiverOwnerNameSource"] == "VETIS_LOOKUP"
    assert final_names["receiverEnterpriseNameSource"] == "VETIS_LOOKUP"
    # The raw GUID/UUID never replaces a name in the read model.
    assert str(RECEIVER_BE) not in (final_names["receiverOwner"] or "")
