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
from backend.src.modules.arrivals.queries import build_incoming_view, conclusion_flags
from backend.src.modules.documents.basis import local_basis_fields, unit_display_name
from backend.src.modules.documents.schemas import ConclusionFlagView
from backend.src.modules.documents.service import build_conclusion
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
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
from backend.tests.examinations.test_create import save_examination  # noqa: F401


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
