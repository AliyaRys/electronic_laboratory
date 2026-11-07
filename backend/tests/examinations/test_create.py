"""E01 atomic creation, evidence, pricing, sample and idempotency tests."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation
from backend.src.modules.catalog_pricing.mandatory import (
    IDENTIFICATION_INDICATOR_ID,
    ORGANOLEPTIC_INDICATOR_ID,
    TEMPERATURE_INDICATOR_ID,
    TRICHINELLA_INDICATOR_ID,
)
from backend.src.modules.catalog_pricing.models import MethodRule, Tariff
from backend.src.modules.examinations.commands import save_examination
from backend.src.modules.examinations.models import Examination, ExaminationSample
from backend.src.modules.examinations.schemas import ExaminationWrite
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.session import SessionTransport
from backend.src.modules.samples.models import SampleCollection
from backend.tests.arrivals.test_api import _client_for
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

PORK = uuid.UUID("57a674fd-ca2b-c523-6853-72d27b4ae32c")
HORSE = uuid.UUID("64930556-cbb2-13db-bcdc-572eb188e45e")
PORK_OFFAL = uuid.UUID("40dd45d4-75aa-b984-4fdb-291f84afad03")
HORSE_OFFAL = uuid.UUID("16d9f824-a5f3-6837-3073-e54c4ed5d74d")
BEEF = uuid.UUID("362aa885-9b9f-ae95-05d0-f9570f4fbdc6")
STATE = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
UNIT = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


@pytest_asyncio.fixture
async def env(db_session: AsyncSession) -> SimpleNamespace:
    territory = Territory(name="Республика")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="ГБУ")
    actor = User(
        login="e01-vet",
        full_name="Врач",
        email="e01@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.commit()
    return SimpleNamespace(lab=lab, actor=actor)


async def configure(db: AsyncSession, lab_id: uuid.UUID, species: uuid.UUID, *, trich: bool) -> None:
    definitions = [
        (ORGANOLEPTIC_INDICATOR_ID, "BOOLEAN_MATCH", {"type": "qualitative", "accepted_values": ["true"]}),
        (IDENTIFICATION_INDICATOR_ID, "BOOLEAN_MATCH", {"type": "qualitative", "accepted_values": ["true"]}),
        (
            TEMPERATURE_INDICATOR_ID,
            "DECIMAL",
            {"type": "interval", "lower": "0", "upper": "10", "lower_inclusive": True, "upper_inclusive": True},
        ),
    ]
    if trich:
        definitions.append(
            (TRICHINELLA_INDICATOR_ID, "BOOLEAN_MATCH", {"type": "qualitative", "accepted_values": ["true"]})
        )
    for indicator, schema, rule in definitions:
        db.add(
            MethodRule(
                laboratory_id=lab_id,
                product_species_id=species,
                product_state_id=STATE,
                indicator_id=indicator,
                version=1,
                result_schema=schema,
                unit_id="service",
                rule=rule,
                source={"name": str(indicator)},
                active=True,
            )
        )
        db.add(
            Tariff(
                laboratory_id=lab_id,
                product_species_id=species,
                service_code=str(indicator),
                unit_id="service",
                price=Decimal("1.25"),
                version=1,
                source={"name": "Тариф"},
            )
        )
    await db.commit()


async def party_with_confirmation(
    db: AsyncSession, lab_id: uuid.UUID, species: uuid.UUID, *, confirmed: bool = True
) -> Party:
    incoming = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=lab_id,
        external_status="COMPLETED",
        source_snapshot={"vdDocument": {"batch": {}}},
        content_hash=uuid.uuid4().hex * 2,
        fetched_at=datetime.now(UTC),
    )
    db.add(incoming)
    await db.flush()
    party = Party(
        incoming_document_id=incoming.id,
        laboratory_id=lab_id,
        classification_snapshot={
            "product": {"id": str(species), "name": "продукция"},
            "subProduct": {"id": str(STATE), "name": "вид"},
        },
    )
    db.add(party)
    await db.flush()
    if confirmed:
        db.add(
            ReceiptConfirmation(
                party_id=party.id,
                operation_id=uuid.uuid4(),
                source_evsd_uuid=incoming.evsd_uuid,
                fingerprint=uuid.uuid4().hex * 2,
                evidence={},
                accepted_mass_kg=Decimal("100"),
                accepted_quantity=Decimal("4"),
                accepted_unit_id=str(UNIT),
                returned_mass_kg=Decimal("0"),
                returned_quantity=Decimal("0"),
                classification_snapshot=dict(party.classification_snapshot),
                previous_sufficient=False,
            )
        )
    await db.commit()
    return party


def payload(number: str = " 001 ", *, trich: bool = True, mode: str = "COMPLETED") -> ExaminationWrite:
    researches: list[dict[str, object]] = [
        {"indicatorId": str(ORGANOLEPTIC_INDICATOR_ID), "kind": "BOOLEAN", "value": True},
        {"indicatorId": str(IDENTIFICATION_INDICATOR_ID), "kind": "BOOLEAN", "value": True},
        {"indicatorId": str(TEMPERATURE_INDICATOR_ID), "kind": "DECIMAL", "value": "4.5"},
    ]
    if trich:
        researches.append({"indicatorId": str(TRICHINELLA_INDICATOR_ID), "kind": "BOOLEAN", "value": True})
    data: dict[str, object] = {
        "mode": mode,
        "number": number,
        "stamp": " Клеймо-1 ",
        "researches": researches,
        "sample": {"mode": "NEW", "collectedOn": str(date.today()), "massKg": "0.8"},
        "sentToLab": mode == "WAITING",
    }
    if mode == "COMPLETED":
        data.update({"outcome": "FIT", "direction": "SALE"})
    return ExaminationWrite.model_validate(data)


def context(actor_id: uuid.UUID, key: str | None = None) -> CommandContext:
    return CommandContext(actor_id=actor_id, idempotency_key=key or str(uuid.uuid4()))


async def test_atomic_complete_saves_pricing_sample_and_trimmed_number(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, PORK, trich=True)
    party = await party_with_confirmation(db_session, env.lab.id, PORK)
    view = await save_examination(context(env.actor.id), party.id, payload(), uow=db_session)
    await db_session.commit()

    assert view.number == "001"
    assert view.stamp == "Клеймо-1"
    assert view.status == "COMPLETED" and view.first_completed_at is not None
    assert view.pricing["total"] == "20.00"
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 1
    assert await db_session.scalar(select(func.count()).select_from(ExaminationSample)) == 1
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 1


async def test_missing_evidence_creates_nothing(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, env.lab.id, BEEF, confirmed=False)
    with pytest.raises(ProblemError) as raised:
        await save_examination(context(env.actor.id), party.id, payload(trich=False), uow=db_session)
    await db_session.rollback()
    assert raised.value.code == "RECEIPT_NOT_CONFIRMED"
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 0
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 0


@pytest.mark.parametrize("mandatory_species", [PORK, HORSE, PORK_OFFAL, HORSE_OFFAL])
async def test_conditional_trichinelloscopy_for_exact_four_products_but_not_beef(
    db_session: AsyncSession, env: SimpleNamespace, mandatory_species: uuid.UUID
) -> None:
    lab_id, actor_id = env.lab.id, env.actor.id
    await configure(db_session, lab_id, mandatory_species, trich=True)
    mandatory_party = await party_with_confirmation(db_session, lab_id, mandatory_species)
    with pytest.raises(ProblemError) as raised:
        await save_examination(context(actor_id), mandatory_party.id, payload(trich=False), uow=db_session)
    await db_session.rollback()
    assert raised.value.code == "VALIDATION_ERROR"

    # The rollback also removed fixture rows created in the same transaction,
    # so build the independent beef case afresh.
    await configure(db_session, lab_id, BEEF, trich=False)
    beef = await party_with_confirmation(db_session, lab_id, BEEF)
    view = await save_examination(context(actor_id), beef.id, payload(number="B-1", trich=False), uow=db_session)
    await db_session.commit()
    assert view.status == "COMPLETED"


async def test_idempotent_replay_does_not_duplicate_sample(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, env.lab.id, BEEF)
    key = str(uuid.uuid4())
    first = await save_examination(context(env.actor.id, key), party.id, payload(trich=False), uow=db_session)
    await db_session.commit()
    replay = await save_examination(context(env.actor.id, key), party.id, payload(trich=False), uow=db_session)
    await db_session.commit()
    assert replay.id == first.id
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 1


async def test_waiting_save_has_no_final_outcome(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, env.lab.id, BEEF)
    view = await save_examination(
        context(env.actor.id), party.id, payload(number="W-1", trich=False, mode="WAITING"), uow=db_session
    )
    await db_session.commit()
    assert view.status == "WAITING"
    assert view.sent_to_lab is True
    assert view.outcome is None and view.direction is None and view.first_completed_at is None


async def test_number_is_unique_per_laboratory_but_allowed_in_another(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    lab_id, territory_id, actor_id = env.lab.id, env.lab.territory_id, env.actor.id
    await configure(db_session, lab_id, BEEF, trich=False)
    first_party = await party_with_confirmation(db_session, lab_id, BEEF)
    await save_examination(context(actor_id), first_party.id, payload(number=" 001 ", trich=False), uow=db_session)
    await db_session.commit()

    second_party = await party_with_confirmation(db_session, lab_id, BEEF)
    with pytest.raises(ProblemError) as raised:
        await save_examination(context(actor_id), second_party.id, payload(number="001", trich=False), uow=db_session)
    await db_session.rollback()
    assert raised.value.code == "STATE_CONFLICT"

    other_lab = Laboratory(
        territory_id=territory_id,
        name="Другая лаборатория",
        address="Другой адрес",
        organization="ГБУ",
    )
    db_session.add(other_lab)
    await db_session.commit()
    await configure(db_session, other_lab.id, BEEF, trich=False)
    other_party = await party_with_confirmation(db_session, other_lab.id, BEEF)
    view = await save_examination(context(actor_id), other_party.id, payload(number="001", trich=False), uow=db_session)
    await db_session.commit()
    assert view.number == "001" and view.laboratory_id == str(other_lab.id)


async def test_parallel_create_yields_one_card_and_one_sample(
    db_session: AsyncSession, test_db_engine, env: SimpleNamespace
) -> None:
    lab_id, actor_id = env.lab.id, env.actor.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    party_id = party.id
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)

    async def attempt(number: str) -> str:
        async with factory() as session:
            try:
                view = await save_examination(
                    context(actor_id), party_id, payload(number=number, trich=False), uow=session
                )
                await session.commit()
                return view.id
            except ProblemError as exc:
                await session.rollback()
                return exc.code

    outcomes = await asyncio.gather(attempt("RACE-A"), attempt("RACE-B"))
    assert outcomes.count("STATE_CONFLICT") == 1
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 1
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 1


async def test_injected_failure_after_sample_rolls_back_everything(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, env.lab.id, BEEF)

    def fail() -> None:
        raise RuntimeError("injected")

    with pytest.raises(RuntimeError, match="injected"):
        await save_examination(context(env.actor.id), party.id, payload(trich=False), uow=db_session, after_sample=fail)
    await db_session.rollback()
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 0
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 0


async def test_create_and_read_api_contract(db_session: AsyncSession, test_db_engine, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, env.lab.id, BEEF)
    db_session.add(UserScope(user_id=env.actor.id, laboratory_id=env.lab.id, product_scope_id=BEEF))
    await db_session.commit()
    api_env = SimpleNamespace(
        engine=test_db_engine,
        transport=SessionTransport(MemoryRedis(), clock=TestClock(), prefix="e01-api"),
        authorizer=Authorizer(InMemoryDecisionEngine()),
        vet=env.actor,
    )
    async with _client_for(api_env) as (http, identity):
        created = await http.post(
            f"/api/v1/examinations/parties/{party.id}",
            json=payload(number="API-001", trich=False).model_dump(mode="json", by_alias=True),
            headers={
                "x-csrf-token": identity.csrf_token,
                "origin": "http://test",
                "idempotency-key": str(uuid.uuid4()),
            },
        )
        assert created.status_code == 201, created.text
        assert created.headers["etag"] == '"1"'
        view = created.json()
        fetched = await http.get(f"/api/v1/examinations/{view['id']}")
        assert fetched.status_code == 200
        assert fetched.json()["party_id"] == str(party.id)
        assert fetched.headers["cache-control"] == "no-store"


def test_waiting_and_outcome_matrix_are_strict() -> None:
    with pytest.raises(ValidationError):
        ExaminationWrite.model_validate(
            {**payload(mode="WAITING").model_dump(mode="json", by_alias=True), "sentToLab": False}
        )
    with pytest.raises(ValidationError):
        ExaminationWrite.model_validate(
            {
                **payload(trich=False).model_dump(mode="json", by_alias=True),
                "outcome": "UNFIT",
                "direction": "DISPOSAL",
                "reason": "",
            }
        )
