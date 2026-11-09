"""ТЗ-10 V02 sync tests: full incoming pass, durable outbox, honest checkpoints.

All five named contract tests live here (plan 2026-11-06-10-vetis-read, Task
V02) plus the scheduler/dispatcher seam tests. The VetIS side is proven on
обезличенные pinned fixtures (the issued test profile is not available in this
environment — the live leg stays not-run; see docs/implementation evidence).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.identity.models import Laboratory, OutboxEntry, Territory
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.contracts import VetisScope
from backend.src.modules.integrations.vetis.models import (
    VetisBinding,
    VetisContour,
    VetisOperation,
    VetisSourceDocument,
)
from backend.tests.vetis.test_read_contract import (
    EMPTY_PAGE,
    FakeTransport,
    doc,
    page,
    pinned_manifest,
)

ENTERPRISE = "00000000-0000-0000-0000-0000000000e1"
MEMBER = "00000000-0000-0000-0000-0000000000be"

PAST = datetime.now(UTC) - timedelta(days=30)


# --- environment ---------------------------------------------------------------


@pytest.fixture
async def sync_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A laboratory with a registered VetIS binding and its own session factory."""
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(
        territory_id=territory.id, name="Агропромышленный парк", address="ул. Тестовая, 1", organization="ГБУ"
    )
    db_session.add(lab)
    await db_session.flush()
    binding = VetisBinding(
        laboratory_id=lab.id,
        contour=VetisContour.PILOT,
        business_member_id=MEMBER,
        enterprise_id=ENTERPRISE,
        initiator="fixture-read-initiator",
    )
    db_session.add(binding)
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        lab=lab,
        binding=binding,
        factory=async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )


def make_adapter(env: SimpleNamespace, transport):
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter

    return VetisReadAdapter(transport=transport, manifest=pinned_manifest(), issuer_id="fixture-issuer")


async def op_row(env: SimpleNamespace, operation_id: uuid.UUID) -> VetisOperation:
    async with env.factory() as session:
        return await session.get(VetisOperation, operation_id)


async def binding_row(env: SimpleNamespace) -> VetisBinding:
    async with env.factory() as session:
        return await session.get(VetisBinding, env.lab.id)


async def start(env: SimpleNamespace) -> uuid.UUID:
    accepted = await sync.start_sync(env.db, actor_id=uuid.uuid4(), laboratory_id=env.lab.id)
    await env.db.commit()
    return accepted.operation_id


async def run(env: SimpleNamespace, operation_id: uuid.UUID, adapter) -> None:
    await sync.run_sync(operation_id, adapter=adapter, session_factory=env.factory)


async def party_count(env: SimpleNamespace) -> int:
    async with env.factory() as session:
        return int((await session.execute(select(func.count()).select_from(Party))).scalar_one())


async def document_count(env: SimpleNamespace) -> int:
    async with env.factory() as session:
        return int((await session.execute(select(func.count()).select_from(IncomingDocument))).scalar_one())


