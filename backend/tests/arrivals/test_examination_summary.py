"""ТЗ DR44 §2: the bulk examination summary of the completed arrivals.

``IncomingView.examination`` is the compact server-side read model of the
saved ВСЭ: frozen номер/итог/специалист, the validated frozen pricing
snapshot and the SERVER-computed combined total (сверка + ВСЭ). The list
never runs a query per row, never sums money in the browser and never calls
VetIS.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals import queries
from backend.src.modules.arrivals.models import Reconciliation
from backend.src.modules.arrivals.queries import combined_total_of
from backend.src.modules.catalog_pricing.schemas import PricingSnapshot
from backend.src.modules.examinations.commands import save_examination
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.models import User
from backend.tests.examinations.test_create import (
    BEEF,
    UNIT,
    configure,
    context,
    party_with_confirmation,
    payload,
)

ZERO_SNAPSHOT = {"lines": [], "total": "0.00", "currency": "RUB", "fair": True}


def snapshot(total: str | None) -> dict[str, object] | None:
    if total is None:
        return None
    return {"lines": [], "total": total, "currency": "RUB", "fair": total == "0.00"}


@pytest_asyncio.fixture
async def env(db_session: AsyncSession) -> SimpleNamespace:
    from backend.src.modules.identity.models import Laboratory, Territory, UserRole, UserScope

    territory = Territory(name="Республика")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="ГБУ")
    actor = User(
        login="dr44-vet",
        full_name="Смирнова Ольга Ивановна",
        email="dr44@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.flush()
    db_session.add(UserScope(user_id=actor.id, laboratory_id=lab.id, product_scope_id=BEEF))
    await db_session.commit()
    return SimpleNamespace(lab=lab, actor=actor)


async def completed_arrival(
    db: AsyncSession,
    env: SimpleNamespace,
    *,
    recon_total: str | None = "230.00",
    number: str = "DR44-1",
    exam_total: str = "15.00",
    norms: bool = True,
    configure_catalog: bool = True,
) -> object:
    """A completed arrival: CONFIRMED сверка with a frozen snapshot + ВСЭ card."""
    if configure_catalog:
        await configure(db, env.lab.id, BEEF, trich=False, norms=norms)
    party = await party_with_confirmation(db, env.lab.id, BEEF)
    await save_examination(
        context(env.actor.id),
        party.id,
        payload(number=number, trich=False, specialist_id=env.actor.id, expected_total=exam_total),
        uow=db,
    )
    await db.commit()
    reconciliation = (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).first()
    if reconciliation is None:
        reconciliation = Reconciliation(
            party_id=party.id,
            checks={},
            services=[],
            delivered_mass_kg=100,
            delivered_quantity=4,
            accepted_mass_kg=100,
            accepted_quantity=4,
            accepted_unit_id=str(UNIT),
            decision="ACCEPT_ALL",
            actor_id=env.actor.id,
            state="CONFIRMED",
        )
        db.add(reconciliation)
    reconciliation.pricing_snapshot = snapshot(recon_total)
    reconciliation.completed_at = datetime(2026, 11, 5, 7, 10, tzinfo=UTC)
    await db.commit()
    return party


# --- Task 1 RED: the summary of one completed arrival ------------------------------


async def test_completed_summary_carries_outcome_number_specialist_pricing(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party = await completed_arrival(db_session, env)
    resolved = await queries.party_view(db_session, party.id)  # type: ignore[arg-type]
    assert resolved is not None
    view = await queries.build_incoming_view(db_session, resolved[0], resolved[1])
    assert view.examination is not None
    summary = view.examination
    assert summary.status == "COMPLETED"
    assert summary.outcome == "FIT"
    assert summary.number == "DR44-1"
    # The frozen selected specialist — never created_by/login/UUID substitution.
    assert summary.specialist_name == "Смирнова Ольга Ивановна"
    assert summary.pricing is not None
    assert summary.pricing.total == "15.00"
    # Server-side Decimal sum of the frozen сверка + ВСЭ totals.
    assert summary.combined_total == "245.00"
    assert summary.currency == "RUB"


async def test_zero_plus_zero_is_zero_data_not_a_dash(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party = await completed_arrival(db_session, env, recon_total="0.00")
    exam = (await db_session.execute(select(Examination))).scalar_one()
    exam.pricing_snapshot = dict(ZERO_SNAPSHOT)
    await db_session.commit()
    resolved = await queries.party_view(db_session, party.id)  # type: ignore[arg-type]
    view = await queries.build_incoming_view(db_session, resolved[0], resolved[1])  # type: ignore[index]
    assert view.examination is not None
    assert view.examination.combined_total == "0.00"


async def test_missing_reconciliation_snapshot_keeps_the_total_absent(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party = await completed_arrival(db_session, env, recon_total=None)
    resolved = await queries.party_view(db_session, party.id)  # type: ignore[arg-type]
    view = await queries.build_incoming_view(db_session, resolved[0], resolved[1])  # type: ignore[index]
    assert view.examination is not None
    # A missing обязательный component is never substituted by zero.
    assert view.examination.combined_total is None
    assert view.examination.currency is None


async def test_corrupt_pricing_snapshot_keeps_the_total_absent(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party = await completed_arrival(db_session, env)
    exam = (await db_session.execute(select(Examination))).scalar_one()
    exam.pricing_snapshot = {"lines": "broken", "total": 12.5}
    await db_session.commit()
    resolved = await queries.party_view(db_session, party.id)  # type: ignore[arg-type]
    view = await queries.build_incoming_view(db_session, resolved[0], resolved[1])  # type: ignore[index]
    assert view.examination is not None
    assert view.examination.pricing is None
    assert view.examination.combined_total is None


def test_different_currencies_are_never_summed() -> None:
    # The pure server rule: mixed currencies never produce a partial sum.
    assert combined_total_of("230.00", "RUB", "15.00", "RUB") == "245.00"
    assert combined_total_of("230.00", "RUB", "15.00", "USD") is None
    assert combined_total_of(None, "RUB", "15.00", "RUB") is None
    assert combined_total_of("230.00", "RUB", None, "RUB") is None


async def test_legacy_row_without_frozen_name_uses_server_fallback(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party = await completed_arrival(db_session, env)
    exam = (await db_session.execute(select(Examination))).scalar_one()
    # A pre-DR35 row: no frozen ФИО and no specialist_id.
    exam.specialist_name = None
    exam.specialist_id = None
    await db_session.commit()
    resolved = await queries.party_view(db_session, party.id)  # type: ignore[arg-type]
    view = await queries.build_incoming_view(db_session, resolved[0], resolved[1])  # type: ignore[index]
    assert view.examination is not None
    assert view.examination.specialist_name == "Смирнова Ольга Ивановна"
    # Never the login, the UUID or the current session user's identity.
    assert view.examination.specialist_name != "dr44-vet"
    assert view.examination.specialist_name != str(env.actor.id)


async def test_page_summary_is_one_bulk_read_without_n_plus_one(
    db_session: AsyncSession, env: SimpleNamespace, test_db_engine
) -> None:
    first = await completed_arrival(db_session, env, number="DR44-1")
    second = await completed_arrival(db_session, env, number="DR44-2", configure_catalog=False)
    statements: list[str] = []

    def spy(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        statements.append(statement.lower())

    engine = test_db_engine
    event.listen(engine.sync_engine, "before_cursor_execute", spy)
    try:
        summaries = await queries.examination_summaries(db_session, [first.id, second.id])  # type: ignore[attr-defined]
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", spy)
    assert set(summaries) == {first.id, second.id}  # type: ignore[attr-defined]
    for summary in summaries.values():
        assert summary.number in {"DR44-1", "DR44-2"}
        assert summary.specialist_name == "Смирнова Ольга Ивановна"
    exams = [s for s in statements if " from examinations" in s]
    users = [s for s in statements if " from users" in s]
    assert len(exams) <= 1, f"examinations read {len(exams)} times — N+1"
    assert len(users) <= 1, f"users read {len(users)} times — N+1"
    # The read model never calls the VetIS contour.
    assert not any("vetis" in statement for statement in statements)


async def test_summaries_validate_frozen_snapshot_through_pricing_snapshot(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    party = await completed_arrival(db_session, env)
    summaries = await queries.examination_summaries(db_session, [party.id])  # type: ignore[attr-defined]
    pricing = summaries[party.id].pricing  # type: ignore[index]
    assert isinstance(pricing, PricingSnapshot)
    assert pricing.total == "15.00"
