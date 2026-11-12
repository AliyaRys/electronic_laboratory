"""ТЗ DR9 sync tests: freshness of gassed-out eVSDs, full-pass deactivation.

All checks run on обезличенные pinned fixtures + spies; the live VetIS leg
stays not-run and NO write operation is ever invoked (the read stage is
flag-agnostic — see test_sync.py::test_no_write_on_read_stage).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.modules.arrivals.models import HiddenIncoming, IncomingDocument, Party, ReceiptConfirmation
from backend.src.modules.arrivals.queries import arrival_page
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.models import VetisBinding, VetisContour
from backend.tests.vetis.test_read_contract import FakeTransport, doc, page
from backend.tests.vetis.test_sync import (
    FailOnLastPage,
    HttpErrorTransport,
    binding_row,
    make_adapter,
    op_row,
)

ENTERPRISE = "00000000-0000-0000-0000-0000000000e1"
MEMBER = "00000000-0000-0000-0000-0000000000be"

PAST = datetime.now(UTC) - timedelta(days=30)


@pytest.fixture
async def dr9_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A laboratory with a registered VetIS binding and its own session factory."""
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(
        territory_id=territory.id, name="Агропромышленный парк", address="ул. Тестовая, 1", organization="ГБУ"
    )
    user = User(
        login="vet-dr9-sync",
        full_name="Ветеринарный врач",
        email="vet-dr9-sync@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(lab)
    db_session.add(user)
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
        user=user,
        binding=binding,
        factory=async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )


async def run_pass(env: SimpleNamespace, transport) -> str:
    """One full sync pass; returns the operation id."""
    accepted = await sync.start_sync(env.db, actor_id=uuid.uuid4(), laboratory_id=env.lab.id)
    await env.db.commit()
    adapter = make_adapter(env, transport)
    await sync.run_sync(accepted.operation_id, adapter=adapter, session_factory=env.factory)
    return accepted.operation_id


async def documents(env: SimpleNamespace) -> dict[str, IncomingDocument]:
    async with env.factory() as session:
        rows = (await session.execute(select(IncomingDocument))).scalars().all()
    return {str(row.evsd_uuid): row for row in rows}


def diagnose(operation) -> dict[str, object]:
    return dict(operation.diagnostics or {})


# --- 1/2/4/5. Observed set, staleness, duplicates, reappearance -----------------


async def test_full_pass_observed_set_and_staleness(dr9_env: SimpleNamespace) -> None:
    """Pass 1 imports A+B (both CURRENT_CONFIRMED); pass 2 without A marks A stale."""
    env = dr9_env
    a, b = uuid.uuid4(), uuid.uuid4()

    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))
    docs = await documents(env)
    assert docs[str(a)].source_presence == "CURRENT_CONFIRMED"
    assert docs[str(b)].source_presence == "CURRENT_CONFIRMED"
    assert docs[str(a)].last_seen_sync_at is not None

    # A repeat of the same pass never duplicates parties/documents.
    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))
    async with env.factory() as session:
        assert len((await session.execute(select(Party))).scalars().all()) == 2

    # The gassed-out pass: A is gone from the FULL observed set, B stays.
    operation_id = await run_pass(env, FakeTransport([page(1, 0, [doc(b, "2")])]))
    operation = await op_row(env, operation_id)
    assert operation.state == "SUCCESS"
    docs = await documents(env)
    assert docs[str(a)].source_presence == "NOT_IN_CURRENT_CONFIRMED_LIST"
    assert docs[str(a)].source_presence_reason == "not_in_confirmed_list"
    assert docs[str(a)].presence_changed_at is not None
    assert docs[str(b)].source_presence == "CURRENT_CONFIRMED"
    # The document is never deleted and the party stays.
    async with env.factory() as session:
        assert len((await session.execute(select(IncomingDocument))).scalars().all()) == 2
        assert len((await session.execute(select(Party))).scalars().all()) == 2

    # EXPECTED excludes the stale document even without a reconciliation.
    async with env.factory() as session:
        parties, _, total = await arrival_page(
            session, laboratory_id=env.lab.id, queue="EXPECTED", result=None, query=None, page=1
        )
    assert total == 1

    # A reappearance as CONFIRMED restores the activity without a duplicate.
    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))
    docs = await documents(env)
    assert docs[str(a)].source_presence == "CURRENT_CONFIRMED"
    assert docs[str(a)].source_presence_reason is None
    async with env.factory() as session:
        assert len((await session.execute(select(Party))).scalars().all()) == 2


