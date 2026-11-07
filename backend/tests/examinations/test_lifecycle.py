"""E02: day boundaries, late completion and revision/auth honesty."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.clock import Clock, moscow_date
from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing.mandatory import TEMPERATURE_INDICATOR_ID
from backend.src.modules.catalog_pricing.models import Tariff
from backend.src.modules.examinations.commands import save_examination
from backend.src.modules.examinations.lifecycle import complete_waiting, update_examination
from backend.src.modules.examinations.models import Examination
from backend.src.modules.examinations.queries import get_view
from backend.src.modules.examinations.schemas import ExaminationView, ExaminationWrite, OutcomeWrite
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.session import SessionTransport
from backend.tests.arrivals.test_api import _client_for
from backend.tests.examinations.test_create import (
    BEEF,
    configure,
    context,
    party_with_confirmation,
    payload,
)
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

# 05.11 in Europe/Moscow (08:00 UTC is 11:00 Moscow).
CREATED_ON = datetime(2026, 11, 5, 8, 0, tzinfo=UTC)
COMPLETED_ON = datetime(2026, 11, 8, 9, 0, tzinfo=UTC)
DAY_AFTER = datetime(2026, 11, 6, 8, 0, tzinfo=UTC)


class StepClock(Clock):
    __test__ = False

    def __init__(self, start: datetime) -> None:
        self.current = start

    def now(self) -> datetime:
        return self.current

    def advance(self, delta: timedelta) -> None:
        self.current += delta


@pytest_asyncio.fixture
async def env(db_session: AsyncSession) -> SimpleNamespace:
    territory = Territory(name="Республика жизненного цикла")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="ГБУ")
    actor = User(
        login="e02-vet",
        full_name="Врач А",
        email="e02@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.commit()
    return SimpleNamespace(lab=lab, actor=actor)


def waiting_payload(number: str = "L-1") -> ExaminationWrite:
    return payload(number=number, trich=False, mode="WAITING")


def with_temperature(base: ExaminationWrite, value: str) -> ExaminationWrite:
    data = base.model_dump(mode="json", by_alias=True)
    for item in data["researches"]:
        if item["indicatorId"] == str(TEMPERATURE_INDICATOR_ID):
            item["value"] = value
    return ExaminationWrite.model_validate(data)


async def examination_id_of(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID:
    return (await db.execute(select(Examination.id).where(Examination.party_id == party_id))).scalar_one()


async def rev_of(db: AsyncSession, exam_id: uuid.UUID) -> int:
    return int(await db.scalar(select(Examination.rev).where(Examination.id == exam_id)))


async def do_update(
    db: AsyncSession,
    actor_id: uuid.UUID,
    exam_id: uuid.UUID,
    payload: ExaminationWrite,
    clock: Clock,
    key: str | None = None,
) -> ExaminationView:
    """Run the edit command with a fresh If-Match read from the row."""
    ctx = CommandContext(
        actor_id=actor_id,
        idempotency_key=key or str(uuid.uuid4()),
        expected_revision=await rev_of(db, exam_id),
    )
    return await update_examination(ctx, exam_id, payload, uow=db, clock=clock)


async def do_complete(
    db: AsyncSession,
    actor_id: uuid.UUID,
    exam_id: uuid.UUID,
    outcome: OutcomeWrite,
    clock: Clock,
    key: str | None = None,
) -> ExaminationView:
    ctx = CommandContext(
        actor_id=actor_id,
        idempotency_key=key or str(uuid.uuid4()),
        expected_revision=await rev_of(db, exam_id),
    )
    return await complete_waiting(ctx, exam_id, outcome, uow=db, clock=clock)


async def create_waiting(
    db: AsyncSession, env: SimpleNamespace, party_id: uuid.UUID, clock: Clock, number: str = "L-1"
) -> tuple[uuid.UUID, ExaminationWrite]:
    base = waiting_payload(number)
    await save_examination(context(env.actor.id), party_id, base, uow=db, clock=clock)
    await db.commit()
    return await examination_id_of(db, party_id), base


async def test_waiting_day_rules(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id, actor_id = env.lab.id, env.actor.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    clock = StepClock(CREATED_ON)
    exam_id, base = await create_waiting(db_session, env, party.id, clock)

    # The full edit is allowed on the creation day itself.
    edited = await do_update(db_session, actor_id, exam_id, with_temperature(base, "5.5"), clock)
    await db_session.commit()
    assert edited.status == "WAITING" and edited.revision == 2
    assert edited.first_completed_at is None

    # From the next day only the outcome block of a WAITING card may change;
    # a temperature edit is a DAY_CLOSED problem.
    late_clock = StepClock(DAY_AFTER)
    with pytest.raises(ProblemError) as raised:
        await do_update(db_session, actor_id, exam_id, with_temperature(base, "6.5"), late_clock)
    await db_session.rollback()
    assert raised.value.code == "DAY_CLOSED"

    # The explicit late completion on 08.11 is allowed and dated 08.11.
    done_clock = StepClock(COMPLETED_ON)
    view = await do_complete(db_session, actor_id, exam_id, OutcomeWrite(outcome="FIT", direction="SALE"), done_clock)
    await db_session.commit()
    assert view.status == "COMPLETED"
    assert view.outcome == "FIT" and view.direction == "SALE" and view.reason is None
    assert moscow_date(view.first_completed_at) == date(2026, 11, 8)

    # After completion an ordinary late edit stays forbidden.
    with pytest.raises(ProblemError) as raised:
        await do_update(db_session, actor_id, exam_id, with_temperature(base, "7.5"), done_clock)
    await db_session.rollback()
    assert raised.value.code == "DAY_CLOSED"


async def test_lock_crosses_midnight(db_session: AsyncSession, test_db_engine, env: SimpleNamespace) -> None:
    lab_id, actor_id = env.lab.id, env.actor.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    # The card is opened at 23:59 Moscow time on 05.11.
    clock = StepClock(datetime(2026, 11, 5, 20, 59, 0, tzinfo=UTC))
    exam_id, base = await create_waiting(db_session, env, party.id, clock)

    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)
    blocker = factory()
    try:
        # A concurrent writer holds the card row; the command must wait on it.
        await blocker.execute(select(Examination).with_for_update())
        late = StepClock(datetime(2026, 11, 5, 20, 59, 0, tzinfo=UTC))

        async def attempt() -> object:
            session = factory()
            try:
                rev = (await session.execute(select(Examination.rev).where(Examination.id == exam_id))).scalar_one()
                ctx = CommandContext(actor_id=actor_id, idempotency_key=str(uuid.uuid4()), expected_revision=int(rev))
                return await update_examination(ctx, exam_id, with_temperature(base, "7.5"), uow=session, clock=late)
            except ProblemError as exc:  # noqa: TRY300
                return exc
            finally:
                await session.rollback()

        task = asyncio.create_task(attempt())
        await asyncio.sleep(0.3)
        assert not task.done(), "команда не ждала блокировку карточки"
        # Midnight passes while the command still waits on the lock: the day
        # must be read AFTER the lock, so the crossing edit is rejected.
        late.advance(timedelta(minutes=62))  # 00:01 Moscow on 06.11
        await blocker.rollback()
        outcome = await task
        assert isinstance(outcome, ProblemError)
        assert outcome.code == "DAY_CLOSED"
    finally:
        if blocker.in_transaction():
            await blocker.rollback()


async def test_original_author_and_completion(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    clock = StepClock(CREATED_ON)
    exam_id, base = await create_waiting(db_session, env, party.id, clock)

    author_b = User(
        login="e02-vet-b",
        full_name="Врач Б",
        email="e02b@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(author_b)
    await db_session.commit()

    # B edits the card created by A: the author stays.
    edited = await do_update(db_session, author_b.id, exam_id, with_temperature(base, "5.0"), clock)
    await db_session.commit()
    assert edited.created_by == str(env.actor.id)

    # B explicitly completes the waiting card late: the first completion is set
    # once and is never moved again.
    done_clock = StepClock(COMPLETED_ON)
    view = await do_complete(
        db_session,
        author_b.id,
        exam_id,
        OutcomeWrite(outcome="UNFIT", direction="DISPOSAL", reason="Порча"),
        done_clock,
    )
    await db_session.commit()
    assert view.created_by == str(env.actor.id)
    assert view.reason == "Порча"
    assert moscow_date(view.first_completed_at) == date(2026, 11, 8)

    # A repeated completion does not move the first completion date.
    with pytest.raises(ProblemError) as raised:
        await do_complete(
            db_session,
            author_b.id,
            exam_id,
            OutcomeWrite(outcome="FIT", direction="SALE"),
            StepClock(datetime(2026, 11, 9, 9, 0, tzinfo=UTC)),
            key=str(uuid.uuid4()),
        )
    await db_session.rollback()
    assert raised.value.status == 409


async def test_outcome_matrix(db_session: AsyncSession, env: SimpleNamespace) -> None:
    # FIT keeps only SALE without a reason; UNFIT needs DISPOSAL/DESTRUCTION and a reason.
    fit = OutcomeWrite(outcome="FIT", direction="SALE")
    assert fit.reason is None and fit.direction == "SALE"
    unfit = OutcomeWrite(outcome="UNFIT", direction="DESTRUCTION", reason=" Причина ")
    assert unfit.reason == " Причина "
    for bad in (
        {"outcome": "FIT", "direction": "SALE", "reason": "не нужно"},
        {"outcome": "FIT", "direction": "DISPOSAL"},
        {"outcome": "UNFIT", "direction": "SALE", "reason": "причина"},
        {"outcome": "UNFIT", "direction": "DISPOSAL", "reason": "   "},
        {"outcome": "CONDITIONALLY_FIT", "direction": "SALE"},
        {"outcome": "UNFIT", "direction": "DISPOSAL", "reason": "причина", "stamp": "лишнее"},
    ):
        with pytest.raises(ValidationError):
            OutcomeWrite.model_validate(bad)

    # completed → waiting is rejected in both directions.
    lab_id = env.lab.id
    actor_id = env.actor.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    clock = StepClock(CREATED_ON)
    completed = payload(number="L-2", trich=False)
    await save_examination(context(env.actor.id), party.id, completed, uow=db_session, clock=clock)
    await db_session.commit()
    exam_id = await examination_id_of(db_session, party.id)
    with pytest.raises(ProblemError) as raised:
        await do_complete(db_session, actor_id, exam_id, OutcomeWrite(outcome="FIT", direction="SALE"), clock)
    await db_session.rollback()
    assert raised.value.status == 409
    with pytest.raises(ProblemError) as raised:
        await do_update(db_session, actor_id, exam_id, waiting_payload(number="L-2"), clock)
    await db_session.rollback()
    assert raised.value.status == 409


async def test_existing_indicator_keeps_pinned_price(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    clock = StepClock(CREATED_ON)
    completed = payload(number="L-3", trich=False)
    first = await save_examination(context(env.actor.id), party.id, completed, uow=db_session, clock=clock)
    await db_session.commit()
    pinned_total = first.pricing["total"]

    # The tariff changes after the card was saved.
    tariffs = (await db_session.execute(select(Tariff).where(Tariff.laboratory_id == lab_id))).scalars().all()
    for tariff in tariffs:
        tariff.price = Decimal("9.99")
    await db_session.commit()

    # A same-day full edit keeps the pinned price of the existing indicator.
    exam_id = await examination_id_of(db_session, party.id)
    edited = await do_update(db_session, env.actor.id, exam_id, completed, clock)
    await db_session.commit()
    assert all(line["unit_price"] == "1.25" for line in edited.pricing["lines"])
    assert edited.pricing["total"] == pinned_total


# --- API contract level ------------------------------------------------------------


@pytest.fixture
async def api_env(db_session: AsyncSession, test_db_engine, env: SimpleNamespace) -> SimpleNamespace:
    db_session.add(UserScope(user_id=env.actor.id, laboratory_id=env.lab.id, product_scope_id=BEEF))
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=SessionTransport(MemoryRedis(), clock=TestClock(), prefix="e02-api"),
        authorizer=Authorizer(InMemoryDecisionEngine()),
        vet=env.actor,
        lab=env.lab,
    )


async def _completed_card(db: AsyncSession, lab_id: uuid.UUID, actor_id: uuid.UUID) -> uuid.UUID:
    await configure(db, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db, lab_id, BEEF)
    await save_examination(
        context(actor_id), party.id, payload(number="API-L", trich=False), uow=db, clock=StepClock(CREATED_ON)
    )
    await db.commit()
    exam_id = await examination_id_of(db, party.id)
    # The API runs on the real clock: put the creation day into the same-day
    # window so the revision contract, not the day rule, is what this test checks.
    row = (await db.execute(select(Examination).where(Examination.id == exam_id))).scalar_one()
    row.created_at = datetime.now(UTC)
    await db.commit()
    return exam_id


async def test_extra_fields_and_stale_revision_rejected(db_session: AsyncSession, api_env: SimpleNamespace) -> None:
    env = api_env
    exam_id = await _completed_card(env.db, env.lab.id, env.vet.id)
    body = payload(number="API-L", trich=False).model_dump(mode="json", by_alias=True)

    async with _client_for(env) as (http, identity):
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
            "if-match": '"1"',
        }
        # A late request with extra fields must be rejected outright (extra=forbid).
        extra = await http.post(
            f"/api/v1/examinations/{exam_id}/complete-waiting",
            json={**body, "outcome": "FIT", "direction": "SALE", "stamp": "лишнее"},
            headers=headers,
        )
        assert extra.status_code == 422, extra.text

        # A stale If-Match is a 409 without any field-level merge.
        first = await http.put(f"/api/v1/examinations/{exam_id}", json=body, headers=headers)
        assert first.status_code == 200, first.text
        assert first.headers["etag"] == '"2"'
        stale = await http.put(
            f"/api/v1/examinations/{exam_id}",
            json={**body, "stamp": "Другое клеймо"},
            headers={**headers, "if-match": '"1"', "idempotency-key": str(uuid.uuid4())},
        )
        assert stale.status_code == 409 and stale.json()["code"] == "REVISION_CONFLICT", stale.text
        assert await env.db.scalar(select(Examination.rev).where(Examination.id == exam_id)) == 2
        view = await get_view(env.db, exam_id)
        assert view.stamp == "Клеймо-1" and view.revision == 2

        # A missing If-Match is an explicit 422 REVISION_REQUIRED.
        missing = await http.put(
            f"/api/v1/examinations/{exam_id}",
            json=body,
            headers={
                "x-csrf-token": identity.csrf_token,
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
            },
        )
        assert missing.status_code == 422 and missing.json()["code"] == "REVISION_REQUIRED"


async def test_revoked_assignment_is_honest(db_session: AsyncSession, api_env: SimpleNamespace) -> None:
    env = api_env
    exam_id = await _completed_card(env.db, env.lab.id, env.vet.id)
    body = payload(number="API-L", trich=False).model_dump(mode="json", by_alias=True)
    async with _client_for(env) as (http, identity):
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
            "if-match": '"1"',
        }
        # The form was opened while the scope existed; the assignment is now
        # revoked and the next request fails with an honest problem.
        await env.db.execute(delete(UserScope).where(UserScope.user_id == env.vet.id))
        await env.db.commit()
        denied = await http.put(f"/api/v1/examinations/{exam_id}", json=body, headers=headers)
        assert denied.status_code in (403, 404), denied.text
        assert denied.json()["code"] in {"ACCESS_DENIED", "NOT_FOUND"}
