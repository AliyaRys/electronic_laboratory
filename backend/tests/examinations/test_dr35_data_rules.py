"""DR35 contract tests: examination create data rules, specialist, pricing.

The scenarios follow §18 of ТЗ 2026-11-16-examination-create-data-rules-and-live-pricing:
frozen snapshot read model, participant honesty, REUSE rejection, the
specialist contract and the non-mutating pricing preview that calls the SAME
domain function as the final save.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation
from backend.src.modules.catalog_pricing.mandatory import (
    IDENTIFICATION_INDICATOR_ID,
    ORGANOLEPTIC_INDICATOR_ID,
    TEMPERATURE_INDICATOR_ID,
    TRICHINELLA_INDICATOR_ID,
)
from backend.src.modules.catalog_pricing.models import Tariff
from backend.src.modules.catalog_pricing.schemas import ResearchValue
from backend.src.modules.examinations import form_model
from backend.src.modules.examinations.commands import preview_pricing, save_examination
from backend.src.modules.examinations.lifecycle import update_examination
from backend.src.modules.examinations.models import Examination
from backend.src.modules.examinations.queries import build_view
from backend.src.modules.examinations.schemas import ExaminationWrite
from backend.src.modules.identity.models import Laboratory, TechnicalEvent, Territory, User, UserRole
from backend.src.modules.samples.models import SampleCollection
from backend.tests.examinations.test_create import configure, context


@pytest_asyncio.fixture
async def env(db_session: AsyncSession) -> SimpleNamespace:
    territory = Territory(name="Республика")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="ГБУ")
    actor = User(
        login="dr35-vet",
        full_name="Врач",
        email="dr35@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.flush()
    from backend.src.modules.identity.models import UserScope

    # DR35 §12.3: the actor is an eligible specialist (any product scope) so
    # the explicit-specialist requirement of a new card can be satisfied.
    db_session.add_all(
        [
            UserScope(user_id=actor.id, laboratory_id=lab.id, product_scope_id=BEEF),
            UserScope(user_id=actor.id, laboratory_id=lab.id, product_scope_id=PORK),
        ]
    )
    await db_session.commit()
    return SimpleNamespace(lab=lab, actor=actor)


PORK = uuid.UUID("57a674fd-ca2b-c523-6853-72d27b4ae32c")
BEEF = uuid.UUID("362aa885-9b9f-ae95-05d0-f9570f4fbdc6")
STATE = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
UNIT = uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


async def _document(db_session: AsyncSession, party: Party) -> IncomingDocument:
    """The pinned source revision of one party (the backfill read source)."""
    return await db_session.scalar(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))


def participant_snapshot(sender_owner: str, sender_enterprise: str) -> dict[str, object]:
    return {
        "vdDocument": {
            "batch": {"volume": "120.000000", "quantity": "5", "unit": {"guid": str(UNIT), "name": "место"}},
            "consignor": {
                "name": sender_owner,
                "businessEntity": {"name": sender_owner, "guid": str(uuid.uuid4()), "uuid": str(uuid.uuid4())},
                "enterprise": {"name": sender_enterprise, "guid": str(uuid.uuid4()), "uuid": str(uuid.uuid4())},
            },
            "consignee": {
                "name": "ХС получателя",
                "businessEntity": {"name": "ХС получателя", "guid": str(uuid.uuid4()), "uuid": str(uuid.uuid4())},
                "enterprise": {"name": "Предприятие получателя", "guid": str(uuid.uuid4()), "uuid": str(uuid.uuid4())},
            },
        }
    }


async def dr35_party(
    db: AsyncSession,
    env: SimpleNamespace,
    species: uuid.UUID,
    *,
    accepted_quantity: str = "5",
    product_type: int | None = 1,
    snapshot: dict[str, object] | None = None,
    confirmed: bool = True,
    fair: bool = False,
) -> Party:
    incoming = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=env.lab.id,
        external_status="COMPLETED",
        source_snapshot=snapshot if snapshot is not None else participant_snapshot("ХС-1", "Предприятие-1"),
        content_hash=uuid.uuid4().hex * 2,
        fetched_at=datetime.now(UTC),
    )
    db.add(incoming)
    await db.flush()
    product: dict[str, object] = {"id": str(species), "name": "продукция"}
    if product_type is not None:
        product["productType"] = product_type
    party = Party(
        incoming_document_id=incoming.id,
        laboratory_id=env.lab.id,
        classification_snapshot={
            "product": product,
            "subProduct": {"id": str(STATE), "name": "вид"},
            "productItem": {"id": str(uuid.uuid4()), "name": "название"},
            "unit": {"id": str(UNIT), "name": "место"},
        },
    )
    db.add(party)
    await db.flush()
    if confirmed:
        reconciliation_fair = fair
        db.add(
            ReceiptConfirmation(
                party_id=party.id,
                operation_id=uuid.uuid4(),
                source_evsd_uuid=incoming.evsd_uuid,
                fingerprint=uuid.uuid4().hex * 2,
                evidence={},
                accepted_mass_kg=Decimal("120.000000"),
                accepted_quantity=Decimal(accepted_quantity),
                accepted_unit_id=str(UNIT),
                returned_mass_kg=Decimal("0"),
                returned_quantity=Decimal("0"),
                classification_snapshot=dict(party.classification_snapshot),
                previous_sufficient=False,
            )
        )
        if reconciliation_fair:
            from backend.src.modules.arrivals.models import Reconciliation

            db.add(
                Reconciliation(
                    party_id=party.id,
                    checks={},
                    services={},
                    actor_id=env.actor.id,
                    decision="ACCEPT_ALL",
                    state="CONFIRMED",
                    fair=True,
                    rev=1,
                )
            )
    await db.commit()
    return party


def payload(
    number: str = "DR35-1",
    *,
    trich: bool = False,
    mode: str = "COMPLETED",
    specialist_id: uuid.UUID | None = None,
    expected_total: str | None = None,
) -> ExaminationWrite:
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
        "stamp": "Клеймо-1",
        "researches": researches,
        "sample": {"mode": "NEW", "collectedOn": str(date.today()), "massKg": "0.8"},
        "sentToLab": mode == "WAITING",
        "specialistId": str(specialist_id) if specialist_id else None,
        "expectedTotal": expected_total,
    }
    if mode == "COMPLETED":
        data.update({"outcome": "FIT", "direction": "SALE"})
    return ExaminationWrite.model_validate(data)


# --- §4/§5/§6: the frozen snapshot read model -------------------------------------


async def test_form_view_returns_frozen_participants_without_lookup(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    first = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    await db_session.commit()
    names = {key: value["name"] for key, value in first["participants"].items()}
    assert names == {
        "senderOwner": "ХС-1",
        "senderEnterprise": "Предприятие-1",
        "receiverOwner": "ХС получателя",
        "receiverEnterprise": "Предприятие получателя",
    }
    # Repeated opens resolve from the local cache only: no VetIS lookup row is
    # created and the frozen text never changes.
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    count_before = await db_session.scalar(select(func.count()).select_from(VetisReferenceName))
    second = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    assert {k: v["name"] for k, v in second["participants"].items()} == names
    assert await db_session.scalar(select(func.count()).select_from(VetisReferenceName)) == count_before


async def test_backfill_never_overwrites_nonempty_frozen_text(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    party.form_snapshot = {
        "participants": {"senderOwner": {"name": "Заморожено ранее", "state": "VETIS_LOOKUP"}},
        "acceptedQuantity": "7",
    }
    await db_session.commit()
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    assert view["participants"]["senderOwner"]["name"] == "Заморожено ранее"
    assert view["accepted"]["quantity"] == "7"
    # Missing fields are still backfilled around the frozen values.
    assert view["accepted"]["mass_kg"] == "120.000000"


async def test_unresolvable_name_keeps_honest_state(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(
        db_session, env, BEEF, snapshot={"vdDocument": {"batch": {}, "consignor": {}, "consignee": {}}}
    )
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    sender_owner = view["participants"]["senderOwner"]
    assert sender_owner["name"] is None
    assert sender_owner["state"] == "MISSING"


async def test_enterprise_and_owner_never_merge(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF, snapshot=participant_snapshot("Один Текст", "Один Текст"))
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    assert view["participants"]["senderOwner"]["name"] == "Один Текст"
    assert view["participants"]["senderEnterprise"]["name"] == "Один Текст"
    # Two distinct frozen keys, even when the text coincides.
    assert view["participants"]["senderOwner"] is not view["participants"]["senderEnterprise"]


async def test_accepted_quantity_is_the_confirmed_reconciliation_value(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF, accepted_quantity="5")
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    assert view["accepted"]["quantity"] == "5.000000"
    assert view["accepted"]["mass_kg"] == "120.000000"
    assert view["accepted"]["unit_name"] == "место"


def test_product_type_map_is_the_single_presentation_source() -> None:
    assert form_model.PRODUCT_TYPE_LABELS[1] == "Мясо и мясопродукты"
    assert form_model.product_type_label(7) == "Рыба и морепродукты"
    assert form_model.product_type_label(8) == "Продукция, не требующая разрешения"
    assert form_model.product_type_label(99) is None
    assert form_model.product_type_label(None) is None


async def test_form_view_label_and_unknown_code(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF, product_type=1)
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    assert view["product_type_label"] == "Мясо и мясопродукты"
    party2 = await dr35_party(db_session, env, BEEF, product_type=42)
    view2 = await form_model.build_form_view(
        db_session, party2, await _document(db_session, party2), revision=party2.rev
    )
    assert view2["product_type_label"] is None
    assert view2["product_type"] == 42


# --- §9: the required research set ------------------------------------------------


@pytest.mark.parametrize(("species", "required"), [(PORK, True), (BEEF, False)])
async def test_required_research_ids_pin_trichinelloscopy_by_guid(
    db_session: AsyncSession, env: SimpleNamespace, species: uuid.UUID, required: bool
) -> None:
    await configure(db_session, env.lab.id, species, trich=required)
    party = await dr35_party(db_session, env, species)
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    ids = set(view["required_research_ids"])
    assert {ORGANOLEPTIC_INDICATOR_ID, IDENTIFICATION_INDICATOR_ID, TEMPERATURE_INDICATOR_ID} <= {
        uuid.UUID(item) for item in ids
    }
    assert (TRICHINELLA_INDICATOR_ID in {uuid.UUID(item) for item in ids}) is required


async def test_name_substitution_with_same_guid_keeps_required_set(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, PORK, trich=True)
    party = await dr35_party(db_session, env, PORK)
    # A later product-name substitution (same GUID) never changes the rule.
    party.classification_snapshot["product"]["name"] = "Совершенно другое название"
    await db_session.commit()
    view = await form_model.build_form_view(db_session, party, await _document(db_session, party), revision=party.rev)
    assert TRICHINELLA_INDICATOR_ID in {uuid.UUID(item) for item in view["required_research_ids"]}


# --- §11: NEW-only sample policy ---------------------------------------------------


async def test_create_rejects_reuse_sample(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    forged = payload(mode="WAITING").model_dump(mode="json", by_alias=True)
    forged["sample"] = {"mode": "REUSE", "collectionId": str(uuid.uuid4())}
    with pytest.raises((ProblemError, ValueError)):
        await save_examination(context(env.actor.id), party.id, ExaminationWrite.model_validate(forged), uow=db_session)
    await db_session.rollback()
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 0


async def test_same_day_edit_creates_no_new_collection(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    created = await save_examination(
        context(env.actor.id),
        party.id,
        payload(specialist_id=env.actor.id, expected_total="18.75"),
        uow=db_session,
    )
    await db_session.commit()
    collection_before = await db_session.scalar(select(func.count()).select_from(SampleCollection))
    await update_examination(
        CommandContext(actor_id=env.actor.id, idempotency_key=str(uuid.uuid4()), expected_revision=created.revision),
        created.id,
        payload(number="DR35-2", specialist_id=env.actor.id, expected_total="18.75"),
        uow=db_session,
    )
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == collection_before


# --- §12.3: the specialist contract ------------------------------------------------


async def test_specialist_is_distinct_from_audit_actor(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    other = User(
        login="e01-head",
        full_name="Начальник",
        email="head@example.test",
        password_hash="x" * 60,
        role=UserRole.HEAD,
        active=True,
    )
    db_session.add(other)
    await db_session.flush()
    from backend.src.modules.identity.models import UserScope

    db_session.add(UserScope(user_id=other.id, laboratory_id=env.lab.id, product_scope_id=BEEF))
    party = await dr35_party(db_session, env, BEEF)
    await db_session.commit()
    view = await save_examination(
        context(env.actor.id),
        party.id,
        payload(specialist_id=other.id, expected_total="18.75"),
        uow=db_session,
    )
    await db_session.commit()
    assert view.created_by == str(env.actor.id)
    assert view.specialist_id == str(other.id)
    assert view.specialist_name == "Начальник"
    row = (await db_session.execute(select(Examination).where(Examination.id == uuid.UUID(view.id)))).scalar_one()
    assert row.created_by == env.actor.id and row.specialist_id == other.id


async def test_foreign_or_blocked_specialist_is_rejected(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    foreign = User(
        login="e01-foreign",
        full_name="Чужой",
        email="foreign@example.test",
        password_hash="x" * 60,
        role=UserRole.HEAD,
        active=True,
    )
    blocked = User(
        login="e01-blocked",
        full_name="Заблокирован",
        email="blocked@example.test",
        password_hash="x" * 60,
        role=UserRole.HEAD,
        active=False,
    )
    db_session.add_all([foreign, blocked])
    party = await dr35_party(db_session, env, BEEF)
    await db_session.commit()
    actor_id = env.actor.id  # a rollback expires ORM objects: keep the plain ids
    party_id = party.id
    for user_id, user_login in ((foreign.id, foreign.login), (blocked.id, blocked.login)):
        with pytest.raises(ProblemError) as raised:
            await save_examination(
                context(actor_id),
                party_id,
                payload(number=f"N-{user_login}", specialist_id=user_id),
                uow=db_session,
            )
        await db_session.rollback()
        assert raised.value.code == "VALIDATION_ERROR"
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 0


async def test_existing_row_without_specialist_keeps_audit_actor_display(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    created = await save_examination(
        context(env.actor.id),
        party.id,
        payload(specialist_id=env.actor.id, expected_total="18.75"),
        uow=db_session,
    )
    await db_session.commit()
    row = (await db_session.execute(select(Examination).where(Examination.id == uuid.UUID(created.id)))).scalar_one()
    row.specialist_id = None
    row.specialist_name = None
    await db_session.commit()
    view = await build_view(db_session, row)
    assert view.specialist_id == view.created_by == str(env.actor.id)
    assert view.specialist_name == env.actor.full_name


# --- §13: the pricing preview ------------------------------------------------------


async def test_preview_does_not_mutate_the_database(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    write = payload()
    results = [
        ResearchValue(indicator_id=item.indicator_id, performed=True, value=item.value) for item in write.researches
    ]
    snapshot = await preview_pricing(db_session, party, results)  # type: ignore[arg-type]
    await db_session.commit()
    assert snapshot.total == "18.75"  # 3 исследования × 5 мест × 1,25 ₽
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 0
    assert await db_session.scalar(select(func.count()).select_from(SampleCollection)) == 0
    assert await db_session.scalar(select(func.count()).select_from(TechnicalEvent)) == 0


async def test_preview_and_final_save_match(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    write = payload()
    results = [
        ResearchValue(indicator_id=item.indicator_id, performed=True, value=item.value) for item in write.researches
    ]
    preview = await preview_pricing(db_session, party, results)  # type: ignore[arg-type]
    await db_session.commit()
    view = await save_examination(
        context(env.actor.id),
        party.id,
        payload(specialist_id=env.actor.id, expected_total=preview.total),
        uow=db_session,
    )
    await db_session.commit()
    assert view.pricing["total"] == preview.total == "18.75"


async def test_changed_tariff_between_preview_and_save_conflicts(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    with pytest.raises(ProblemError) as raised:
        await save_examination(
            context(env.actor.id),
            party.id,
            payload(number="C-1", specialist_id=env.actor.id, expected_total="999.00"),
            uow=db_session,
        )
    await db_session.rollback()
    assert raised.value.code == "PRICE_CONFLICT"


async def test_missing_tariff_is_never_zero(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    from backend.src.modules.catalog_pricing.models import Tariff as TariffModel

    tariffs = (
        (await db_session.execute(select(TariffModel).where(TariffModel.laboratory_id == env.lab.id))).scalars().all()
    )
    for tariff in tariffs:
        await db_session.delete(tariff)
    await db_session.commit()
    party = await dr35_party(db_session, env, BEEF)
    write = payload()
    results = [
        ResearchValue(indicator_id=item.indicator_id, performed=True, value=item.value) for item in write.researches
    ]
    with pytest.raises(ProblemError) as raised:
        await preview_pricing(db_session, party, results)  # type: ignore[arg-type]
    await db_session.rollback()
    assert raised.value.code == "CONFIGURATION_MISSING"


async def test_fair_party_prices_zero_but_keeps_facts(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF, fair=True)
    write = payload()
    results = [
        ResearchValue(indicator_id=item.indicator_id, performed=True, value=item.value) for item in write.researches
    ]
    snapshot = await preview_pricing(db_session, party, results)  # type: ignore[arg-type]
    await db_session.commit()
    assert snapshot.fair is True
    assert snapshot.total == "0.00"
    assert len(snapshot.lines) == 3
    view = await save_examination(
        context(env.actor.id),
        party.id,
        payload(number="F-1", specialist_id=env.actor.id, expected_total="0.00"),
        uow=db_session,
    )
    await db_session.commit()
    assert view.pricing["fair"] is True
    assert len(view.researches) == 3


# --- review fixes: the completion gate and the explicit specialist -------------------


async def test_completed_save_without_expected_total_is_refused(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    """DR35 §13.5 (review): a COMPLETED save without a confirmed preview total
    is a 422 VALIDATION_ERROR, never a silent completion."""
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    with pytest.raises(ProblemError) as raised:
        await save_examination(
            context(env.actor.id),
            party.id,
            payload(specialist_id=env.actor.id),  # no expectedTotal
            uow=db_session,
        )
    await db_session.rollback()
    assert raised.value.code == "VALIDATION_ERROR"
    assert raised.value.detail == "Подтвердите предварительный расчёт стоимости"
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 0


async def test_completed_edit_without_expected_total_is_refused(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    created = await save_examination(
        context(env.actor.id),
        party.id,
        payload(specialist_id=env.actor.id, expected_total="18.75"),
        uow=db_session,
    )
    await db_session.commit()
    with pytest.raises(ProblemError) as raised:
        await update_examination(
            CommandContext(actor_id=env.actor.id, idempotency_key=str(uuid.uuid4()), expected_revision=1),
            created.id,
            payload(number="E-2", specialist_id=env.actor.id),  # no expectedTotal
            uow=db_session,
        )
    await db_session.rollback()
    assert raised.value.code == "VALIDATION_ERROR"
    assert raised.value.detail == "Подтвердите предварительный расчёт стоимости"


async def test_create_without_specialist_is_refused(db_session: AsyncSession, env: SimpleNamespace) -> None:
    """DR35 §12.3 (review): a new card requires an explicit specialist — the
    forged operator fallback is gone."""
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    with pytest.raises(ProblemError) as raised:
        await save_examination(
            context(env.actor.id),
            party.id,
            payload(expected_total="18.75"),  # no specialistId
            uow=db_session,
        )
    await db_session.rollback()
    assert raised.value.code == "VALIDATION_ERROR"
    assert "специалиста" in raised.value.detail
    assert await db_session.scalar(select(func.count()).select_from(Examination)) == 0


async def test_pricing_quantity_is_the_frozen_accepted_quantity(db_session: AsyncSession, env: SimpleNamespace) -> None:
    """4 места × 100 ₽ = 400 ₽: the line quantity is the confirmation's, not
    the mass, not a form value."""
    await configure(db_session, env.lab.id, BEEF, trich=False)
    tariffs = (await db_session.execute(select(Tariff).where(Tariff.laboratory_id == env.lab.id))).scalars().all()
    for tariff in tariffs:
        tariff.price = Decimal("100")
    await db_session.commit()
    party = await dr35_party(db_session, env, BEEF, accepted_quantity="4")
    write = payload()
    results = [
        ResearchValue(indicator_id=item.indicator_id, performed=True, value=item.value) for item in write.researches
    ]
    snapshot = await preview_pricing(db_session, party, results)  # type: ignore[arg-type]
    await db_session.commit()
    assert all(line.quantity == "4.000000" for line in snapshot.lines)
    assert snapshot.total == "1200.00"