async def test_last_page_failure_never_touches_freshness(dr9_env: SimpleNamespace) -> None:
    """An error on the LAST page keeps freshness, the checkpoint and no counters."""
    env = dr9_env
    a, b = uuid.uuid4(), uuid.uuid4()
    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))

    await env.db.execute(update(VetisBinding).where(VetisBinding.laboratory_id == env.lab.id).values(last_success=PAST))
    await env.db.commit()

    operation_id = await run_pass(
        env,
        FailOnLastPage([page(2, 0, [doc(b, "2")]), page(2, 1, [doc(uuid.uuid4(), "3")])]),
    )
    operation = await op_row(env, operation_id)
    assert operation.state == "FAILED"
    assert (await binding_row(env)).last_success == PAST
    docs = await documents(env)
    assert docs[str(a)].source_presence == "CURRENT_CONFIRMED"  # untouched by the failed run
    assert docs[str(a)].source_presence_reason is None
    assert "marked_not_current" not in diagnose(operation)  # counters only after a FULL pass

    # A transport failure is equally honest and equally inert.
    second_id = await run_pass(env, HttpErrorTransport())
    assert (await op_row(env, second_id)).state == "FAILED"
    docs = await documents(env)
    assert docs[str(b)].source_presence == "CURRENT_CONFIRMED"


async def test_filtered_documents_join_the_observed_set(dr9_env: SimpleNamespace) -> None:
    """A filtered (wrong receiver/type/productType) UUID is OBSERVED with diagnostics.

    A filtered UUID is never silently deleted: it stays out of the import but
    enters the observed set, and the обезличенные diagnostics name the reason.
    """
    env = dr9_env
    a = uuid.uuid4()
    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1")])]))

    # The next pass shows a foreign-receiver document instead of A.
    operation_id = await run_pass(
        env,
        FakeTransport(
            [
                page(
                    2,
                    0,
                    [
                        doc(uuid.uuid4(), "2", receiver="00000000-0000-0000-0000-0000000000e2"),
                        doc(uuid.uuid4(), "3", product_type="4"),
                    ],
                )
            ]
        ),
    )
    operation = await op_row(env, operation_id)
    assert operation.state == "SUCCESS"
    counters = diagnose(operation)
    assert counters["filtered_receiver"] == 1
    assert counters["filtered_product_type"] == 1
    assert counters["observed_uuids"] == 2  # the full set, NOT only the imported ones
    assert counters["kept"] == 0
    # A remains stale: it was absent from this full pass.
    docs = await documents(env)
    assert docs[str(a)].source_presence == "NOT_IN_CURRENT_CONFIRMED_LIST"

    # A filtered-but-locally-known document is OBSERVED and stays current.
    filtered_uuid = uuid.uuid4()
    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(filtered_uuid, "9", status="WITHDRAWN")])]))
    docs = await documents(env)
    assert filtered_uuid not in docs  # the filtered document is not imported
    assert docs[str(a)].source_presence == "CURRENT_CONFIRMED"  # but the pass observed it


async def test_empty_correct_full_pass_deactivates_and_recovers(dr9_env: SimpleNamespace) -> None:
    """A valid total=0 full pass deactivates all active rows (valid scope only)."""
    env = dr9_env
    a = uuid.uuid4()
    await run_pass(env, FakeTransport([page(1, 0, [doc(a, "1")])]))

    operation_id = await run_pass(env, FakeTransport([page(0, 0, [])]))
    operation = await op_row(env, operation_id)
    assert operation.state == "SUCCESS"
    assert (await binding_row(env)).last_success is not None
    counters = diagnose(operation)
    assert counters["external_total"] == 0
    assert counters["marked_not_current"] == 1
    docs = await documents(env)
    assert docs[str(a)].source_presence == "NOT_IN_CURRENT_CONFIRMED_LIST"

    # A failed/errored run NEVER empties the queue: an error is not an empty list.
    failed_id = await run_pass(env, HttpErrorTransport())
    assert (await op_row(env, failed_id)).state == "FAILED"
    docs = await documents(env)
    assert docs[str(a)].source_presence == "NOT_IN_CURRENT_CONFIRMED_LIST"  # no further change


