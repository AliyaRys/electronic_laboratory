"""ТЗ DR55 §5.4/§6.2: the bulk ``conclusion`` projection and the capability split.

- the arrivals read model carries ``conclusion`` = {available, basis_kind};
- the projection is computed by the SAME pure predicate as
  ``build_conclusion`` and never inverts the live refusal;
- PDF checks ``conclusion:pdf`` (not ``conclusion:preview``);
- preview/PDF remain 422/403 exactly where the projection says unavailable.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, ReceiptConfirmation
from backend.src.modules.arrivals.queries import build_incoming_view, conclusion_flags
from backend.src.modules.documents.basis import local_basis_fields, unit_display_name
from backend.src.modules.documents.schemas import ConclusionFlagView
from backend.src.modules.documents.service import build_conclusion
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.integrations.vetis.models import VetisReferenceName
from backend.tests.documents.test_conclusion_basis import (
    BEEF,
    completed_exam,
    configure,
    context,
    enrich_document,
    party_with_confirmation,
    payload,
    previous_party,
    previous_record,
)
from backend.tests.examinations.test_create import UNIT, save_examination  # noqa: F401


@pytest_asyncio.fixture
async def env(db_session: AsyncSession) -> SimpleNamespace:
    """A copy of the D01 fixture (importing a fixture function directly is
    not callable), with the same laboratory/actor/scope setup."""
    territory = Territory(name="Республика заключений")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория №1", address="Адрес", organization="ГБУ «Ветлаб»")
    actor = User(
        login="d55-vet",
        full_name="Врач",
        email="d55@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.flush()
    db_session.add(UserScope(user_id=actor.id, laboratory_id=lab.id, product_scope_id=BEEF))
    await db_session.commit()
    return SimpleNamespace(db=db_session, lab=lab, actor=actor, authorizer=Authorizer(InMemoryDecisionEngine()))


# --- pure unit-name rule ------------------------------------------------------------


async def test_unit_display_name_rules() -> None:
    guid = str(uuid.uuid4())
    assert unit_display_name({"unit": {"guid": guid, "name": "кг"}}, guid) == "кг"
    # A GUID without a source name stays missing — never the GUID itself.
    assert unit_display_name({"unit": {"guid": guid}}, guid) is None
    assert unit_display_name({"unit": {"guid": "other", "name": "кг"}}, guid) is None
    # A legacy non-GUID accepted_unit_id is the label itself.
    assert unit_display_name({}, "шт") == "шт"


def test_local_basis_blockers() -> None:
    from datetime import UTC, datetime

    class Row:  # the minimal attribute surface of the examination row
        status = "COMPLETED"
        outcome = "FIT"
        first_completed_at = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)
        number = "D-1"
        stamp = "Клеймо-1"

    fields, blockers = local_basis_fields(Row())  # type: ignore[arg-type]
    assert blockers == ()
    assert fields["stamp"] == "Клеймо-1"
    assert fields["basis"] is not None


# --- the bulk projection ------------------------------------------------------------


async def test_conclusion_flags_follows_the_builder(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    await completed_exam(db_session, env, party.id, "F-1")

    from sqlalchemy import select as _select

    from backend.src.modules.arrivals.models import IncomingDocument

    document = await db_session.scalar(
        _select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id)
    )
    flags = await conclusion_flags(db_session, [party], {party.id: document})

    assert flags[party.id] == ConclusionFlagView(available=True, basis_kind="LOCAL")


async def test_conclusion_flags_unfit_and_unconfirmed(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    waiting_party = await party_with_confirmation(db_session, lab_id, BEEF)
    await completed_exam(db_session, env, waiting_party.id, "F-2")
    exam = (await db_session.execute(select(Examination).where(Examination.party_id == waiting_party.id))).scalar_one()
    exam.outcome = "UNFIT"
    await db_session.commit()

    from sqlalchemy import select as _select

    from backend.src.modules.arrivals.models import IncomingDocument

    document = await db_session.scalar(
        _select(IncomingDocument).where(IncomingDocument.id == waiting_party.incoming_document_id)
    )
    flags = await conclusion_flags(db_session, [waiting_party], {waiting_party.id: document})
    assert flags[waiting_party.id] == ConclusionFlagView(available=False, basis_kind=None)

    unconfirmed = await party_with_confirmation(db_session, lab_id, BEEF, confirmed=False)
    document2 = await db_session.scalar(
        _select(IncomingDocument).where(IncomingDocument.id == unconfirmed.incoming_document_id)
    )
    flags2 = await conclusion_flags(db_session, [unconfirmed], {unconfirmed.id: document2})
    assert flags2[unconfirmed.id] == ConclusionFlagView(available=False, basis_kind=None)


async def test_conclusion_flags_previous_without_local(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party, document = await previous_party(db_session, lab_id, BEEF, record=previous_record(), previous_sufficient=True)

    flags = await conclusion_flags(db_session, [party], {party.id: document})

    # PREVIOUS stays available with NO local examination row at all.
    assert await db_session.scalar(select(Examination.id).where(Examination.party_id == party.id)) is None
    assert flags[party.id] == ConclusionFlagView(available=True, basis_kind="PREVIOUS")


async def test_incoming_view_carries_the_flag(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    await completed_exam(db_session, env, party.id, "F-3")

    from sqlalchemy import select as _select

    from backend.src.modules.arrivals.models import IncomingDocument

    document = await db_session.scalar(
        _select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id)
    )
    view = await build_incoming_view(db_session, party, document)

    assert view.conclusion is not None
    assert view.conclusion.available is True
    assert view.conclusion.basis_kind == "LOCAL"


# --- the owner source (ТЗ DR55 §5.8 fix-loop) -----------------------------------------


def test_owner_display_name_prefers_the_saved_read_model_participant() -> None:
    from backend.src.modules.documents.basis import owner_display_name

    payload = {"consignee": {"name": ""}}  # the live VetIS snapshot: empty name
    form_snapshot = {
        "participants": {"receiverOwner": {"name": "Хусаинова Гульнур Мансуровна", "state": "VETIS_LOOKUP"}}
    }
    assert owner_display_name(payload, form_snapshot) == "Хусаинова Гульнур Мансуровна"

    # Fallback: an absent read-model snapshot falls back to the raw consignee.
    assert owner_display_name({"consignee": {"name": "ИП Владелец"}}, None) == "ИП Владелец"
    # A GUID is NEVER printed in either source — the honest missing stays.
    guid = str(uuid.uuid4())
    assert owner_display_name({"consignee": {"name": ""}}, {"participants": {"receiverOwner": {"name": guid}}}) is None
    assert owner_display_name({"consignee": {"name": guid}}, None) is None
    assert owner_display_name({}, None) is None


async def test_builder_and_projection_agree_on_the_saved_owner(db_session: AsyncSession, env: SimpleNamespace) -> None:
    """The live case: consignee.name is empty; the saved read-model participant
    supplies the owner — and the bulk flag never shows a menu the builder
    would refuse (the invariant of the ONE predicate)."""
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    document = await db_session.scalar(
        select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id)
    )
    # The real VetIS snapshot: the raw owner name is an EMPTY string.
    document.source_snapshot = {
        "vdDocument": {
            "issueNumber": "ЭВСД-120",
            "consignee": {"name": ""},
            "batch": {
                "volume": "120",
                "quantity": "120",
                "productItem": {"name": "Говядина охлаждённая"},
                "unit": {"guid": str(UNIT), "name": "кг"},
            },
        }
    }
    # The read model froze the confirmed participant name at the create page.
    party.form_snapshot = {
        "participants": {"receiverOwner": {"name": "Хусаинова Гульнур Мансуровна", "state": "VETIS_LOOKUP"}},
        "acceptedUnitName": None,
    }
    await completed_exam(db_session, env, party.id, "F-5")
    await db_session.commit()

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    assert view.fields["owner"] == "Хусаинова Гульнур Мансуровна"

    flags = await conclusion_flags(db_session, [party], {party.id: document})
    assert flags[party.id] == ConclusionFlagView(available=True, basis_kind="LOCAL")


async def test_owner_missing_on_both_sources_is_honest(db_session: AsyncSession, env: SimpleNamespace) -> None:
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    document = await db_session.scalar(
        select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id)
    )
    document.source_snapshot = {
        "vdDocument": {
            "issueNumber": "ЭВСД-120",
            "consignee": {"name": ""},
            "batch": {
                "volume": "120",
                "quantity": "120",
                "productItem": {"name": "Говядина охлаждённая"},
                "unit": {"guid": str(UNIT), "name": "кг"},
            },
        }
    }
    await completed_exam(db_session, env, party.id, "F-6")
    await db_session.commit()

    # The bulk projection must agree with the refused builder (no phantom menu).
    flags = await conclusion_flags(db_session, [party], {party.id: document})
    assert flags[party.id] == ConclusionFlagView(available=False, basis_kind=None)

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    assert "owner" in str(getattr(raised.value, "detail", "")) + str(
        getattr(getattr(raised.value, "problem", None), "detail", "")
    )


# --- the unit reference (fix-loop DR55: the resolved UNIT name) -----------------------

UNIT_KEY = uuid.UUID("069792f0-053d-11e1-99b4-d8d385fbc9e8")  # the VetIS unit UUID
UNIT_BATCH_GUID = uuid.UUID("21ed96c9-337b-4a27-8761-c6e6ad3c9f5b")  # the batch GUID / accepted_unit_id


def test_conclusion_unit_name_priority_and_never_a_guid() -> None:
    from backend.src.modules.documents.basis import conclusion_unit_name

    batch = {"unit": {"guid": str(UNIT_BATCH_GUID), "uuid": str(UNIT_KEY)}}
    cache = {str(UNIT_KEY): "кг", str(UNIT_BATCH_GUID): "кг"}
    # 1) the VetIS snapshot name wins;
    assert conclusion_unit_name({"unit": {"guid": str(UNIT_KEY), "name": "кг"}}, str(UNIT_KEY), None, cache) == "кг"
    # 2) the frozen readable name of the read model;
    assert conclusion_unit_name({"unit": {"guid": str(UNIT_KEY)}}, str(UNIT_KEY), {"acceptedUnitName": "кг"}, cache)
    # 3) the resolved UNIT cache row (by uuid AND by the приёмка GUID key);
    assert conclusion_unit_name(batch, str(UNIT_BATCH_GUID), None, cache) == "кг"
    # 4) nothing resolves → honest missing, never a GUID/UUID.
    assert conclusion_unit_name(batch, str(UNIT_BATCH_GUID), None, {}) is None
    frozen_guid_cache = {str(UNIT_KEY): str(UNIT_KEY)}
    assert conclusion_unit_name(batch, str(UNIT_BATCH_GUID), None, frozen_guid_cache) is None


def _resolved_unit_row(db: AsyncSession) -> None:
    db.add(
        VetisReferenceName(
            contour="PILOT",
            entity_kind="UNIT",
            guid=UNIT_KEY,
            uuid=UNIT_BATCH_GUID,
            name="кг",
            source="VETIS_LOOKUP",
            status="RESOLVED",
            active=True,
        )
    )


async def _live_unit_case(db_session: AsyncSession, env: SimpleNamespace, *, with_cache: bool) -> tuple:
    """The real VetIS shape: batch.unit.name is null; the unit resolves only
    through the reference-name cache."""
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    document = await db_session.scalar(
        select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id)
    )
    document.source_snapshot = {
        "vdDocument": {
            "issueNumber": "ЭВСД-120",
            "consignee": {"name": "ИП Владелец"},
            "batch": {
                "volume": "4",
                "quantity": "4",
                "productItem": {"name": "Говядина охлаждённая"},
                "unit": {"guid": str(UNIT_BATCH_GUID), "uuid": str(UNIT_KEY), "name": None},
            },
        }
    }
    from sqlalchemy import select as _select

    confirmation = (
        await db_session.execute(_select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party.id))
    ).scalar_one()
    confirmation.accepted_unit_id = str(UNIT_BATCH_GUID)
    if with_cache:
        _resolved_unit_row(db_session)
    await completed_exam(db_session, env, party.id, "U-1")
    await db_session.commit()
    return party, document


async def test_builder_and_projection_agree_on_the_resolved_unit(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party, document = await _live_unit_case(db_session, env, with_cache=True)

    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    assert view.fields["unit"] == "кг"

    flags = await conclusion_flags(db_session, [party], {party.id: document})
    assert flags[party.id] == ConclusionFlagView(available=True, basis_kind="LOCAL")


async def test_unresolved_unit_stays_an_honest_missing(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party, document = await _live_unit_case(db_session, env, with_cache=False)

    flags = await conclusion_flags(db_session, [party], {party.id: document})
    assert flags[party.id] == ConclusionFlagView(available=False, basis_kind=None)

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    await db_session.rollback()
    assert raised.value.status == 422
    problem_detail = str(getattr(raised.value, "detail", "")) + str(
        getattr(getattr(raised.value, "problem", None), "detail", "")
    )
    assert "unit" in problem_detail
    # The GUID of the batch unit is NEVER printed as the unit name.
    assert str(UNIT_BATCH_GUID) not in problem_detail


# --- the capability split -----------------------------------------------------------


async def test_pdf_checks_conclusion_pdf_capability(
    db_session: AsyncSession, env: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The PDF route must NOT reuse ``conclusion:preview``: a caller with only
    the preview right is refused by the PDF route (ТЗ DR55 §3.5)."""
    lab_id = env.lab.id
    await configure(db_session, lab_id, BEEF, trich=False)
    party = await party_with_confirmation(db_session, lab_id, BEEF)
    await enrich_document(db_session, party)
    await completed_exam(db_session, env, party.id, "F-4")

    from backend.src.modules.documents import pdf as pdf_module
    from backend.src.modules.documents import resources as resources_module

    async def fake_render(view, form):  # noqa: ANN001
        return b"%PDF-fake"

    monkeypatch.setattr(pdf_module, "render_pdf", fake_render)

    class RestrictedAuthorizer(Authorizer):
        """Everything allowed EXCEPT ``conclusion:pdf``."""

        async def authorize(self, db, actor_id, action, target, hide_foreign=False, **kwargs):  # noqa: ANN001
            if action == "conclusion:pdf":
                raise ProblemError(status=403, code="FORBIDDEN", title="Forbidden", detail="нет права")
            return await super().authorize(db, actor_id, action, target, hide_foreign=hide_foreign, **kwargs)

    restricted = RestrictedAuthorizer(InMemoryDecisionEngine())

    # preview passes, PDF refuses — the capabilities are distinct checks.
    view = await build_conclusion(env.actor.id, party.id, uow=db_session, authorizer=env.authorizer)
    assert view.basis_kind == "LOCAL"

    with pytest.raises(ProblemError) as raised:
        await build_conclusion(
            env.actor.id,
            party.id,
            uow=db_session,
            authorizer=restricted,
            capability="conclusion:pdf",
        )
    await db_session.rollback()
    assert raised.value.status == 403

    _ = (resources_module, UserScope, UserRole, payload, context)
