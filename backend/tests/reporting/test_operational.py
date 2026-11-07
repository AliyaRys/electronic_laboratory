"""R01 tests: operational indicators (API-08, FT-RPT-02, AT-14, SC-013/014).

Named controller assertions:

- an internal reconciliation with two performed services → processed 0,
  product identification +1, transport inspection +1 (internal is excluded
  from «обработанные партии» only); a fair party is counted;
- each really performed service gives exactly one unit of its indicator,
  regardless of any tariff multiplier; a full return without the service adds
  nothing to it;
- counts use the completion time of the fact (``completed_at``), never the
  card creation date; period boundaries are half-open [from; to);
- sample balances are the current live sums, independent of the history
  period filter.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import moscow_date, utcnow
from backend.src.modules.arrivals import commands as arrivals_commands
from backend.src.modules.arrivals.models import Party, Reconciliation
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.reporting.queries import list_report_sources, operational_query
from backend.src.modules.samples.schemas import NewSample
from backend.src.modules.samples.service import apply_sample
from backend.tests.arrivals.test_import_and_queues import document

PERIOD_START = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)
PERIOD_END = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
IN_PERIOD = datetime(2025, 6, 15, 10, 0, 0, tzinfo=UTC)
AFTER_PERIOD = datetime(2026, 2, 1, 10, 0, 0, tzinfo=UTC)
BEFORE_PERIOD = datetime(2024, 12, 31, 23, 59, 59, tzinfo=UTC)


@pytest.fixture
async def lab(db_session: AsyncSession) -> Laboratory:
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(
        territory_id=territory.id, name="Лаборатория №1", address="ул. Первая, 1", organization="ГБУ"
    )
    user = User(
        login="vet1",
        full_name="Ветеринарный врач",
        email="vet@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(laboratory)
    db_session.add(user)
    await db_session.commit()
    return laboratory


@pytest.fixture
async def second_lab(db_session: AsyncSession, lab: Laboratory) -> Laboratory:
    territory = (await db_session.execute(select(Territory).limit(1))).scalar_one()
    laboratory = Laboratory(
        territory_id=territory.id, name="Лаборатория №2", address="ул. Вторая, 2", organization="ГБУ"
    )
    db_session.add(laboratory)
    await db_session.commit()
    return laboratory


@pytest_asyncio.fixture
async def actor(db_session: AsyncSession, lab: Laboratory) -> uuid.UUID:
    return (await db_session.execute(select(User.id).where(User.login == "vet1"))).scalar_one()


async def new_party(db_session: AsyncSession, lab: Laboratory) -> Party:
    doc = document(uuid.uuid4(), lab.id)
    imported = await arrivals_commands.upsert_incoming(db_session, doc)
    await db_session.commit()
    return imported


@pytest_asyncio.fixture
async def party(db_session: AsyncSession, lab: Laboratory) -> Party:
    return await new_party(db_session, lab)


def _services(*codes: str) -> list[dict[str, Any]]:
    """One stored service fact per code: the performed flag only, no quantity —
    the report counts facts, never tariff multipliers."""
    return [{"code": code, "performed": True} for code in codes]


async def make_reconciliation(
    db_session: AsyncSession,
    party: Party,
    actor: uuid.UUID,
    *,
    state: str = "CONFIRMED",
    completed_at: datetime | None = IN_PERIOD,
    internal: bool = False,
    services: list[dict[str, Any]] | None = None,
    fair: bool = False,
) -> Reconciliation:
    row = Reconciliation(
        party_id=party.id,
        checks={},
        services=services if services is not None else [],
        decision="RETURN_ALL" if state == "RETURNED" else "ACCEPT_ALL",
        transaction_planned=True if internal else None,
        transaction_type="INTERNAL" if internal else None,
        fair=fair,
        actor_id=actor,
        state=state,
        completed_at=completed_at,
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def query(db_session: AsyncSession, lab: Laboratory, **overrides: Any) -> Any:
    return await operational_query(
        db_session,
        lab.id,
        overrides.get("date_from", PERIOD_START),
        overrides.get("date_to", PERIOD_END),
    )


# --- named assertions ---------------------------------------------------------------


async def test_internal_with_two_services(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(
        db_session, party, actor, internal=True, services=_services("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")
    )
    view = await query(db_session, lab)
    assert view.processed_parties == 0
    assert view.product_identifications == 1
    assert view.transport_inspections == 1
    assert view.period.date_from == PERIOD_START
    assert view.period.date_to == PERIOD_END


async def test_external_confirmed_counts_processed(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(
        db_session, party, actor, services=_services("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")
    )
    view = await query(db_session, lab)
    assert view.processed_parties == 1
    assert view.product_identifications == 1
    assert view.transport_inspections == 1


async def test_unperformed_service_adds_zero(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(
        db_session,
        party,
        actor,
        services=[{"code": "PRODUCT_IDENTIFICATION", "performed": False}],
    )
    view = await query(db_session, lab)
    assert view.processed_parties == 1
    assert view.product_identifications == 0
    assert view.transport_inspections == 0


async def test_service_fact_is_one_unit_regardless_of_multiplier(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    # The stored fact is boolean; even when the tariff would multiply by the
    # accepted quantity (12 heads), the report counts exactly one service.
    await make_reconciliation(db_session, party, actor, services=_services("TRANSPORT_INSPECTION"))
    view = await query(db_session, lab)
    assert view.transport_inspections == 1


async def test_full_return_without_service_adds_nothing_to_services(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(db_session, party, actor, state="RETURNED", services=[])
    view = await query(db_session, lab)
    assert view.product_identifications == 0
    assert view.transport_inspections == 0
    # A confirmed-completed reconciliation is one processed party.
    assert view.processed_parties == 1


async def test_fair_party_is_counted(db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party) -> None:
    await make_reconciliation(db_session, party, actor, fair=True, services=_services("PRODUCT_IDENTIFICATION"))
    view = await query(db_session, lab)
    assert view.processed_parties == 1
    assert view.product_identifications == 1


async def test_completion_time_period_boundaries(db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID) -> None:
    at_start = await new_party(db_session, lab)
    before = await new_party(db_session, lab)
    after = await new_party(db_session, lab)
    await make_reconciliation(db_session, at_start, actor, completed_at=PERIOD_START)
    await make_reconciliation(db_session, before, actor, completed_at=BEFORE_PERIOD)
    await make_reconciliation(db_session, after, actor, completed_at=AFTER_PERIOD)
    view = await query(db_session, lab)
    assert view.processed_parties == 1


async def test_open_reconciliation_never_counts(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(db_session, party, actor, state="OPEN", completed_at=None)
    view = await query(db_session, lab)
    assert view.processed_parties == 0
    assert view.product_identifications == 0


async def test_other_laboratory_scope_is_isolated(
    db_session: AsyncSession, lab: Laboratory, second_lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(db_session, party, actor, services=_services("TRANSPORT_INSPECTION"))
    foreign = await query(db_session, second_lab)
    assert foreign.processed_parties == 0
    assert foreign.transport_inspections == 0
    assert foreign.current_sample_balances == []
    own = await query(db_session, lab)
    assert own.transport_inspections == 1


# --- sample balances: current, independent of the history period ---------------------


async def test_sample_balances_are_current_regardless_of_history_period(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    species = str(party.classification_snapshot["product"]["id"])
    await apply_sample(
        db_session,
        actor,
        party.id,
        uuid.uuid4(),
        NewSample(mode="NEW", collectedOn=moscow_date(utcnow()), massKg="0.8"),
    )
    await db_session.commit()
    # The collection is created «today» while the history window is a whole
    # year long past — the balance is still the current live sum.
    view = await query(db_session, lab)
    balances = {balance.product_species_id: balance.mass_kg for balance in view.current_sample_balances}
    assert balances[species] == "0.8"


# --- report source collection (queries.py) -------------------------------------------


async def _seed_examination(
    db_session: AsyncSession,
    lab: Laboratory,
    actor: uuid.UUID,
    party: Party,
    *,
    first_completed_at: datetime,
    researches: list[dict[str, Any]],
    accepted_mass_kg: str = "250",
    sent_to_lab: bool = False,
    outcome: str | None = None,
    direction: str | None = None,
    status: str = "COMPLETED",
    revision: int = 1,
) -> None:
    from backend.src.modules.arrivals.models import ReceiptConfirmation
    from backend.src.modules.examinations.models import Examination

    confirmation = ReceiptConfirmation(
        party_id=party.id,
        operation_id=uuid.uuid4(),
        source_evsd_uuid=uuid.uuid4(),
        fingerprint="a" * 64,
        evidence={},
        classification_snapshot=party.classification_snapshot,
        accepted_mass_kg=Decimal(accepted_mass_kg),
        accepted_quantity=Decimal("1"),
        accepted_unit_id="kg",
    )
    db_session.add(confirmation)
    db_session.add(
        Examination(
            party_id=party.id,
            laboratory_id=lab.id,
            number="ВСЭ-1",
            stamp="25",
            status=status,
            sent_to_lab=sent_to_lab,
            research_snapshot=researches,
            findings_snapshot={"invasive": [], "noncontagious": []},
            pricing_snapshot={"lines": [], "total": "0.00", "currency": "RUB", "fair": False},
            outcome=outcome,
            direction=direction,
            created_by=actor,
            created_at=datetime(2026, 2, 1, 10, 0, 0, tzinfo=UTC),
            first_completed_at=first_completed_at if status == "COMPLETED" else None,
            rev=revision,
        )
    )
    await db_session.commit()


async def test_list_report_sources_maps_completed_cards(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    species = str(party.classification_snapshot["product"]["id"])
    bact = uuid.uuid4()
    await _seed_examination(
        db_session,
        lab,
        actor,
        party,
        first_completed_at=datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC),
        researches=[{"indicatorId": str(bact), "kind": "TEXT", "value": "E. coli"}],
        accepted_mass_kg="250",
        sent_to_lab=True,
        outcome="UNFIT",
        direction="DESTRUCTION",
    )
    sources = await list_report_sources(db_session, lab.id, 2026, 1)
    assert len(sources) == 1
    resolved = sources[0]
    assert resolved.classification == species
    assert resolved.accepted_mass_kg == Decimal("250")
    assert bact in resolved.performed_indicator_ids
    assert resolved.sent_to_lab is True
    assert resolved.outcome == "UNFIT"
    assert resolved.direction == "DESTRUCTION"
    assert resolved.first_completed_at is not None
    assert resolved.revision == 1


async def test_list_report_sources_applies_half_year_boundaries(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID
) -> None:
    from zoneinfo import ZoneInfo

    moscow = ZoneInfo("Europe/Moscow")
    at_july = await new_party(db_session, lab)
    await _seed_examination(
        db_session,
        lab,
        actor,
        at_july,
        first_completed_at=datetime(2026, 7, 1, 0, 0, 0, tzinfo=moscow),  # AT-17
        researches=[],
    )
    half1 = await list_report_sources(db_session, lab.id, 2026, 1)
    half2 = await list_report_sources(db_session, lab.id, 2026, 2)
    assert half1 == []
    assert len(half2) == 1