async def test_user_hiding_and_external_absence_stay_separate(dr9_env: SimpleNamespace) -> None:
    """The user's hide decision is not an external absence and vice versa."""
    env = dr9_env
    a, b = uuid.uuid4(), uuid.uuid4()
    await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))
    docs = await documents(env)
    async with env.factory() as session:
        session.add(
            HiddenIncoming(
                contour="PILOT",
                evsd_uuid=uuid.UUID(str(a)),
                content_hash=docs[str(a)].content_hash,
                actor_id=env.user.id,
            )
        )
        await session.commit()

    # A disappears externally; B stays observed (the hidden B keeps its decision).
    await run_pass(env, FakeTransport([page(1, 0, [doc(b, "2")])]))
    async with env.factory() as session:
        hidden = (await session.execute(select(HiddenIncoming))).scalars().all()
    assert len(hidden) == 1
    assert str(hidden[0].evsd_uuid) == str(a)  # untouched by the sync
    docs = await documents(env)
    assert docs[str(a)].source_presence == "NOT_IN_CURRENT_CONFIRMED_LIST"  # the external fact
    assert docs[str(b)].source_presence == "CURRENT_CONFIRMED"  # observed, still hidden locally


async def test_legal_facts_survive_the_deactivation(dr9_env: SimpleNamespace) -> None:
    """A gassed-out externally (stale) document keeps its local confirmation fact."""
    env = dr9_env
    a = uuid.uuid4()
    await run_pass(env, FakeTransport([page(1, 0, [doc(a, "1")])]))
    docs = await documents(env)
    async with env.factory() as session:
        party = (await session.execute(select(Party))).scalar_one()
        confirmation = ReceiptConfirmation(
            party_id=party.id,
            operation_id=uuid.uuid4(),
            source_evsd_uuid=uuid.UUID(str(a)),
            fingerprint="fixture-fingerprint",
            evidence={"fixture": True},
            accepted_mass_kg=1,
            accepted_quantity=1,
            accepted_unit_id="fixture-unit",
            classification_snapshot={},
        )
        session.add(confirmation)
        await session.commit()

    # A disappears from the external confirmed list: the local fact stays.
    await run_pass(env, FakeTransport([page(0, 0, [])]))
    docs = await documents(env)
    assert docs[str(a)].source_presence == "NOT_IN_CURRENT_CONFIRMED_LIST"
    async with env.factory() as session:
        assert (await session.execute(select(ReceiptConfirmation))).scalars().one() is not None


async def test_success_diagnostics_counters_of_the_full_pass(dr9_env: SimpleNamespace) -> None:
    """ТЗ DR9 §7: the обезличенные counters exist ONLY on a successful FULL pass."""
    env = dr9_env
    a, b = uuid.uuid4(), uuid.uuid4()
    first_id = await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))
    operation = await op_row(env, first_id)
    counters = diagnose(operation)
    assert counters["external_total"] == 2
    assert counters["pages"] == 1
    assert counters["observed_uuids"] == 2
    assert counters["kept"] == 2
    assert counters["new_documents"] == 2
    assert counters["updated_documents"] == 0
    assert counters["marked_not_current"] == 0

    # Repeat import counts as updated; then B disappears → marked_not_current.
    second_id = await run_pass(env, FakeTransport([page(2, 0, [doc(a, "1"), doc(b, "2")])]))
    assert diagnose(await op_row(env, second_id))["updated_documents"] == 2
    third_id = await run_pass(env, FakeTransport([page(1, 0, [doc(a, "1")])]))
    final = diagnose(await op_row(env, third_id))
    assert final["marked_not_current"] == 1
    assert final["updated_documents"] == 1
    assert final["new_documents"] == 0

    # A FAILED run carries no full-pass counters at all.
    failed_id = await run_pass(env, HttpErrorTransport())
    failed = await op_row(env, failed_id)
    assert failed.state == "FAILED"
    assert "external_total" not in diagnose(failed)
    assert "marked_not_current" not in diagnose(failed)
