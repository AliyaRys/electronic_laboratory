"""DR52 §3: the examination's own VSE-only fair waiver.

The card's ``vse_fair`` flag zeroed ONLY the VSE pricing; the frozen
reconciliation snapshot/total/fair is never touched. The rule is
``effective_vse_fair = reconciliation.fair OR examination.vse_fair``, both
the preview and the save go through ONE ``evaluate_and_price``.
"""

from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import UnitOfWork  # noqa: F401
from backend.src.core.contracts import CommandContext
from backend.src.modules.arrivals.models import Reconciliation
from backend.src.modules.catalog_pricing.schemas import ResearchValue
from backend.src.modules.examinations.commands import preview_pricing, save_examination
from backend.src.modules.examinations.lifecycle import update_examination
from backend.src.modules.examinations.models import Examination
from backend.src.modules.examinations.queries import build_view
from backend.src.modules.examinations.schemas import ExaminationWrite
from backend.src.modules.identity.models import TechnicalEvent
from backend.tests.examinations.test_create import configure, context
from backend.tests.examinations.test_dr35_data_rules import BEEF, dr35_party  # noqa: F401
from backend.tests.examinations.test_dr35_data_rules import env as _env_fixture

# Reuse the env fixture by importing it under the required name.
env = _env_fixture


def write(
    number: str,
    *,
    specialist_id: uuid.UUID,
    expected_total: str | None,
    vse_fair: bool,
    mode: str = "COMPLETED",
) -> ExaminationWrite:
    data: dict[str, object] = {
        "mode": mode,
        "number": number,
        "stamp": "Клеймо-1",
        "researches": [
            {"indicatorId": "c8d1e50e-bf49-5475-bb82-860f6fc47e74", "kind": "BOOLEAN", "value": True},
            {"indicatorId": "5410ca53-ffae-5a27-ab8d-51cb20fe4011", "kind": "BOOLEAN", "value": True},
            {"indicatorId": "ec2fba68-e4d1-5c82-9591-92ee9da5293e", "kind": "DECIMAL", "value": "4.5"},
        ],
        "sample": {"mode": "NEW", "collectedOn": str(date.today()), "massKg": "0.8"},
        "sentToLab": mode == "WAITING",
        "specialistId": str(specialist_id),
        "expectedTotal": expected_total,
        "vseFair": vse_fair,
    }
    if mode == "COMPLETED":
        data.update({"outcome": "FIT", "direction": "SALE"})
    return ExaminationWrite.model_validate(data)


def results_of(write_payload: ExaminationWrite) -> list[ResearchValue]:
    return [
        ResearchValue(indicator_id=item.indicator_id, performed=True, value=item.value)
        for item in write_payload.researches
    ]


