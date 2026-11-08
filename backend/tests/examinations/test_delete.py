"""E03 durable deletion: tombstone, independent facts and UNKNOWN recovery."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from backend.src.core.clock import Clock
from backend.src.core.contracts import CommandContext
from backend.src.core.durability import get_durability_guard
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import Party, ReceiptConfirmation
from backend.src.modules.arrivals.queries import queue_of
from backend.src.modules.catalog_pricing.models import MethodRule
from backend.src.modules.examinations import lifecycle, queries
from backend.src.modules.examinations.commands import save_examination
from backend.src.modules.examinations.deletion import DeleteOutcome, delete_examination, finalize_delete
from backend.src.modules.examinations.models import Examination, ExaminationSample, ExaminationTombstone
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import Laboratory, TechnicalEvent, Territory, User, UserRole, UserScope
from backend.src.modules.identity.session import SessionTransport
from backend.src.modules.reporting.models import ReportSnapshot
from backend.src.modules.samples.commands import dispose_samples
from backend.src.modules.samples.models import SampleBasket, SampleCollection, SampleDisposal
from backend.src.modules.samples.schemas import DisposalWrite
from backend.tests.arrivals.test_api import _client_for
from backend.tests.examinations.test_create import BEEF, configure, context, party_with_confirmation, payload
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

NOW = datetime(2026, 11, 8, 10, 0, tzinfo=UTC)


class FixedClock(Clock):
    def __init__(self, value: datetime) -> None:
        self.value = value

    def now(self) -> datetime:
        return self.value


class FakeDurability:
    def __init__(self, *, ready: bool = True, flushed: bool = True) -> None:
        self.is_ready = ready
        self.is_flushed = flushed
        self.ready_calls = 0
        self.waited_lsns: list[str] = []

    async def ready(self) -> bool:
        self.ready_calls += 1
        return self.is_ready

    async def wait_flushed(self, lsn: str) -> bool:
        self.waited_lsns.append(lsn)
        return self.is_flushed


@pytest_asyncio.fixture
async def deletion_env(db_session: AsyncSession, test_db_engine: AsyncEngine) -> SimpleNamespace:
    territory = Territory(name="Республика")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="ГБУ")
    actor = User(
        login=f"delete-{uuid.uuid4()}",
        full_name="Врач",
        email=f"{uuid.uuid4()}@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.flush()
    db_session.add(UserScope(user_id=actor.id, laboratory_id=lab.id, product_scope_id=BEEF))
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        lab=lab,
        actor=actor,
        vet=actor,
        transport=SessionTransport(MemoryRedis(), clock=TestClock(), prefix="e03-api"),
        authorizer=Authorizer(InMemoryDecisionEngine()),
    )


async def saved_card(env: SimpleNamespace, number: str = "DEL-001") -> tuple[Party, ExaminationView]:
    configured = await env.db.scalar(
        select(func.count()).select_from(MethodRule).where(MethodRule.laboratory_id == env.lab.id)
    )
    if not configured:
        await configure(env.db, env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(env.db, env.lab.id, BEEF)
    view = await save_examination(
        context(env.actor.id),
        party.id,
        payload(number=number, trich=False),
        uow=env.db,
        clock=FixedClock(NOW),
    )
    await env.db.commit()
    return party, view


def delete_context(actor_id: uuid.UUID, key: str = "delete-command") -> CommandContext:
    return CommandContext(actor_id=actor_id, idempotency_key=key, expected_revision=1)


async def perform_delete(
    env: SimpleNamespace,
    examination_id: uuid.UUID,
    guard: FakeDurability,
    *,
    key: str = "delete-command",
    now: datetime = NOW,
) -> DeleteOutcome:
    prepared = await delete_examination(
        delete_context(env.actor.id, key),
        examination_id,
        uow=env.db,
        guard=guard,
        clock=FixedClock(now),
    )
    return await finalize_delete(env.db, prepared, guard)


@pytest.mark.asyncio
async def test_delete_preserves_facts_and_allows_reuse(deletion_env: SimpleNamespace) -> None:
    env = deletion_env
    party, view = await saved_card(env)
    party_id = party.id
    actor_id = env.actor.id
    examination_id = uuid.UUID(view.id)
    collection_id = uuid.UUID(view.sample_collection_id)
    env.db.add(
        ReportSnapshot(
            report_type="5VET_SECTION_III",
            laboratory_id=env.lab.id,
            year=2025,
            half=1,
            payload={"sources": [[examination_id.hex, 1, [[0, 1, "1"]]]]},
            codes={"okud": "001"},
            source_count=1,
            preview_generated_at=NOW,
            saved_at=NOW,
            saved_by=env.actor.id,
            key_id="test",
            signature="0" * 64,
        )
    )
    await env.db.commit()

    outcome = await perform_delete(env, examination_id, FakeDurability())
    assert outcome.state == "SUCCESS"
    with pytest.raises(ProblemError) as missing:
        await queries.get_examination(env.db, examination_id)
    assert missing.value.code == "NOT_FOUND"
    with pytest.raises(ProblemError) as old_put:
        await lifecycle.update_examination(
            CommandContext(actor_id=env.actor.id, idempotency_key="old-put", expected_revision=1),
            examination_id,
            payload(number="DEL-001", trich=False),
            uow=env.db,
            clock=FixedClock(NOW),
        )
    assert old_put.value.code == "EXAMINATION_DELETED"
    await env.db.rollback()

    assert await env.db.get(SampleCollection, collection_id) is not None
    assert (
        await env.db.scalar(
            select(func.count()).select_from(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party_id)
        )
    ) == 1
    report = (await env.db.execute(select(ReportSnapshot))).scalar_one()
    assert report.payload["sources"][0][0] == examination_id.hex
    live_party = await env.db.get(Party, party_id)
    assert live_party is not None
    assert await queue_of(env.db, live_party, has_reconciliation=True, has_confirmation=True) == "WORK"
    assert await env.db.scalar(select(func.count()).select_from(ExaminationSample)) == 0

    replacement_data = payload(number="DEL-001", trich=False).model_dump(mode="json", by_alias=True)
    replacement_data["sample"] = {"mode": "REUSE", "collectionId": str(collection_id)}
    replacement = await save_examination(
        context(actor_id, "replacement"),
        party_id,
        ExaminationWrite.model_validate(replacement_data),
        uow=env.db,
        clock=FixedClock(NOW),
    )
    await env.db.commit()
    assert replacement.id != str(examination_id)
    assert replacement.number == "DEL-001"
    assert await env.db.scalar(select(func.count()).select_from(SampleCollection)) == 1


@pytest.mark.asyncio
async def test_disposal_survives_examination_delete(deletion_env: SimpleNamespace) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-DISPOSED")
    collection = await env.db.get(SampleCollection, uuid.UUID(view.sample_collection_id))
    assert collection is not None
    disposal = SampleDisposal(
        laboratory_id=env.lab.id,
        product_species_id=collection.product_species_id,
        disposed_on=date(2026, 11, 8),
        mass_kg=Decimal("0.8"),
        external_vsd_number="OUT-001",
        actor_id=env.actor.id,
    )
    env.db.add(disposal)
    await env.db.flush()
    collection.disposal_id = disposal.id
    await env.db.commit()

    outcome = await perform_delete(env, uuid.UUID(view.id), FakeDurability())
    assert outcome.state == "SUCCESS"
    assert await env.db.get(SampleDisposal, disposal.id) is not None
    saved_collection = await env.db.get(SampleCollection, collection.id)
    assert saved_collection is not None and saved_collection.disposal_id == disposal.id


@pytest.mark.asyncio
async def test_backup_not_ready_and_day_closed_leave_card(deletion_env: SimpleNamespace) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-GUARDS")
    examination_id = uuid.UUID(view.id)
    actor_id = env.actor.id
    with pytest.raises(ProblemError) as unavailable:
        await delete_examination(
            delete_context(actor_id),
            examination_id,
            uow=env.db,
            guard=FakeDurability(ready=False),
            clock=FixedClock(NOW),
        )
    assert unavailable.value.code == "BACKUP_DURABILITY_UNAVAILABLE"
    await env.db.rollback()
    assert await env.db.get(Examination, examination_id) is not None
    assert await env.db.scalar(select(func.count()).select_from(ExaminationTombstone)) == 0

    with pytest.raises(ProblemError) as closed:
        await delete_examination(
            delete_context(actor_id, "next-day"),
            examination_id,
            uow=env.db,
            guard=FakeDurability(),
            clock=FixedClock(NOW + timedelta(days=1)),
        )
    assert closed.value.code == "DAY_CLOSED"
    await env.db.rollback()
    assert await env.db.get(Examination, examination_id) is not None


@pytest.mark.asyncio
async def test_unknown_replay_waits_wal_without_second_delete(deletion_env: SimpleNamespace) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-UNKNOWN")
    examination_id = uuid.UUID(view.id)
    uncertain = FakeDurability(flushed=False)
    first = await perform_delete(env, examination_id, uncertain)
    assert first.state == "UNKNOWN"
    assert len(uncertain.waited_lsns) == 1
    assert await env.db.get(Examination, examination_id) is None
    assert await env.db.scalar(select(func.count()).select_from(ExaminationTombstone)) == 1
    assert (
        await env.db.scalar(
            select(func.count()).select_from(TechnicalEvent).where(TechnicalEvent.action == "examination:delete")
        )
    ) == 1
    recovered = await perform_delete(env, examination_id, FakeDurability(flushed=True))
    assert recovered.state == "SUCCESS"
    assert await env.db.scalar(select(func.count()).select_from(ExaminationTombstone)) == 1
    assert (
        await env.db.scalar(
            select(func.count()).select_from(TechnicalEvent).where(TechnicalEvent.action == "examination:delete")
        )
    ) == 1


@pytest.mark.asyncio
async def test_uncertain_commit_recovers_from_tombstone(
    deletion_env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-COMMIT-UNKNOWN")
    examination_id = uuid.UUID(view.id)
    guard = FakeDurability(flushed=True)
    prepared = await delete_examination(
        delete_context(env.actor.id, "uncertain-commit"),
        examination_id,
        uow=env.db,
        guard=guard,
        clock=FixedClock(NOW),
    )
    real_commit = env.db.commit

    async def commit_then_lose_answer() -> None:
        await real_commit()
        raise OSError("lost commit response")

    monkeypatch.setattr(env.db, "commit", commit_then_lose_answer)
    uncertain = await finalize_delete(env.db, prepared, guard)
    assert uncertain.state == "UNKNOWN"
    monkeypatch.setattr(env.db, "commit", real_commit)

    recovered = await perform_delete(env, examination_id, guard, key="uncertain-commit")
    assert recovered.state == "SUCCESS"
    assert await env.db.scalar(select(func.count()).select_from(ExaminationTombstone)) == 1


@pytest.mark.asyncio
async def test_concurrent_same_command_deletes_once(deletion_env: SimpleNamespace, test_db_engine: AsyncEngine) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-CONCURRENT")
    examination_id = uuid.UUID(view.id)
    actor_id = env.actor.id
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)

    async def attempt() -> str:
        async with factory() as session:
            guard = FakeDurability()
            outcome = await delete_examination(
                delete_context(actor_id, "same-concurrent-key"),
                examination_id,
                uow=session,
                guard=guard,
                clock=FixedClock(NOW),
            )
            return (await finalize_delete(session, outcome, guard)).state

    assert await asyncio.gather(attempt(), attempt()) == ["SUCCESS", "SUCCESS"]
    assert (
        await env.db.scalar(
            select(func.count()).select_from(TechnicalEvent).where(TechnicalEvent.action == "examination:delete")
        )
    ) == 1


@pytest.mark.asyncio
async def test_concurrent_delete_and_update_have_one_serialized_winner(
    deletion_env: SimpleNamespace, test_db_engine: AsyncEngine
) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-UPDATE-RACE")
    examination_id = uuid.UUID(view.id)
    actor_id = env.actor.id
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)

    async def remove() -> str:
        async with factory() as session:
            try:
                prepared = await delete_examination(
                    delete_context(actor_id, "delete-update-race"),
                    examination_id,
                    uow=session,
                    guard=FakeDurability(),
                    clock=FixedClock(NOW),
                )
                return (await finalize_delete(session, prepared, FakeDurability())).state
            except ProblemError as error:
                await session.rollback()
                return error.code

    async def update() -> str:
        async with factory() as session:
            try:
                await lifecycle.update_examination(
                    CommandContext(actor_id=actor_id, idempotency_key="update-delete-race", expected_revision=1),
                    examination_id,
                    payload(number="DEL-UPDATE-RACE", trich=False),
                    uow=session,
                    clock=FixedClock(NOW),
                )
                await session.commit()
                return "SUCCESS"
            except ProblemError as error:
                await session.rollback()
                return error.code

    delete_result, update_result = await asyncio.gather(remove(), update())
    assert (delete_result, update_result) in {
        ("SUCCESS", "EXAMINATION_DELETED"),
        ("REVISION_CONFLICT", "SUCCESS"),
    }
    tombstones = await env.db.scalar(select(func.count()).select_from(ExaminationTombstone))
    live = await env.db.get(Examination, examination_id)
    assert (tombstones, live is not None) in {(1, False), (0, True)}


@pytest.mark.asyncio
async def test_concurrent_delete_and_disposal_preserve_the_disposal_fact(
    deletion_env: SimpleNamespace, test_db_engine: AsyncEngine
) -> None:
    env = deletion_env
    _party, view = await saved_card(env, "DEL-DISPOSAL-RACE")
    examination_id = uuid.UUID(view.id)
    collection_id = uuid.UUID(view.sample_collection_id)
    collection = await env.db.get(SampleCollection, collection_id)
    assert collection is not None
    basket = (
        await env.db.execute(
            select(SampleBasket).where(
                SampleBasket.laboratory_id == env.lab.id,
                SampleBasket.product_species_id == collection.product_species_id,
            )
        )
    ).scalar_one()
    actor_id = env.actor.id
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)

    async def remove() -> str:
        async with factory() as session:
            prepared = await delete_examination(
                delete_context(actor_id, "delete-disposal-race"),
                examination_id,
                uow=session,
                guard=FakeDurability(),
                clock=FixedClock(NOW),
            )
            return (await finalize_delete(session, prepared, FakeDurability())).state

    async def dispose() -> uuid.UUID:
        async with factory() as session:
            result = await dispose_samples(
                CommandContext(
                    actor_id=actor_id,
                    idempotency_key="disposal-delete-race",
                    expected_revision=int(basket.rev),
                ),
                DisposalWrite.model_validate(
                    {
                        "laboratoryId": str(env.lab.id),
                        "productSpeciesId": str(collection.product_species_id),
                        "disposedOn": "2026-11-08",
                        "externalVsdNumber": "OUT-RACE-001",
                        "expectedMassKg": "0.8",
                    }
                ),
                uow=session,
            )
            await session.commit()
            return uuid.UUID(result.id)

    delete_result, disposal_id = await asyncio.gather(remove(), dispose())
    assert delete_result == "SUCCESS"
    env.db.expire_all()
    assert await env.db.get(SampleDisposal, disposal_id) is not None
    saved_collection = await env.db.get(SampleCollection, collection_id)
    assert saved_collection is not None and saved_collection.disposal_id == disposal_id
    assert await env.db.get(Examination, examination_id) is None


@pytest.mark.asyncio
async def test_concurrent_delete_and_recreate_never_leave_two_cards(
    deletion_env: SimpleNamespace, test_db_engine: AsyncEngine
) -> None:
    env = deletion_env
    party, view = await saved_card(env, "DEL-CREATE-RACE")
    party_id = party.id
    examination_id = uuid.UUID(view.id)
    collection_id = uuid.UUID(view.sample_collection_id)
    actor_id = env.actor.id
    replacement_data = payload(number="DEL-CREATE-RACE", trich=False).model_dump(mode="json", by_alias=True)
    replacement_data["sample"] = {"mode": "REUSE", "collectionId": str(collection_id)}
    replacement_payload = ExaminationWrite.model_validate(replacement_data)
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)

    async def remove() -> str:
        async with factory() as session:
            prepared = await delete_examination(
                delete_context(actor_id, "delete-create-race"),
                examination_id,
                uow=session,
                guard=FakeDurability(),
                clock=FixedClock(NOW),
            )
            return (await finalize_delete(session, prepared, FakeDurability())).state

    async def recreate(key: str) -> str:
        async with factory() as session:
            try:
                await save_examination(
                    context(actor_id, key),
                    party_id,
                    replacement_payload,
                    uow=session,
                    clock=FixedClock(NOW),
                )
                await session.commit()
                return "SUCCESS"
            except ProblemError as error:
                await session.rollback()
                return error.code

    delete_result, create_result = await asyncio.gather(remove(), recreate("create-delete-race"))
    assert delete_result == "SUCCESS"
    assert create_result in {"SUCCESS", "STATE_CONFLICT"}
    if create_result == "STATE_CONFLICT":
        assert await recreate("create-after-delete-race") == "SUCCESS"

    env.db.expire_all()
    cards = (await env.db.execute(select(Examination).where(Examination.party_id == party_id))).scalars().all()
    assert len(cards) == 1
    assert cards[0].id != examination_id
    assert await env.db.scalar(select(func.count()).select_from(ExaminationTombstone)) == 1
    assert await env.db.scalar(select(func.count()).select_from(SampleCollection)) == 1


@pytest.mark.asyncio
async def test_delete_http_204_and_unknown_202(deletion_env: SimpleNamespace) -> None:
    from backend.src.interfaces.main import app

    env = deletion_env
    _party, view = await saved_card(env, "DEL-HTTP")
    guard = FakeDurability()
    app.dependency_overrides[get_durability_guard] = lambda: guard
    try:
        async with _client_for(env) as (http, identity):
            response = await http.delete(
                f"/api/v1/examinations/{view.id}",
                headers={
                    "origin": "http://test",
                    "x-csrf-token": identity.csrf_token,
                    "idempotency-key": "http-delete",
                    "if-match": '"1"',
                },
            )
            assert response.status_code == 204
    finally:
        app.dependency_overrides.pop(get_durability_guard, None)

    _party2, view2 = await saved_card(env, "DEL-HTTP-UNKNOWN")
    unknown_guard = FakeDurability(flushed=False)
    app.dependency_overrides[get_durability_guard] = lambda: unknown_guard
    try:
        async with _client_for(env) as (http, identity):
            response = await http.delete(
                f"/api/v1/examinations/{view2.id}",
                headers={
                    "origin": "http://test",
                    "x-csrf-token": identity.csrf_token,
                    "idempotency-key": "http-delete-unknown",
                    "if-match": '"1"',
                },
            )
            assert response.status_code == 202
            assert response.json()["state"] == "UNKNOWN"
            status = await http.get(f"/api/v1/operations/{response.json()['id']}")
            assert status.status_code == 200
            assert status.json()["kind"] == "examination-delete"
    finally:
        app.dependency_overrides.pop(get_durability_guard, None)