class SpyWritePort:
    """A write-port spy: any call means the read stage performed a write."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def submit_receipt(self, intent: object, initiator: str) -> object:
        self.calls.append("submit_receipt")
        raise AssertionError("write stage must not run during V02")

    async def get_operation(self, application_id: str, initiator: str) -> object:
        self.calls.append("get_operation")
        raise AssertionError("write stage must not run during V02")

    async def reconcile_receipt(self, intent: object, initiator: str) -> object:
        self.calls.append("reconcile_receipt")
        raise AssertionError("write stage must not run during V02")


class HttpErrorTransport:
    """The gateway answers an HTTP error: never a parseable empty page."""

    def __init__(self) -> None:
        self.calls = 0

    async def send_application(self, application_xml: str) -> str:
        self.calls += 1
        return "fixture-application-id"

    async def receive_result(self, application_id: str) -> str:
        self.calls += 1
        raise ProblemError(
            status=502,
            code="VETIS_TRANSPORT_ERROR",
            title="VetIS transport error",
            detail="Шлюз ВетИС вернул ошибку HTTP 502.",
        )


class FailOnLastPage(FakeTransport):
    """Page one succeeds, the next receive is an HTTP error (real network shape)."""

    async def receive_result(self, application_id: str) -> str:
        self.calls.append({"kind": "receiveApplicationResultRequest"})
        if len(self.pages) <= 1:
            raise ProblemError(
                status=502,
                code="VETIS_TRANSPORT_ERROR",
                title="VetIS transport error",
                detail="Шлюз ВетИС вернул ошибку HTTP 502.",
            )
        return self.pages.pop(0)


# --- the five named contract tests ---------------------------------------------


async def test_final_page_failure_no_checkpoint(sync_env: SimpleNamespace) -> None:
    """A failure on the LAST page keeps the previous checkpoint; the walk is honest."""
    env = sync_env
    first, second = uuid.uuid4(), uuid.uuid4()
    await env.db.execute(update(VetisBinding).where(VetisBinding.laboratory_id == env.lab.id).values(last_success=PAST))
    await env.db.commit()

    operation_id = await start(env)
    transport = FailOnLastPage([page(2, 0, [doc(first, "1")]), page(2, 1, [doc(second, "2")])])
    await run(env, operation_id, make_adapter(env, transport))

    operation = await op_row(env, operation_id)
    assert operation.state == "FAILED"
    assert operation.problem_code == "VETIS_TRANSPORT_ERROR"
    # The checkpoint moved nowhere: last_success keeps its previous value.
    assert (await binding_row(env)).last_success == PAST
    # The first page was imported honestly (partial), the last page was not.
    assert await party_count(env) == 1
    assert await document_count(env) == 1


async def test_repeat_job_no_duplicates(sync_env: SimpleNamespace) -> None:
    """A repeat of the full pass never duplicates parties/documents."""
    env = sync_env
    first, second = uuid.uuid4(), uuid.uuid4()
    transport = FakeTransport([page(2, 0, [doc(first, "1"), doc(second, "2")])])
    adapter = make_adapter(env, transport)

    for _ in range(2):
        operation_id = await start(env)
        await run(env, operation_id, adapter)

    assert await party_count(env) == 2
    assert await document_count(env) == 2
    # Raw XML journalled per external UUID, with checksum and a revision.
    async with env.factory() as session:
        sources = (await session.execute(select(VetisSourceDocument))).scalars().all()
    assert len(sources) == 2
    assert all(len(source.checksum) == 64 for source in sources)
    assert all(source.raw_xml.strip().startswith("<") for source in sources)
    assert all(source.revision >= 1 for source in sources)
    assert all(source.updated_at is not None for source in sources)
    # A document that disappeared from the source list is never annulled:
    # sync only upserts, it never deletes local rows or their facts.
    assert (await binding_row(env)).last_success is not None


async def test_revocation_before_next_page(sync_env: SimpleNamespace) -> None:
    """Revoking the binding between pages stops the run before the next SOAP."""
    env = sync_env
    first, second = uuid.uuid4(), uuid.uuid4()
    transport = FakeTransport([page(2, 0, [doc(first, "1")]), page(2, 1, [doc(second, "2")])])
    inner = make_adapter(env, transport)
    calls: list[int] = []

    class RevokingAdapter:
        async def list_incoming(self, scope: VetisScope, cursor: str | None, initiator: str):
            result = await inner.list_incoming(scope, cursor, initiator)
            calls.append(1)
            if len(calls) == 1:
                async with env.factory() as session:
                    await session.execute(
                        update(VetisBinding)
                        .where(VetisBinding.laboratory_id == env.lab.id)
                        .values(revoked_at=datetime.now(UTC))
                    )
                    await session.commit()
            return result

    operation_id = await start(env)
    await run(env, operation_id, RevokingAdapter())

    operation = await op_row(env, operation_id)
    assert operation.state == "FAILED"
    assert operation.problem_code == "INTEGRATION_SCOPE_REVOKED"
    assert len(calls) == 1  # no SOAP after the revocation
    assert await party_count(env) == 1  # page one only — an honest partial pass
    assert (await binding_row(env)).last_success is None


async def test_empty_vs_error(sync_env: SimpleNamespace) -> None:
    """An HTTP error is never reported as a successful empty pass."""
    env = sync_env
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, HttpErrorTransport()))

    failed = await op_row(env, operation_id)
    assert failed.state == "FAILED"
    assert failed.problem_code == "VETIS_TRANSPORT_ERROR"
    assert (await binding_row(env)).last_success is None  # never a fabricated success

    # A genuinely empty complete page IS a successful run.
    second_id = await start(env)
    await run(env, second_id, make_adapter(env, FakeTransport([EMPTY_PAGE])))
    success = await op_row(env, second_id)
    assert success.state == "SUCCESS"
    assert (await binding_row(env)).last_success is not None


async def test_no_write_on_read_stage(sync_env: SimpleNamespace) -> None:
    """The read stage never touches the write port while VETIS_WRITE_ENABLED=false."""
    from backend.src.infrastructure.config.settings import get_settings
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    assert get_settings().vetis_write_enabled is False

    env = sync_env
    evsd = uuid.uuid4()
    spy = SpyTransport([page(1, 0, [doc(evsd, "1")])])
    write_spy = SpyWritePort()

    operation_id = await start(env)
    await sync.run_sync(
        operation_id,
        adapter=make_adapter(env, spy),
        session_factory=env.factory,
        write_port=write_spy,
    )
    assert write_spy.calls == []  # spy submit_receipt never called
    assert spy.write_calls == 0
    assert spy.product_service_calls == 0
    operation = await op_row(env, operation_id)
    assert operation.state == "SUCCESS"


# --- scheduler / dispatcher / outbox seams -------------------------------------


async def test_start_sync_is_atomic_and_idempotent(sync_env: SimpleNamespace) -> None:
    """Intent + outbox row are one transaction; a repeat reuses the pending op."""
    env = sync_env
    first = await sync.start_sync(env.db, actor_id=uuid.uuid4(), laboratory_id=env.lab.id)
    await env.db.commit()
    second = await sync.start_sync(env.db, actor_id=uuid.uuid4(), laboratory_id=env.lab.id)
    await env.db.commit()
    assert first.operation_id == second.operation_id
    outbox = (
        (await env.db.execute(select(OutboxEntry).where(OutboxEntry.operation_id == first.operation_id)))
        .scalars()
        .all()
    )
    assert len(outbox) == 1
    assert outbox[0].event_type == "vetis.sync"
    assert first.status_url.endswith(f"/operations/{first.operation_id}")


async def test_scheduler_interval_and_overlap(sync_env: SimpleNamespace) -> None:
    """The 15-minute scheduler never overlaps an in-flight run and respects the interval."""
    env = sync_env
    now = datetime.now(UTC)
    created = await sync.schedule_scheduled_syncs(env.db, now=now, actor_id=uuid.uuid4())
    await env.db.commit()
    assert len(created) == 1  # binding without a fresh success → a run is due
    again = await sync.schedule_scheduled_syncs(env.db, now=now, actor_id=uuid.uuid4())
    await env.db.commit()
    assert again == []  # overlap protection: the PENDING run is reused, not duplicated

    # A fresh checkpoint inside the interval does not schedule anything.
    await env.db.execute(
        update(VetisOperation)
        .where(VetisOperation.id == created[0].operation_id)
        .values(state="SUCCESS", last_success=now - timedelta(minutes=5))
    )
    await env.db.execute(
        update(VetisBinding)
        .where(VetisBinding.laboratory_id == env.lab.id)
        .values(last_success=now - timedelta(minutes=5))
    )
    await env.db.commit()
    third = await sync.schedule_scheduled_syncs(env.db, now=now, actor_id=uuid.uuid4())
    await env.db.commit()
    assert third == []


async def test_dispatcher_restores_pending_after_restart(sync_env: SimpleNamespace) -> None:
    """After a restart the dispatcher re-enqueues every pending/stale operation."""
    env = sync_env
    operation_id = await start(env)
    # Simulate the crash: the outbox row is lost, the op stayed PENDING.
    await env.db.execute(OutboxEntry.__table__.delete().where(OutboxEntry.operation_id == operation_id))
    await env.db.commit()

    restored = await sync.recover_pending_operations(env.db)
    await env.db.commit()
    assert operation_id in restored
    rows = (await env.db.execute(select(OutboxEntry).where(OutboxEntry.operation_id == operation_id))).scalars().all()
    assert len(rows) == 1 and rows[0].delivered_at is None

    # A stale RUNNING lease (older than the lease window) is also recovered.
    await env.db.execute(
        update(VetisOperation)
        .where(VetisOperation.id == operation_id)
        .values(state="RUNNING", updated_at=datetime.now(UTC) - timedelta(hours=1))
    )
    await env.db.commit()
    restored_again = await sync.recover_pending_operations(env.db)
    await env.db.commit()
    assert operation_id in restored_again
    assert (await op_row(env, operation_id)).state == "PENDING"


async def test_worker_claims_and_runs_due_lease(sync_env: SimpleNamespace) -> None:
    """The lease worker claims one due row and drives it to a terminal state."""
    from backend.src.modules.integrations.vetis import worker
    from backend.src.modules.integrations.vetis.models import VetisOperationState

    env = sync_env
    first, second = uuid.uuid4(), uuid.uuid4()
    transport = FakeTransport([page(2, 0, [doc(first, "1"), doc(second, "2")])])
    adapter = make_adapter(env, transport)

    operation_id = await start(env)
    claimed = await worker.claim_due_operation(env.db, owner="fixture-worker")
    await env.db.commit()
    assert claimed == operation_id
    assert await worker.claim_due_operation(env.db, owner="fixture-worker") is None  # lease held

    delivered = await worker.run_claimed(
        env.db, claimed, adapter=adapter, owner="fixture-worker", session_factory=env.factory
    )
    await env.db.commit()
    assert delivered is True
    assert (await op_row(env, claimed)).state == VetisOperationState.SUCCESS
    # The outbox row is delivered; nothing is claimed afterwards.
    rows = (await env.db.execute(select(OutboxEntry).where(OutboxEntry.operation_id == claimed))).scalars().all()
    assert all(row.delivered_at is not None for row in rows)
    assert await worker.claim_due_operation(env.db, owner="fixture-worker") is None
    assert await party_count(env) == 2


async def test_dispatcher_module_restores_through_composition(sync_env: SimpleNamespace) -> None:
    """The dispatcher composition surface restores the same journal rows."""
    from backend.src.modules.integrations.vetis.dispatcher import dispatch_pending_operations

    env = sync_env
    operation_id = await start(env)
    await env.db.execute(OutboxEntry.__table__.delete().where(OutboxEntry.operation_id == operation_id))
    await env.db.commit()
    restored = await dispatch_pending_operations(env.db)
    await env.db.commit()
    assert operation_id in restored
    rows = (await env.db.execute(select(OutboxEntry).where(OutboxEntry.operation_id == operation_id))).scalars().all()
    assert len(rows) == 1


async def test_composed_adapter_refuses_live_calls_without_pins() -> None:
    """The worker composition never skips pin verification (honest 503)."""
    from backend.src.modules.integrations.vetis import worker

    adapter = worker.compose_read_adapter()
    with pytest.raises(ProblemError) as raised:
        adapter.require_live_ready()
    assert raised.value.status == 503
    assert raised.value.code == "INTEGRATION_NOT_CONFIGURED"