@pytest.mark.asyncio
async def test_vse_only_waiver_zeroes_preview_and_save_but_not_reconciliation(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    reconciliation = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one_or_none()
    assert reconciliation is None  # no reconciliation row exists yet: fair=False
    base = write("DR52-1", specialist_id=env.actor.id, expected_total="18.75", vse_fair=False)

    preview = await preview_pricing(db_session, party, results_of(base), vse_fair=True)  # type: ignore[arg-type]
    await db_session.commit()
    assert preview.fair is True
    assert preview.total == "0.00"

    view = await save_examination(
        context(env.actor.id),
        party.id,
        write("DR52-1", specialist_id=env.actor.id, expected_total="0.00", vse_fair=True),
        uow=db_session,
    )
    await db_session.commit()
    assert view.pricing["total"] == "0.00"
    assert view.pricing["fair"] is True
    assert view.vse_fair is True
    assert view.reconciliation_fair is False
    assert view.fair_source == "EXAMINATION"


@pytest.mark.asyncio
async def test_reconciliation_fair_forces_effective_free_even_with_false_card_flag(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF, fair=True)
    write_payload = write("DR52-2", specialist_id=env.actor.id, expected_total="0.00", vse_fair=False)
    preview = await preview_pricing(
        db_session,
        party,
        results_of(write_payload),
        vse_fair=False,
    )  # type: ignore[arg-type]
    await db_session.commit()
    assert preview.total == "0.00" and preview.fair is True
    view = await save_examination(
        context(env.actor.id),
        party.id,
        write("DR52-2", specialist_id=env.actor.id, expected_total="0.00", vse_fair=False),
        uow=db_session,
    )
    await db_session.commit()
    assert view.vse_fair is False
    assert view.reconciliation_fair is True
    assert view.fair_source == "RECONCILIATION"


@pytest.mark.asyncio
async def test_waiver_off_returns_the_regular_total(db_session: AsyncSession, env: SimpleNamespace) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    write_payload = write("DR52-3", specialist_id=env.actor.id, expected_total="18.75", vse_fair=False)
    preview = await preview_pricing(
        db_session,
        party,
        results_of(write_payload),
        vse_fair=False,
    )  # type: ignore[arg-type]
    await db_session.commit()
    assert preview.total == "18.75" and preview.fair is False
    view = await save_examination(
        context(env.actor.id),
        party.id,
        write("DR52-3", specialist_id=env.actor.id, expected_total="18.75", vse_fair=False),
        uow=db_session,
    )
    await db_session.commit()
    assert view.vse_fair is False and view.fair_source == "NONE"


@pytest.mark.asyncio
async def test_same_day_edit_round_trip_and_reconciliation_snapshot_untouched(
    db_session: AsyncSession, env: SimpleNamespace
) -> None:
    await configure(db_session, env.lab.id, BEEF, trich=False)
    party = await dr35_party(db_session, env, BEEF)
    reconciliation = Reconciliation(
        party_id=party.id,
        checks={},
        services={},
        actor_id=env.actor.id,
        decision="ACCEPT_ALL",
        state="CONFIRMED",
        fair=False,
        pricing_snapshot={
            "lines": [{"service_code": "PRODUCT_IDENTIFICATION", "amount": "280.00"}],
            "total": "280.00",
            "currency": "RUB",
            "fair": False,
        },
        rev=1,
    )
    db_session.add(reconciliation)
    await db_session.commit()
    created = await save_examination(
        context(env.actor.id),
        party.id,
        write("DR52-4", specialist_id=env.actor.id, expected_total="18.75", vse_fair=False),
        uow=db_session,
    )
    await db_session.commit()
    assert created.fair_source == "NONE"

    edited = await update_examination(
        CommandContext(
            actor_id=env.actor.id, idempotency_key=str(uuid.uuid4()), expected_revision=1
        ),
        uuid.UUID(created.id),
        write("DR52-4b", specialist_id=env.actor.id, expected_total="0.00", vse_fair=True),
        uow=db_session,
    )
    await db_session.commit()
    assert edited.vse_fair is True and edited.pricing["total"] == "0.00"

    party_id = party.id
    db_session.expire_all()
    saved_recon = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party_id))
    ).scalar_one()
    assert saved_recon.fair is False
    assert saved_recon.pricing_snapshot["total"] == "280.00"
    assert saved_recon.pricing_snapshot["fair"] is False

    view = await build_view(db_session, (await db_session.execute(select(Examination))).scalar_one())
    assert view.vse_fair is True and view.reconciliation_fair is False and view.fair_source == "EXAMINATION"

    events = (
        (
            await db_session.execute(
                select(TechnicalEvent).where(
                    TechnicalEvent.action == "examination:vse_fair",
                    TechnicalEvent.object_uuid == uuid.UUID(created.id),
                )
            )
        )
        .scalars()
        .all()
    )
    assert any("false->true:EXAMINATION" in event.result for event in events)


@pytest.mark.integration
def test_migration_0025_adds_column_and_keeps_single_head(test_db_url: str) -> None:
    import os
    import subprocess
    import sys
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]

    def alembic(*args: str) -> subprocess.CompletedProcess[str]:
        command_env = dict(os.environ)
        command_env["DATABASE_URL"] = test_db_url
        return subprocess.run(  # noqa: S603
            [sys.executable, "-m", "alembic", "-c", str(repo_root / "backend" / "alembic.ini"), *args],
            cwd=str(repo_root),
            env=command_env,
            capture_output=True,
            text=True,
        )

    import psycopg  # noqa: PLC0415

    sync_url = test_db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    downgraded = alembic("downgrade", "0024_report_classification_seed")
    assert downgraded.returncode == 0, downgraded.stdout + downgraded.stderr
    try:
        with psycopg.connect(sync_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns WHERE table_name='examinations'"
                " AND column_name='vse_fair'"
            )
            assert cursor.fetchone()[0] == 0  # the column does not exist at 0024
        upgraded = alembic("upgrade", "head")
        assert upgraded.returncode == 0, upgraded.stdout + up_error(upgraded)
        with psycopg.connect(sync_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT column_default FROM information_schema.columns WHERE table_name='examinations'"
                " AND column_name='vse_fair'"
            )
            default = cursor.fetchone()
            assert default is not None and "false" in (default[0] or "")
        heads = alembic("heads")
        assert heads.stdout.strip().count("\n") == 0  # exactly one head
        assert "0025_examination_vse_fair" in heads.stdout
    finally:
        restored = alembic("upgrade", "head")
        assert restored.returncode == 0, restored.stdout + restored.stderr


def up_error(result: object) -> str:
    return getattr(result, "stderr", "")
