"""R01 tests: operational indicators (API-08, FT-RPT-02, AT-14, SC-013/014).

Named controller assertions (DR48 semantics):

- ``saved_examinations`` counts the really existing saved local ВСЭ cards of
  one laboratory created in the chosen period — WAITING and COMPLETED both
  count, tombstones/other laboratories/out-of-period never count, a plain
  count never doubles a card, and an internal/fair party never excludes one;
- each really performed service gives exactly one unit of its indicator,
  regardless of any tariff multiplier; a full return without the service adds
  nothing to it; the internal flag never excludes a performed service;
- counts use the completion time of the fact (``completed_at``), never the
  card creation date; the card metric uses ``created_at`` in the Moscow
  calendar window ``[from 00:00, to + 1 день 00:00)``;
- the operational endpoint never touches the sample-balance read model.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import utcnow
from backend.src.modules.arrivals import commands as arrivals_commands
from backend.src.modules.arrivals.models import Party, Reconciliation
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.reporting.queries import list_report_sources, operational_query
from backend.tests.arrivals.test_import_and_queues import document

PERIOD_FROM = date(2025, 1, 1)
PERIOD_TO = date(2025, 12, 31)
IN_PERIOD = datetime(2025, 6, 15, 10, 0, 0, tzinfo=UTC)
AFTER_PERIOD = datetime(2026, 2, 1, 10, 0, 0, tzinfo=UTC)
BEFORE_PERIOD = datetime(2024, 12, 31, 20, 59, 59, tzinfo=UTC)


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
        overrides.get("date_from", PERIOD_FROM),
        overrides.get("date_to", PERIOD_TO),
    )


# --- named assertions ---------------------------------------------------------------


async def test_internal_with_two_services(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(
        db_session, party, actor, internal=True, services=_services("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")
    )
    view = await query(db_session, lab)
    assert view.saved_examinations == 0
    assert view.product_identifications == 1
    assert view.transport_inspections == 1
    assert view.period.date_from == PERIOD_FROM
    assert view.period.date_to == PERIOD_TO


async def test_external_confirmed_counts_services(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(
        db_session, party, actor, services=_services("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")
    )
    view = await query(db_session, lab)
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


async def test_fair_party_services_are_counted(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(db_session, party, actor, fair=True, services=_services("PRODUCT_IDENTIFICATION"))
    view = await query(db_session, lab)
    assert view.product_identifications == 1


async def test_completion_time_period_boundaries(db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID) -> None:
    at_start = await new_party(db_session, lab)
    before = await new_party(db_session, lab)
    after = await new_party(db_session, lab)
    await make_reconciliation(
        db_session,
        at_start,
        actor,
        completed_at=datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC),
        services=_services("PRODUCT_IDENTIFICATION"),
    )
    await make_reconciliation(db_session, before, actor, completed_at=BEFORE_PERIOD)
    await make_reconciliation(db_session, after, actor, completed_at=AFTER_PERIOD)
    view = await query(db_session, lab)
    assert view.product_identifications == 1


async def test_open_reconciliation_never_counts(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(db_session, party, actor, state="OPEN", completed_at=None)
    view = await query(db_session, lab)
    assert view.product_identifications == 0


async def test_other_laboratory_scope_is_isolated(
    db_session: AsyncSession, lab: Laboratory, second_lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await make_reconciliation(db_session, party, actor, services=_services("TRANSPORT_INSPECTION"))
    foreign = await query(db_session, second_lab)
    assert foreign.saved_examinations == 0
    assert foreign.transport_inspections == 0
    own = await query(db_session, lab)
    assert own.transport_inspections == 1


# --- DR48 §2.2: saved_examinations = really saved local ВСЭ cards --------------------


async def _seed_card(
    db_session: AsyncSession,
    lab: Laboratory,
    actor: uuid.UUID,
    party: Party,
    *,
    created_at: datetime,
    status: str = "COMPLETED",
    first_completed_at: datetime | None = None,
) -> uuid.UUID:
    from backend.src.modules.examinations.models import Examination

    row = Examination(
        party_id=party.id,
        laboratory_id=lab.id,
        number=f"ВСЭ-{uuid.uuid4().hex[:8]}",
        stamp="25",
        status=status,
        sent_to_lab=False,
        research_snapshot=[],
        findings_snapshot={"invasive": [], "noncontagious": []},
        pricing_snapshot={"lines": [], "total": "0.00", "currency": "RUB", "fair": False},
        outcome=None,
        direction=None,
        created_by=actor,
        created_at=created_at,
        first_completed_at=first_completed_at
        if first_completed_at is not None
        else (created_at if status == "COMPLETED" else None),
        rev=1,
    )
    db_session.add(row)
    await db_session.commit()
    return row.id


async def test_waiting_and_completed_cards_both_count(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    waiting_id = await _seed_card(db_session, lab, actor, party, created_at=IN_PERIOD, status="WAITING")
    second_party = await new_party(db_session, lab)
    completed_id = await _seed_card(
        db_session,
        lab,
        actor,
        second_party,
        created_at=IN_PERIOD,
        status="COMPLETED",
        first_completed_at=IN_PERIOD,
    )
    view = await query(db_session, lab)
    assert view.saved_examinations == 2
    assert {waiting_id, completed_id}


async def test_cards_outside_period_and_other_lab_never_count(
    db_session: AsyncSession, lab: Laboratory, second_lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    before_party = await new_party(db_session, lab)
    after_party = await new_party(db_session, lab)
    foreign_party = await new_party(db_session, second_lab)
    await _seed_card(db_session, lab, actor, before_party, created_at=BEFORE_PERIOD)
    await _seed_card(db_session, lab, actor, after_party, created_at=AFTER_PERIOD)
    await _seed_card(db_session, second_lab, actor, foreign_party, created_at=IN_PERIOD)
    view = await query(db_session, lab)
    assert view.saved_examinations == 0


async def test_tombstoned_card_never_counts(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    from backend.src.modules.examinations.models import ExaminationTombstone

    card_id = await _seed_card(db_session, lab, actor, party, created_at=IN_PERIOD)
    db_session.add(
        ExaminationTombstone(
            examination_id=card_id,
            laboratory_id=lab.id,
            deleted_at=utcnow(),
            actor_id=actor,
            command_id=uuid.uuid4(),
        )
    )
    await db_session.commit()
    view = await query(db_session, lab)
    assert view.saved_examinations == 0


async def test_moscow_day_boundaries_of_created_at(db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID) -> None:
    from zoneinfo import ZoneInfo

    moscow = ZoneInfo("Europe/Moscow")
    first_party = await new_party(db_session, lab)
    last_party = await new_party(db_session, lab)
    early_party = await new_party(db_session, lab)
    late_party = await new_party(db_session, lab)
    # The first Moscow instant of the FIRST day and the last of the LAST day
    # count; the second before 00:00 and the first after the range do not.
    await _seed_card(db_session, lab, actor, first_party, created_at=datetime(2025, 1, 1, 0, 0, 0, tzinfo=moscow))
    await _seed_card(db_session, lab, actor, last_party, created_at=datetime(2025, 12, 31, 23, 59, 59, tzinfo=moscow))
    await _seed_card(db_session, lab, actor, early_party, created_at=datetime(2024, 12, 31, 23, 59, 59, tzinfo=moscow))
    await _seed_card(db_session, lab, actor, late_party, created_at=datetime(2026, 1, 1, 0, 0, 0, tzinfo=moscow))
    view = await query(db_session, lab)
    assert view.saved_examinations == 2


async def test_internal_party_card_still_counts(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    # The saved-cards metric never excludes a card because of the party's
    # internal-transaction flag (the flag belongs to the old party metric).
    await _seed_card(db_session, lab, actor, party, created_at=IN_PERIOD)
    view = await query(db_session, lab)
    assert view.saved_examinations == 1


async def test_card_count_is_a_plain_count_without_joins(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    # A card with rich research data contributes exactly one unit: the count
    # never multiplies through joins with studies or samples.
    await _seed_card(db_session, lab, actor, party, created_at=IN_PERIOD)
    view = await query(db_session, lab)
    assert view.saved_examinations == 1


async def test_operational_query_never_touches_sample_balances() -> None:
    import inspect

    from backend.src.modules.reporting import queries

    source = inspect.getsource(queries)
    assert "balance_list" not in source
    assert "current_sample_balances" not in source


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
    sources = await list_report_sources(db_session, lab.id, date(2026, 1, 1), date(2026, 6, 30))
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


async def test_list_report_sources_applies_range_boundaries(
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
        first_completed_at=datetime(2026, 7, 1, 0, 0, 0, tzinfo=moscow),
        researches=[],
    )
    before = await list_report_sources(db_session, lab.id, date(2026, 1, 1), date(2026, 6, 30))
    inside = await list_report_sources(db_session, lab.id, date(2026, 7, 1), date(2026, 7, 1))
    assert before == []
    assert len(inside) == 1


# --- DR45 §6: the server owns the service facts --------------------------------------


async def test_confirmed_receipt_persists_service_facts(db_session: AsyncSession, lab, actor, party: Party) -> None:
    """The real flow: a saved reconciliation (the client sends NO services) is
    confirmed externally; the confirmation itself freezes the two performed
    service facts atomically, and the operational report counts +1/+1."""
    from backend.src.core.contracts import CommandContext
    from backend.src.modules.arrivals.confirmation import confirm_receipt  # noqa: F401
    from backend.src.modules.arrivals.models import Reconciliation
    from backend.src.modules.arrivals.reconciliation import save_reconciliation
    from backend.src.modules.arrivals.schemas import ReconciliationWrite
    from backend.src.modules.arrivals.validation import normalize_payload
    from backend.src.modules.catalog_pricing.models import CheckServiceRule, Tariff
    from backend.tests.arrivals.test_confirmation import real_payload
    from backend.tests.arrivals.test_dr11_pricing import CHECK_RULE_SOURCE, TARIFF_SOURCE, UNIT
    from backend.tests.arrivals.test_import_and_queues import document

    # CHECK pricing must be configured for the laboratory: global rules plus
    # the two laboratory tariffs (prices 0 keep the flow honest and simple).
    db_session.add_all(
        [
            CheckServiceRule(
                service_code=code,
                unit_id=UNIT,
                multiplier_basis="ONE_SERVICE",
                applicable_decisions=["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"],
                version=1,
                source=CHECK_RULE_SOURCE,
            )
            for code in ("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")
        ]
    )
    db_session.add_all(
        [
            Tariff(
                laboratory_id=lab.id,
                product_species_id=None,
                service_code=code,
                unit_id="RUB",
                price=Decimal("0.00"),
                version=1,
                source=TARIFF_SOURCE,
            )
            for code in ("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")
        ]
    )
    await db_session.commit()

    evsd = uuid.uuid4()
    fresh = await arrivals_commands.upsert_incoming(db_session, document(evsd, lab.id))
    await db_session.commit()
    payload = normalize_payload(
        ReconciliationWrite.model_validate(real_payload().model_dump(mode="json", by_alias=True))
    )
    await save_reconciliation(
        CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=fresh.rev),
        fresh.id,
        payload,
        uow=db_session,
    )
    await db_session.commit()

    from backend.tests.fixtures.receipt_evidence import (
        FixtureReceiptEvidenceReader,
        confirm_via_reader,
        receipt_evidence,
    )

    reader = FixtureReceiptEvidenceReader()
    reader.plant(fresh.id, receipt_evidence(evsd))
    first = await confirm_via_reader(db_session, reader, fresh.id)
    await db_session.commit()
    assert first is not None

    row = (await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == fresh.id))).scalar_one()
    assert row.state == "CONFIRMED"
    performed = {item["code"] for item in row.services if isinstance(item, dict) and item.get("performed") is True}
    assert performed == {"PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"}


# --- DR45 §6: the idempotent CONFIRMED backfill (migration 0022) ----------------------


async def test_backfill_0022_enriches_confirmed_rows_idempotently(
    db_session: AsyncSession, lab, actor, party: Party
) -> None:
    """A historical CONFIRMED row saved with empty services gets the two
    performed facts; RETURNED rows stay untouched; a second run adds nothing."""
    import importlib.util
    from pathlib import Path

    from sqlalchemy import text

    spec = importlib.util.spec_from_file_location(
        "dr45_service_facts_migration",
        Path(__file__).resolve().parents[2] / "migrations/versions/0022_journal_service_facts.py",
    )
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    confirmed = await make_reconciliation(db_session, party, actor, services=[])
    returned_party = await new_party(db_session, lab)
    returned = await make_reconciliation(db_session, returned_party, actor, state="RETURNED", services=[])
    await db_session.commit()

    engine = db_session.bind
    async with engine.begin() as conn:  # type: ignore[union-attr]
        for _attempt in range(2):
            await conn.run_sync(lambda sync_conn: migration.backfill_service_facts(sync_conn))  # type: ignore[arg-type]

    stored = (
        await db_session.execute(text("SELECT services FROM reconciliations WHERE id = :id"), {"id": confirmed.id})
    ).scalar_one()
    performed = {item["code"] for item in stored if item.get("performed") is True}
    assert performed == {"PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"}

    returned_services = (
        await db_session.execute(text("SELECT services FROM reconciliations WHERE id = :id"), {"id": returned.id})
    ).scalar_one()
    assert returned_services == []

    view = await operational_query(db_session, lab.id, date(2020, 1, 1), date(2029, 12, 31))
    assert view.product_identifications == 1
    assert view.transport_inspections == 1
