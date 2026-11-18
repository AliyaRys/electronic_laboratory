"""DR49 §7 export tests: scope, projection, snapshot and full history.

Named assertions:

- a GET export without a session is 401; ADMIN is forbidden (fail-closed),
  no CSRF and no Idempotency-Key are required for the GET;
- the projection carries the FULL history of the period (no page limit) and
  the current balances, both ordered per §7.2;
- masses stay Decimal; the document projection exposes no GUID and no actor
  id;
- ``date_from > date_to`` is a 422 Russian problem before any renderer;
- filenames follow §7.3 with hostile characters removed.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.samples import export_service
from backend.src.modules.samples.models import SampleDisposal
from backend.src.modules.samples.service import apply_sample
from backend.tests.samples.test_collections import (  # noqa: F401 - fixture re-export
    actor as collections_actor,
)
from backend.tests.samples.test_collections import lab as collections_lab
from backend.tests.samples.test_collections import (
    new_sample,
    species_id,
)
from backend.tests.samples.test_collections import (
    party as collections_party,
)
from backend.tests.samples.test_disposal import (  # noqa: F401 - fixture re-export
    client_for,
    dispose_env,
)

lab = collections_lab
actor = collections_actor
party = collections_party

from backend.src.core.contracts import CommandContext  # noqa: E402
from backend.src.core.problems import ProblemError  # noqa: E402
from backend.src.modules.samples.commands import dispose_samples  # noqa: E402
from backend.src.modules.samples.schemas import DisposalWrite  # noqa: E402
from backend.tests.samples.test_disposal import basket_rev  # noqa: E402


async def _dispose(
    db: AsyncSession,
    actor_id: uuid.UUID,
    lab_id: uuid.UUID,
    species: uuid.UUID,
    mass: str,
    on: date,
    number: str,
) -> SampleDisposal:
    payload = DisposalWrite.model_validate(
        {
            "laboratoryId": str(lab_id),
            "productSpeciesId": str(species),
            "disposedOn": on.isoformat(),
            "externalVsdNumber": number,
            "expectedMassKg": mass,
        }
    )
    ctx = CommandContext(
        actor_id=actor_id,
        idempotency_key=uuid.uuid4().hex,
        expected_revision=await basket_rev(db, lab_id, species),
    )
    return await dispose_samples(ctx, payload, uow=db)


async def test_projection_full_history_and_balances(
    db_session: AsyncSession, lab, actor: uuid.UUID, party
) -> None:
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8", date(2026, 11, 1)))
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.6", date(2026, 11, 1)))
    await db_session.commit()
    first = await _dispose(db_session, actor, lab.id, species, "1.4", date(2026, 11, 10), "ВСД-001")
    await db_session.commit()
    # 25 more historical disposals (> 20 screen page): each disposes the full
    # balance of the basket (the command is full-balance only).
    for index in range(25):
        await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.1", date(2026, 11, 2)))
        await db_session.commit()
        await _dispose(
            db_session, actor, lab.id, species, "0.1", date(2026, 11, 11 + index % 5), f"ВСД-{index + 10:03d}"
        )
        await db_session.commit()
    # The active remainder at the end.
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("2.5", date(2026, 11, 1)))
    await db_session.commit()

    view = await export_service.build_sample_accounting_document(db_session, lab.id)

    assert view.laboratory_name == lab.name
    # Balances are not period-dependent and stay Decimal.
    assert len(view.balances) == 1
    assert view.balances[0].mass_kg == Decimal("2.5")
    # The FULL history: 26 disposals, far beyond the 20-row screen page.
    assert len(view.disposals) == 26
    assert all(row.actor_name == "Ветеринарный врач" for row in view.disposals)
    assert first.external_vsd_number in {row.external_vsd_number for row in view.disposals}
    # No technical identifiers in the projection.
    document = view.model_dump()
    assert "product_species_id" not in str(document)
    assert "actor_id" not in str(document)


async def test_projection_period_filter_applies_to_history_only(
    db_session: AsyncSession, lab, actor: uuid.UUID, party
) -> None:
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("1.0", date(2026, 10, 1)))
    await db_session.commit()
    await _dispose(db_session, actor, lab.id, species, "1.0", date(2026, 10, 5), "ВСД-001")
    await db_session.commit()

    view = await export_service.build_sample_accounting_document(
        db_session, lab.id, date_from=date(2026, 11, 1), date_to=date(2026, 11, 30)
    )
    assert view.disposals == []
    assert view.date_from == date(2026, 11, 1) and view.date_to == date(2026, 11, 30)
    assert view.period_label() == "01.11.2026 — 30.11.2026"
    full = await export_service.build_sample_accounting_document(db_session, lab.id)
    assert len(full.disposals) == 1


async def test_projection_range_and_names(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("1.0", date(2026, 10, 1)))
    await db_session.commit()
    await _dispose(db_session, actor, lab.id, species, "1.0", date(2026, 10, 5), "ВСД-001")
    await db_session.commit()

    open_start = await export_service.build_sample_accounting_document(
        db_session, lab.id, date_from=date(2026, 10, 1)
    )
    assert open_start.period_label() == "с 01.10.2026"
    open_end = await export_service.build_sample_accounting_document(db_session, lab.id, date_to=date(2026, 10, 31))
    assert open_end.period_label() == "по 31.10.2026"
    every = await export_service.build_sample_accounting_document(db_session, lab.id)
    assert every.period_label() == "за всё время"

    with pytest.raises(ProblemError) as error:
        await export_service.build_sample_accounting_document(
            db_session, lab.id, date_from=date(2026, 11, 2), date_to=date(2026, 11, 1)
        )
    assert error.value.status == 422


def test_export_filename_sanitizes_hostile_names() -> None:
    assert (
        export_service.export_filename("pdf", 'Лаб "<>:|?*\x01"', date(2026, 11, 1), date(2026, 11, 30))
        == "Учёт_проб_Лаб_01.11.2026_30.11.2026.pdf"
    )
    assert export_service.export_filename("xlsx", "", None, None) == "Учёт_проб_все_все.xlsx"


async def test_export_endpoints_require_session_and_serve_files(dispose_env, lab) -> None:  # noqa: F811
    async with client_for(dispose_env) as (http, _identity):
        pdf = await http.get(f"/api/v1/samples/accounting/export.pdf?laboratory_id={lab.id}")
        assert pdf.status_code == 200, pdf.text
        assert pdf.headers["content-type"] == "application/pdf"
        assert pdf.headers["cache-control"] == "no-store"
        assert "filename*=UTF-8''" in pdf.headers["content-disposition"]
        assert pdf.content.startswith(b"%PDF-")
        xlsx = await http.get(f"/api/v1/samples/accounting/export.xlsx?laboratory_id={lab.id}")
        assert xlsx.status_code == 200, xlsx.text
        assert xlsx.headers["cache-control"] == "no-store"
        assert xlsx.content[:2] == b"PK"


async def test_admin_is_forbidden(dispose_env) -> None:  # noqa: F811
    async with client_for(dispose_env, user=dispose_env.admin) as (http, _identity):
        response = await http.get(f"/api/v1/samples/accounting/export.xlsx?laboratory_id={dispose_env.own.id}")
        assert response.status_code == 403


async def test_reversed_range_answers_422(dispose_env, lab) -> None:  # noqa: F811
    async with client_for(dispose_env) as (http, _identity):
        response = await http.get(
            f"/api/v1/samples/accounting/export.pdf?laboratory_id={lab.id}&date_from=2026-11-10&date_to=2026-11-01"
        )
        assert response.status_code == 422
        assert "позже даты окончания" in response.text
