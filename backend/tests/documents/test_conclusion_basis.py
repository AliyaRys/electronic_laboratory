"""D01: basis selection and the conclusion view-model (API-07, FT-DOC-03/04/06).

Three stamp routes (ФТ 04):
- no previous ВСЭ → local stamp of the own completed examination;
- previous ВСЭ + repeat required → local stamp, the previous (incoming)
  source data is never mutated;
- previous ВСЭ + repeat not required → slaughter-point stamp, no local ВСЭ.

Blocked routes: waiting / unfit / full return / missing confirmation are 422
with an honest problem; missing previous requisites are enumerated in the
problem detail; a deleted locally-required ВСЭ is never substituted by the
previous basis. The view-model is re-derived from live state on every call,
so a correction shows current data and a deletion closes the old URL.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation
from backend.src.modules.arrivals.queries import previous_vse_fields
from backend.src.modules.documents.service import build_conclusion
from backend.src.modules.examinations.commands import save_examination
from backend.src.modules.examinations.lifecycle import complete_waiting
from backend.src.modules.examinations.models import Examination
from backend.src.modules.examinations.schemas import OutcomeWrite
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.session import SessionTransport
from backend.tests.examinations.test_create import (
    BEEF,
    UNIT,
    configure,
    context,
    party_with_confirmation,
    payload,
)
from backend.tests.identity.test_sessions import MemoryRedis, TestClock

COMPLETED_ON = datetime(2026, 11, 5, 8, 0, tzinfo=UTC)


@pytest_asyncio.fixture
async def env(db_session: AsyncSession) -> SimpleNamespace:
    territory = Territory(name="Республика заключений")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория №1", address="Адрес", organization="ГБУ «Ветлаб»")
    actor = User(
        login="d01-vet",
        full_name="Врач",
        email="d01@example.test",
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
        lab=lab,
        actor=actor,
        authorizer=Authorizer(InMemoryDecisionEngine()),
    )


def previous_record() -> dict[str, str]:
    """A complete slaughter-point previous-ВСЭ record of the incoming eVSD."""
    return {
        "previousStamp": "Клеймо убойного пункта 555",
        "previousNumber": "П-77",
        "previousPerformedOn": "2026-10-20",
        "previousOrganization": "Убойный пункт «Заря»",
        "previousResult": "ПРИГОДНО",
        "previousConclusion": "Реализация без ограничений",
    }


async def previous_party(
    db: AsyncSession,
    lab_id: uuid.UUID,
    species: uuid.UUID,
    *,
    record: dict[str, str] | None = None,
    previous_sufficient: bool,
    delivered: str = "120",
    accepted_mass: str = "100",
    accepted_quantity: str = "4",
    returned_quantity: str = "0",
    confirmed: bool = True,
    issue: str = "ЭВСД-120",
) -> tuple[Party, IncomingDocument]:
    """A party with a frozen confirmation; the eVSD carries the CHK snapshot."""
    vd_document: dict[str, object] = {
        "issueNumber": issue,
        "consignee": {"name": "ИП Владелец"},
        "batch": {"volume": delivered, "quantity": delivered, "productItem": {"name": "Говядина охлаждённая"}},
    }
    source: dict[str, object] = {"vdDocument": vd_document}
    if record is not None:
        source["vetDocuments"] = [record]
    incoming = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=lab_id,
        external_status="COMPLETED",
        source_snapshot=source,
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
            "subProduct": {"id": str(uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")), "name": "вид"},
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
                accepted_mass_kg=Decimal(accepted_mass if accepted_quantity != "0" else "0"),
                accepted_quantity=Decimal(accepted_quantity),
                accepted_unit_id="руб/кг",
                returned_mass_kg=Decimal("0"),
                returned_quantity=Decimal(returned_quantity),
                classification_snapshot=dict(party.classification_snapshot),
                previous_sufficient=previous_sufficient,
            )
        )
    await db.commit()
    return party, incoming


async def completed_exam(db: AsyncSession, env: SimpleNamespace, party_id: uuid.UUID, number: str) -> uuid.UUID:
    await save_examination(context(env.actor.id), party_id, payload(number=number, trich=False), uow=db)
    await db.commit()
    return (await db.execute(select(Examination.id).where(Examination.party_id == party_id))).scalar_one()


async def enrich_document(db: AsyncSession, party: Party) -> None:
    """Give the fixture document the real owner/product/eVSD requisites."""
    document = await db.scalar(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))
    document.source_snapshot = {
        "vdDocument": {
            "issueNumber": "ЭВСД-120",
            "consignee": {"name": "ИП Владелец"},
            "batch": {"volume": "120", "quantity": "120", "productItem": {"name": "Говядина охлаждённая"}},
        }
    }
    await db.commit()


# --- the three stamp routes ---------------------------------------------------------


async def test_no_previous_uses_local_stamp(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    exam_id = await completed_exam(db_session, env, party.id, "D-1")

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)

    assert view.basis_kind == "LOCAL"
    assert view.basis_id == str(exam_id)
    assert view.fields["stamp"] == "Клеймо-1"
    assert view.fields["date"] is not None
    assert view.form_id == "conclusion-local"
    assert view.official is False
    assert "Предварительная форма" in view.warnings


async def test_previous_with_repeat_keeps_local_stamp_and_source(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party, document = await previous_party(
        db_session, lab_id, BEEF, record=previous_record(), previous_sufficient=False
    )
    exam_id = await completed_exam(db_session, env, party.id, "D-2")
    before = document.source_snapshot

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)

    assert view.basis_kind == "LOCAL"
    assert view.basis_id == str(exam_id)
    assert view.fields["stamp"] == "Клеймо-1"
    assert view.fields["stamp"] != previous_record()["previousStamp"]

    # The previous-ВСЭ source data of the incoming eVSD is never mutated.
    await db_session.refresh(document)
    assert document.source_snapshot == before
    assert previous_vse_fields(document.source_snapshot) == previous_vse_fields(before)


async def test_previous_without_repeat_uses_slaughter_stamp_without_local(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party, document = await previous_party(db_session, lab_id, BEEF, record=previous_record(), previous_sufficient=True)

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)

    assert view.basis_kind == "PREVIOUS"
    assert view.basis_id == str(
        await db_session.scalar(select(ReceiptConfirmation.id).where(ReceiptConfirmation.party_id == party.id))
    )
    assert view.fields["stamp"] == previous_record()["previousStamp"]
    assert view.fields["date"] == "2026-10-20"
    assert view.form_id == "conclusion-previous"
    # No local ВСЭ exists — the route must not demand one.
    assert await db_session.scalar(select(Examination.id).where(Examination.party_id == party.id)) is None


# --- accepted composition of the frozen fact ---------------------------------------


async def test_partial_acceptance_shows_accepted_mass_only(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)  # 100 accepted of 120 delivered
    await enrich_document(db_session, party)
    exam_id = await completed_exam(db_session, env, party.id, "D-3")

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)

    assert view.basis_id == str(exam_id)
    assert view.fields["mass"] == "100"
    assert view.fields["count"] == "4"
    assert view.fields["mass"] != "120"


# --- blocked routes -----------------------------------------------------------------


async def test_waiting_examination_blocks_document(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await save_examination(
        context(env.actor.id), party.id, payload(number="W-D", trich=False, mode="WAITING"), uow=db_session
    )
    await db_session.commit()

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    assert raised.value.code == "DOCUMENT_BASIS_INCOMPLETE"
    assert "ожидан" in raised.value.detail


async def test_unfit_examination_blocks_document(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await save_examination(
        context(env.actor.id), party.id, payload(number="U-D", trich=False, mode="WAITING"), uow=db_session
    )
    await db_session.commit()
    exam_id = (await db_session.execute(select(Examination.id).where(Examination.party_id == party.id))).scalar_one()
    await complete_waiting(
        CommandContext(actor_id=env.actor.id, idempotency_key=str(uuid.uuid4()), expected_revision=1),
        exam_id,
        OutcomeWrite(outcome="UNFIT", direction="DISPOSAL", reason="Порча"),
        uow=db_session,
    )
    await db_session.commit()

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    assert raised.value.code == "DOCUMENT_BASIS_INCOMPLETE"


async def test_full_return_blocks_document(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party, _ = await previous_party(
        db_session,
        lab_id,
        BEEF,
        record=previous_record(),
        previous_sufficient=False,
        accepted_quantity="0",
        returned_quantity="5",
    )

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    assert raised.value.code == "DOCUMENT_BASIS_INCOMPLETE"
    assert "возвр" in raised.value.detail


async def test_missing_confirmation_blocks_document(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    # No examination can exist either: the same gate blocks dependent commands.
    party = await party_with_confirmation(db_session, lab_id, BEEF, confirmed=False)

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    assert raised.value.code == "RECEIPT_NOT_CONFIRMED"


# --- honest enumerations and no substitutions --------------------------------------


async def test_missing_previous_fields_are_enumerated(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    incomplete = {
        "previousStamp": "Клеймо убойного пункта 555",
        "previousNumber": "П-77",
        # previousPerformedOn, previousOrganization, previousResult, previousConclusion are absent
    }
    party, _ = await previous_party(db_session, lab_id, BEEF, record=incomplete, previous_sufficient=True)

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    assert raised.value.code == "DOCUMENT_BASIS_INCOMPLETE"
    listed = raised.value.detail + " ".join(item.message for item in raised.value.errors)
    for missing in ("previousPerformedOn", "previousOrganization", "previousResult", "previousConclusion"):
        assert missing in listed
    # No demo term/number/signature is ever substituted in place of the gaps.


async def test_no_demo_signatures_or_foreign_requisites(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    await completed_exam(db_session, env, party.id, "S-D")

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)

    # The signature space is an empty place, never a fabricated image/term.
    assert view.fields["signature"] == ""
    assert view.fields["organization"] == "ГБУ «Ветлаб»"
    assert view.fields["laboratory"] == "Лаборатория №1"
    assert view.fields["evsd"] == "ЭВСД-120"
    assert view.fields["owner"] == "ИП Владелец"
    assert view.fields["product"] == "Говядина охлаждённая"
    assert view.fields["unit"] == str(UNIT)


async def test_deleted_required_local_never_falls_back_to_previous(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party, _ = await previous_party(db_session, lab_id, BEEF, record=previous_record(), previous_sufficient=False)
    await completed_exam(db_session, env, party.id, "D-4")
    exam = (await db_session.execute(select(Examination).where(Examination.party_id == party.id))).scalar_one()
    await db_session.delete(exam)
    await db_session.commit()

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status in (404, 422)
    # No previous-basis substitute answer exists: the refusal is explicit.
    assert raised.value.code in ("DOCUMENT_BASIS_INCOMPLETE", "NOT_FOUND")
    assert "местн" in raised.value.detail


# --- correction and deletion close the document ------------------------------------


async def test_correction_shows_current_data_in_next_conclusion(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    exam_id = await completed_exam(db_session, env, party.id, "D-5")

    first = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    assert first.fields["stamp"] == "Клеймо-1"

    corrected = payload(number="D-5", trich=False)
    corrected = corrected.model_copy(update={"stamp": "Клеймо-2"}) if hasattr(corrected, "model_copy") else corrected
    row = await db_session.get(Examination, exam_id)
    row.stamp = "Клеймо-2"  # the correction of the basis (E03/E02 lifecycle keeps live facts)
    await db_session.commit()

    second = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    assert second.fields["stamp"] == "Клеймо-2"
    assert second.fields["stamp"] != first.fields["stamp"]


async def test_deletion_closes_the_old_conclusion(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    await completed_exam(db_session, env, party.id, "D-6")

    first = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    assert first.basis_kind == "LOCAL"

    exam = (await db_session.execute(select(Examination).where(Examination.party_id == party.id))).scalar_one()
    await db_session.delete(exam)
    await db_session.commit()

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status in (404, 422)


# --- API contract ------------------------------------------------------------------


@pytest_asyncio.fixture
async def api_env(db_session: AsyncSession, test_db_engine, env: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=SessionTransport(MemoryRedis(), clock=TestClock(), prefix="d01-api"),
        authorizer=env.authorizer,
        vet=env.actor,
        actor=env.actor,
        admin=None,
        lab=env.lab,
    )


async def test_preview_api_and_admin_forbidden(db_session: AsyncSession, api_env: SimpleNamespace) -> None:
    env = api_env
    lab_id = env.lab.id
    await configure(env.db, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(env.db, lab_id, BEEF)
    await enrich_document(env.db, party)
    await completed_exam(env.db, env, party.id, "API-D")

    admin = User(
        login="d01-admin",
        full_name="Администратор",
        email="d01-admin@example.test",
        password_hash="x" * 60,
        role=UserRole.ADMIN,
        active=True,
    )
    env.db.add(admin)
    await env.db.commit()

    from backend.tests.arrivals.test_api import _client_for

    # VET of the own scope reads the preview; the answer is never cached.
    async with _client_for(env) as (http, identity):
        vet_response = await http.get(f"/api/v1/arrivals/{party.id}/conclusion/preview")
        assert vet_response.status_code == 200, vet_response.text
        assert vet_response.headers["cache-control"] == "no-store"
        body = vet_response.json()
        assert body["basis_kind"] == "LOCAL"
        assert body["form_id"] == "conclusion-local"
        assert body["official"] is False

    # ADMIN is denied even with the known party id (no conclusion reads at all).
    admin_env = SimpleNamespace(
        db=env.db,
        engine=env.engine,
        transport=env.transport,
        authorizer=env.authorizer,
        vet=admin,
        lab=env.lab,
    )
    async with _client_for(admin_env) as (http, _identity):
        denied = await http.get(f"/api/v1/arrivals/{party.id}/conclusion/preview")
        assert denied.status_code in (403, 404), denied.text
