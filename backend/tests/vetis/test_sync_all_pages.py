"""DR7 §10.1 fixture tests: the full read-only pass imports ALL matching eVSDs.

Обезличенные pinned fixtures only — no credentials, no live VetIS calls.
These tests pin the acceptance criteria of dorabotka/2026-11-11-all-incoming-
vsd-arrivals.md: no fixed 1/2/20 limit, duplicate-safe upserts, honest
INTEGRATION_NOT_CONFIGURED, per-document kept/filtered diagnostics.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from backend.src.modules.arrivals.models import Party
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.models import VetisOperation
from backend.src.modules.integrations.vetis.transport import SpyTransport
from backend.tests.vetis.test_read_contract import doc, page, pinned_manifest
from backend.tests.vetis.test_sync import (
    ENTERPRISE,
    make_adapter,
    op_row,
    party_count,
    run,
    start,
    sync_env,  # noqa: F401 - pytest fixture re-exported for the test signatures
)


async def operation(env, operation_id: uuid.UUID) -> VetisOperation:
    return await op_row(env, operation_id)


# --- full passes of various sizes ----------------------------------------------


@pytest.mark.asyncio
async def test_full_pass_imports_21_documents(sync_env) -> None:  # noqa: F811
    env = sync_env
    docs = [doc(uuid.uuid4(), f"N-{index:05d}") for index in range(21)]
    transport = SpyTransport([page(21, 0, docs)])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "SUCCESS"
    assert row.pages_done == 1 and row.imported == 21
    assert await party_count(env) == 21
    assert row.diagnostics is not None
    assert row.diagnostics["received"] == 21
    assert row.diagnostics["kept"] == 21


@pytest.mark.asyncio
async def test_full_pass_imports_100_documents(sync_env) -> None:  # noqa: F811
    env = sync_env
    docs = [doc(uuid.uuid4(), f"N-{index:05d}") for index in range(100)]
    transport = SpyTransport([page(100, 0, docs)])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "SUCCESS" and row.imported == 100
    assert await party_count(env) == 100


@pytest.mark.asyncio
async def test_full_pass_imports_1000_documents(sync_env) -> None:  # noqa: F811
    env = sync_env
    docs = [doc(uuid.uuid4(), f"N-{index:06d}") for index in range(1000)]
    transport = SpyTransport([page(1000, 0, docs)])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "SUCCESS" and row.imported == 1000
    assert await party_count(env) == 1000


@pytest.mark.asyncio
async def test_two_matching_documents_on_two_pages_both_imported(sync_env) -> None:  # noqa: F811
    env = sync_env
    first, second = uuid.uuid4(), uuid.uuid4()
    transport = SpyTransport([page(2, 0, [doc(first, "1")]), page(2, 1, [doc(second, "2")])])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "SUCCESS"
    assert row.pages_done == 2 and row.imported == 2
    assert await party_count(env) == 2


@pytest.mark.asyncio
async def test_adapter_returns_two_items_from_one_page() -> None:
    """One page with two matching documents → items.length == 2 (spec §10.1)."""
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter

    transport = SpyTransport([page(2, 0, [doc(uuid.uuid4(), "1"), doc(uuid.uuid4(), "2")])])
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    scope = _scope()
    result = await adapter.list_incoming(scope, None, "fixture-initiator")
    assert len(result.items) == 2
    assert result.complete is True


# --- predicate diagnostics ------------------------------------------------------


@pytest.mark.asyncio
async def test_diagnostics_record_filter_reasons(sync_env) -> None:  # noqa: F811
    env = sync_env
    matching = [doc(uuid.uuid4(), "1"), doc(uuid.uuid4(), "2")]
    unfitting = [
        doc(uuid.uuid4(), "3", receiver="00000000-0000-0000-0000-0000000000e2"),
        doc(uuid.uuid4(), "4", status="WITHDRAWN"),
        doc(uuid.uuid4(), "5", product_type="4"),
        doc(uuid.uuid4(), "6", product_type=""),
    ]
    transport = SpyTransport([page(6, 0, matching + unfitting)])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "SUCCESS" and row.imported == 2
    assert row.diagnostics is not None
    assert row.diagnostics["received"] == 6
    assert row.diagnostics["kept"] == 2
    filtered = row.diagnostics["filtered"]
    assert filtered["receiver"] == 1
    assert filtered["status"] == 1
    assert filtered["product_type"] == 2


@pytest.mark.asyncio
async def test_same_issue_number_two_uuids_two_parties(sync_env) -> None:  # noqa: F811
    env = sync_env
    transport = SpyTransport([page(2, 0, [doc(uuid.uuid4(), "A-000001"), doc(uuid.uuid4(), "A-000001")])])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "SUCCESS"
    assert await party_count(env) == 2


# --- honesty ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unpinned_adapter_no_soap_and_honest_failed(sync_env) -> None:  # noqa: F811
    env = sync_env
    from pathlib import Path

    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.manifest import load_manifest
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    transport = SpyTransport()
    # The unpinned manifest comes straight from the committed resource file.
    manifest = load_manifest(Path(__file__).resolve().parents[2] / "resources" / "vetis" / "manifest.json")
    adapter = VetisReadAdapter(transport=transport, manifest=manifest)
    operation_id = await start(env)
    await run(env, operation_id, adapter)

    row = await operation(env, operation_id)
    assert row.state == "FAILED"
    assert row.problem_code == "INTEGRATION_NOT_CONFIGURED"
    assert transport.calls == []
    assert row.pages_done == 0 and row.imported == 0
    assert await party_count(env) == 0


@pytest.mark.asyncio
async def test_kept_document_import_error_fails_with_uuid(sync_env, monkeypatch) -> None:  # noqa: F811
    env = sync_env
    bad = uuid.uuid4()
    good = uuid.uuid4()
    original = sync.upsert_incoming

    async def flaky(db, item):  # noqa: ANN001
        if item.evsd_uuid == bad:
            raise ValueError("fixture upsert failure")
        return await original(db, item)

    monkeypatch.setattr(sync, "upsert_incoming", flaky)
    transport = SpyTransport([page(2, 0, [doc(good, "1"), doc(bad, "2")])])
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, transport))

    row = await operation(env, operation_id)
    assert row.state == "FAILED"
    assert row.problem_code == "VETIS_IMPORT_FAILED"
    assert str(bad) in (row.problem_detail or "")
    # The good document of the same page stays imported; the checkpoint
    # never moved and nothing was fabricated as a success.
    parties = (await env.db.execute(select(func.count()).select_from(Party))).scalar_one()
    assert int(parties) == 1


def _scope():
    from backend.src.modules.integrations.vetis.contracts import VetisScope
    from backend.src.modules.integrations.vetis.models import VetisContour

    return VetisScope(
        laboratory_id=uuid.uuid4(),
        contour=VetisContour.PILOT,
        business_member_id="00000000-0000-0000-0000-0000000000be",
        enterprise_id=ENTERPRISE,
    )
