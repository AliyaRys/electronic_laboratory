"""DR39: reconciliation metadata (completed_at, frozen pricing, author) of the
arrivals list/single read models.

The summary is built server-side from ``Reconciliation`` — the client never
re-reads users and never recalculates the frozen snapshot. A tariff change
after the save never changes the published amount; an absent summary is
honest ``null`` and a saved zero stays zero.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import event, select, update

from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.models import Reconciliation
from backend.src.modules.catalog_pricing.models import Tariff
from backend.src.modules.identity.models import User
from backend.tests.arrivals.test_api import _client_for, vet_env  # noqa: F401,F811
from backend.tests.fixtures.receipt_evidence import (
    FixtureReceiptEvidenceReader,
    confirm_via_reader,
    party_evsd_uuid,
    receipt_evidence,
)
from backend.tests.arrivals.test_dr11_pricing import full_body
from backend.tests.arrivals.test_import_and_queues import document

pytestmark = pytest.mark.integration


async def _work_party(env, *, completed_at=None) -> object:
    """One party of the WORK queue: saved full reconciliation + receipt."""
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()
    async with _client_for(env) as (http, identity):
        response = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers={
                "x-csrf-token": identity.csrf_token,
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
                "if-match": '"1"',
            },
        )
        assert response.status_code == 200, response.text
    reader = FixtureReceiptEvidenceReader()
    reader.plant(party.id, receipt_evidence(await party_evsd_uuid(env.db, party.id)))
    confirmed = await confirm_via_reader(env.db, reader, party.id)
    assert confirmed is not None
    await env.db.commit()
    if completed_at is not None:
        await env.db.execute(update(Reconciliation).where(Reconciliation.party_id == party.id).values(completed_at=completed_at))
        await env.db.commit()
    return party


async def _work_items(env, **params: object) -> list[dict]:
    async with _client_for(env) as (http, _):
        response = await http.get(
            "/api/v1/arrivals",
            params={"laboratory_id": str(env.own.id), "queue": "WORK", **params},
        )
        assert response.status_code == 200, response.text
        return response.json()["items"]


async def test_work_list_carries_reconciliation_summary(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _work_party(env)
    items = await _work_items(env)
    assert len(items) == 1
    reconciliation = items[0]["reconciliation"]
    assert reconciliation is not None
    assert reconciliation["completed_at"] is not None
    assert reconciliation["author_name"] == "Ветеринарный врач"
    assert reconciliation["pricing"] is not None
    assert reconciliation["pricing"]["total"] == "230.00"
    assert reconciliation["pricing"]["currency"] == "RUB"


async def test_single_arrival_view_carries_the_same_summary(vet_env) -> None:  # noqa: F811
    env = vet_env
    party = await _work_party(env)
    async with _client_for(env) as (http, _):
        response = await http.get(f"/api/v1/arrivals/{party.id}")
        assert response.status_code == 200, response.text
        reconciliation = response.json()["reconciliation"]
        assert reconciliation is not None
        assert reconciliation["author_name"] == "Ветеринарный врач"
        assert reconciliation["pricing"]["total"] == "230.00"


async def test_tariff_change_after_save_never_changes_list_amount(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _work_party(env)
    await env.db.execute(update(Tariff).where(Tariff.laboratory_id == env.own.id).values(price=Decimal("999.00")))
    await env.db.commit()
    items = await _work_items(env)
    assert items[0]["reconciliation"]["pricing"]["total"] == "230.00"


async def test_saved_zero_total_is_zero_not_null(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _work_party(env)
    row = (await env.db.execute(select(Reconciliation))).scalar_one()
    snapshot = dict(row.pricing_snapshot)
    snapshot["total"] = "0.00"
    await env.db.execute(update(Reconciliation).where(Reconciliation.id == row.id).values(pricing_snapshot=snapshot))
    await env.db.commit()
    items = await _work_items(env)
    assert items[0]["reconciliation"]["pricing"]["total"] == "0.00"


async def test_confirmation_without_reconciliation_keeps_null_summary(vet_env) -> None:  # noqa: F811
    """A legacy WORK row (receipt only, no saved reconciliation) stays honest null."""
    env = vet_env
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()
    reader = FixtureReceiptEvidenceReader()
    reader.plant(party.id, receipt_evidence(await party_evsd_uuid(env.db, party.id)))
    assert await confirm_via_reader(env.db, reader, party.id) is not None
    await env.db.commit()
    items = await _work_items(env)
    assert len(items) == 1
    assert items[0]["reconciliation"] is None


async def test_author_is_loaded_without_per_row_user_queries(vet_env) -> None:  # noqa: F811
    """No N+1: a page of rows resolves the author with at most ONE users read."""
    env = vet_env
    for _ in range(3):
        await _work_party(env)
    statements: list[str] = []

    def _spy(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        statements.append(str(statement))

    event.listen(env.engine.sync_engine, "before_cursor_execute", _spy)
    try:
        items = await _work_items(env)
    finally:
        event.remove(env.engine.sync_engine, "before_cursor_execute", _spy)
    assert len(items) == 3
    user_reads = [
        text
        for text in statements
        if "users" in text.lower() and "select" in text.lower() and "for update" not in text.lower()
    ]
    assert len(user_reads) <= 1, user_reads
    await env.db.execute(select(User).limit(0))  # keep the import meaningful
    assert all(item["reconciliation"]["author_name"] == "Ветеринарный врач" for item in items)


async def test_no_reconciliation_row_never_fabricates_a_summary(vet_env) -> None:  # noqa: F811
    """An EXPECTED row without any reconciliation never gets a fabricated author/date."""
    env = vet_env
    await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()
    items = await _work_items(env, queue="EXPECTED")
    assert all(item["reconciliation"] is None for item in items)
