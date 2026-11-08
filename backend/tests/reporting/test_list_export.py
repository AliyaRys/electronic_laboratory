"""R03: the saved-report list and the snapshot-only exports (API-08).

The list carries no payload; the exports render exactly the saved snapshot —
never a recomputation of the sources (a deleted/corrected source cannot
change an already-saved report). HEAD/ANALYST only; ADMIN is forbidden.
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import CommandContext
from backend.src.core.keyring import PreviewKeyring, SigningKey
from backend.src.core.problems import ProblemError
from backend.src.modules.documents import resources
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.reporting.commands import save_report
from backend.src.modules.reporting.projection import (
    BIRD_COLUMN,
    report_document_view,
    report_pdf_filename,
    report_xlsx_filename,
)
from backend.src.modules.reporting.schemas import (
    ReportCodesWrite,
    ReportPreviewParams,
    ReportSnapshotView,
)
from backend.src.modules.reporting.snapshots import preview_report

NOW = datetime(2027, 1, 2, tzinfo=UTC)


def keyring() -> PreviewKeyring:
    return PreviewKeyring(SigningKey("r03", b"r" * 32, NOW - timedelta(days=1)))


def codes() -> ReportCodesWrite:
    return ReportCodesWrite(
        okud="001", okpo="12345678", okved="01.46", oktmo="92701001", okogu="-", okopf="75404", okfs="42"
    )


async def seed_lab(
    db: AsyncSession, laboratory: Laboratory | None = None, actor: User | None = None
) -> tuple[uuid.UUID, uuid.UUID]:
    """One laboratory with two completed destruction sources (the R02 shape)."""
    from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation
    from backend.src.modules.catalog_pricing.models import ReportClassification
    from backend.src.modules.examinations.models import Examination
    from backend.src.modules.identity.models import Territory as _Territory

    if laboratory is None or actor is None:
        territory = _Territory(name="Территория отчётов")
        db.add(territory)
        await db.flush()
        laboratory = Laboratory(
            territory_id=territory.id, name="Лаборатория <экспорт>", address="Адрес", organization="ГБУ"
        )
        actor = User(
            login=f"head-{uuid.uuid4()}",
            full_name="Руководитель",
            email=f"{uuid.uuid4()}@example.test",
            password_hash="unused",
            role="HEAD",
            active=True,
        )
        db.add_all([laboratory, actor])
        await db.flush()
    lab = laboratory
    incoming = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=lab.id,
        external_status="CONFIRMED",
        source_snapshot={},
        content_hash="0" * 64,
        fetched_at=NOW,
    )
    db.add(incoming)
    await db.flush()
    party = Party(
        incoming_document_id=incoming.id,
        laboratory_id=lab.id,
        classification_snapshot={"product": {"id": "mercury-pig-meat"}},
    )
    db.add(party)
    await db.flush()
    db.add_all(
        [
            ReceiptConfirmation(
                party_id=party.id,
                operation_id=uuid.uuid4(),
                source_evsd_uuid=incoming.evsd_uuid,
                fingerprint="1" * 64,
                evidence={},
                accepted_mass_kg=Decimal("250"),
                accepted_quantity=Decimal("1"),
                accepted_unit_id="kg",
                returned_mass_kg=Decimal("0"),
                returned_quantity=Decimal("0"),
                classification_snapshot={},
                confirmed_at=datetime(2026, 2, 1, tzinfo=UTC),
            ),
            ReportClassification(
                version="2026-v1",
                mercury_species_id="mercury-pig-meat",
                supported=True,
                animal_column="PIG",
                material_kind="MEAT",
                rev=1,
            ),
        ]
    )
    examination = Examination(
        party_id=party.id,
        laboratory_id=lab.id,
        number="VSE-1",
        stamp="stamp",
        status="COMPLETED",
        sent_to_lab=False,
        research_snapshot=[],
        findings_snapshot={},
        pricing_snapshot={},
        outcome="UNFIT",
        direction="DESTRUCTION",
        created_by=actor.id,
        created_at=datetime(2026, 2, 1, tzinfo=UTC),
        first_completed_at=datetime(2026, 2, 1, tzinfo=UTC),
        rev=1,
    )
    db.add(examination)
    # A second period's source on a separate party (each party carries one card).
    incoming2 = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=lab.id,
        external_status="CONFIRMED",
        source_snapshot={},
        content_hash="1" * 64,
        fetched_at=NOW,
    )
    db.add(incoming2)
    await db.flush()
    party2 = Party(
        incoming_document_id=incoming2.id,
        laboratory_id=lab.id,
        classification_snapshot={"product": {"id": "mercury-pig-meat"}},
    )
    db.add(party2)
    await db.flush()
    db.add_all(
        [
            ReceiptConfirmation(
                party_id=party2.id,
                operation_id=uuid.uuid4(),
                source_evsd_uuid=incoming2.evsd_uuid,
                fingerprint="2" * 64,
                evidence={},
                accepted_mass_kg=Decimal("250"),
                accepted_quantity=Decimal("1"),
                accepted_unit_id="kg",
                returned_mass_kg=Decimal("0"),
                returned_quantity=Decimal("0"),
                classification_snapshot={},
                confirmed_at=datetime(2025, 2, 1, tzinfo=UTC),
            )
        ]
    )
    examination2 = Examination(
        party_id=party2.id,
        laboratory_id=lab.id,
        number="VSE-2",
        stamp="stamp",
        status="COMPLETED",
        sent_to_lab=False,
        research_snapshot=[],
        findings_snapshot={},
        pricing_snapshot={},
        outcome="UNFIT",
        direction="DESTRUCTION",
        created_by=actor.id,
        created_at=datetime(2025, 2, 1, tzinfo=UTC),
        first_completed_at=datetime(2025, 2, 1, tzinfo=UTC),
        rev=1,
    )
    db.add(examination2)
    await db.commit()
    return lab.id, actor.id


async def save_period(
    db: AsyncSession, lab_id: uuid.UUID, actor_id: uuid.UUID, year: int, half: int
) -> ReportSnapshotView:
    """Save one snapshot for the period on the already-seeded laboratory."""
    preview = await preview_report(
        db,
        actor_id,
        "session-r03",
        ReportPreviewParams(laboratory_id=lab_id, year=year, half=half),
        keyring=keyring(),
        now=NOW,
    )
    saved = await save_report(
        CommandContext(actor_id=actor_id, idempotency_key=f"save-{year}-{half}"),
        preview,
        codes(),
        session_id="session-r03",
        db=db,
        keyring=keyring(),
        now=NOW,
    )
    await db.commit()
    return saved


@pytest.mark.asyncio
async def test_projection_merges_birds_and_marks_manual_rows(db_session: AsyncSession) -> None:
    lab_id, actor_id = await seed_lab(db_session)
    view = await save_period(db_session, lab_id, actor_id, 2026, 1)
    model = report_document_view(view)

    # 8 data columns → 7 printed columns (the bird pair merged once).
    assert len(model.columns) == 7
    assert BIRD_COLUMN in model.columns
    assert "Птица — куры" not in model.columns and "Птица — другие" not in model.columns
    # 10 automatic rows + 2 manual rows, in the form order.
    assert [row.code for row in model.matrix][-2:] == ["sickness_of_animals", "inspections_of_meat"]
    automatic = [row for row in model.matrix if row.automatic]
    assert [row.code for row in automatic] == [
        "166",
        "167",
        "168",
        "169",
        "170",
        "171",
        "172",
        "240",
        "241",
        "242",
    ]
    # Rows 240–242 are tonnes of the seeded 250 кг meat destruction.
    row240 = next(row for row in model.matrix if row.code == "240")
    assert row240.values["Свиньи"] == 0.25
    # The projection never invents a manual number.
    manual = model.matrix[-1]
    assert manual.automatic is False and set(manual.values.values()) == {None}
    # The snapshot-only provenance and the preliminary marking.
    assert model.official is False and "Предварительная форма" in model.warnings
    assert model.laboratory == "Лаборатория <экспорт>"
    assert model.period == "январь—июнь 2026"


def test_report_filenames_are_api08_safe() -> None:
    payload = {
        "laboratory": {"name": 'Лаборатория "1" <2> /:?*\n'},
        "classification_version": "2026-v1",
    }
    view = SimpleNamespace(payload=payload, year=2026, half=2)  # type: ignore[arg-type]
    assert report_pdf_filename(view) == "5-вет_раздел-III_Лаборатория 1 2 _2026_2-полугодие.pdf"  # type: ignore[arg-type]
    assert report_xlsx_filename(view) == "5-вет_раздел-III_Лаборатория 1 2 _2026_2-полугодие.xlsx"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_exports_render_the_saved_snapshot(db_session: AsyncSession) -> None:
    lab_id, actor_id = await seed_lab(db_session)
    view = await save_period(db_session, lab_id, actor_id, 2026, 1)
    model = report_document_view(view)
    form = resources.load_manifest("report-5vet")
    from backend.src.modules.documents import pdf, xlsx

    pdf_data = pdf.render_pdf(model, form)
    reader = PdfReader(io.BytesIO(pdf_data))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "ФОРМА 5-ВЕТ, РАЗДЕЛ III" in text
    assert "Предварительная форма" in text
    assert "001" in text and "Не рассчитывается" in text

    sheet = load_workbook(io.BytesIO(xlsx.render_xlsx(model, form))).active
    assert sheet is not None
    # ОКУД «001» stays a text cell; numbers stay numeric.
    assert sheet.cell(row=2, column=2).value == "001"
    row240_row_number = 4 + 8  # header + the 240 row offset
    value = sheet.cell(row=row240_row_number, column=4).value
    assert isinstance(value, float) and value == 0.25

    assert report_xlsx_filename(view).endswith(".xlsx")


@pytest.mark.asyncio
async def test_list_reports_is_paged_and_newest_first(db_session: AsyncSession) -> None:
    lab_id, actor_id = await seed_lab(db_session)
    from backend.src.modules.reporting import commands

    await save_period(db_session, lab_id, actor_id, 2025, 1)
    await save_period(db_session, lab_id, actor_id, 2026, 1)
    page = await commands.list_reports(db_session, lab_id, page=1)
    assert page.total == 2 and page.page_size == 20
    assert [(item.year, item.half) for item in page.items] == [(2026, 1), (2025, 1)]
    empty = await commands.list_reports(db_session, lab_id, page=2)
    assert empty.items == []
    # The list never carries the payload.
    from backend.src.modules.reporting.schemas import ReportSummary

    assert all(set(item.model_dump()) == set(ReportSummary.model_fields) for item in page.items)


# --- HTTP: list + exports over the real routes ---------------------------------------


@pytest.fixture
async def head_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    from backend.src.core.database import async_session as _async_session  # noqa: F401
    from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine
    from backend.src.modules.identity.session import SessionTransport
    from backend.tests.identity.test_sessions import MemoryRedis, TestClock

    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="reports")
    territory = Territory(name="Республика отчётов")
    db_session.add(territory)
    await db_session.flush()
    own = Laboratory(territory_id=territory.id, name="Своя лаборатория отчётов", address="А", organization="ГБУ")
    foreign = Laboratory(territory_id=territory.id, name="Чужая лаборатория", address="Б", organization="ГБУ")
    head = User(
        login="rephead",
        full_name="Заведующий",
        email="rephead@example.test",
        password_hash="x" * 60,
        role=UserRole.HEAD,
        active=True,
    )
    db_session.add_all([own, foreign, head])
    await db_session.flush()
    from backend.src.modules.identity.models import UserScope

    db_session.add(UserScope(user_id=head.id, laboratory_id=own.id, product_scope_id=uuid.uuid4()))
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=transport,
        authorizer=Authorizer(InMemoryDecisionEngine()),
        own=own,
        foreign=foreign,
        vet=head,
    )


async def test_list_and_export_api(db_session: AsyncSession, head_env: SimpleNamespace) -> None:
    from backend.src.modules.identity.models import User, UserRole
    from backend.tests.arrivals.test_api import _client_for

    lab_id, actor_id = await seed_lab(db_session, head_env.own, head_env.vet)
    view = await save_period(db_session, lab_id, actor_id, 2026, 1)

    async with _client_for(head_env) as (http, _identity):
        listed = await http.get("/api/v1/reports/5vet", params={"laboratory_id": str(lab_id)})
        assert listed.status_code == 200, listed.text
        assert listed.json()["total"] == 1
        assert "payload" not in listed.json()["items"][0]

        pdf_response = await http.get(f"/api/v1/reports/5vet/{view.id}/export.pdf")
        assert pdf_response.status_code == 200, pdf_response.text
        assert pdf_response.headers["cache-control"] == "no-store"
        assert pdf_response.headers["content-type"].startswith("application/pdf")
        assert "attachment" in pdf_response.headers.get("content-disposition", "")
        assert "filename*=UTF-8''" in pdf_response.headers.get("content-disposition", "")
        assert PdfReader(io.BytesIO(pdf_response.content)).pages

        xlsx_response = await http.get(f"/api/v1/reports/5vet/{view.id}/export.xlsx")
        assert xlsx_response.status_code == 200
        assert xlsx_response.headers["content-type"].endswith("spreadsheetml.sheet")
        assert load_workbook(io.BytesIO(xlsx_response.content)) is not None

        unknown = await http.get("/api/v1/reports/5vet/00000000-0000-4000-8000-000000000000/export.pdf")
        assert unknown.status_code == 404

    admin = User(
        login="repadmin",
        full_name="Администратор",
        email="repadmin@example.test",
        password_hash="x" * 60,
        role=UserRole.ADMIN,
        active=True,
    )
    db_session.add(admin)
    await db_session.commit()
    admin_env = SimpleNamespace(**{**head_env.__dict__, "vet": admin})
    async with _client_for(admin_env) as (http, _identity):
        forbidden = await http.get(f"/api/v1/reports/5vet/{view.id}/export.pdf")
        assert forbidden.status_code in (403, 404)
        denied_list = await http.get("/api/v1/reports/5vet", params={"laboratory_id": str(lab_id)})
        assert denied_list.status_code in (403, 404)


async def test_foreign_export_is_hidden(db_session: AsyncSession, head_env: SimpleNamespace) -> None:
    from backend.src.modules.identity.models import User, UserRole, UserScope
    from backend.tests.arrivals.test_api import _client_for

    lab_id, actor_id = await seed_lab(db_session)
    view = await save_period(db_session, lab_id, actor_id, 2026, 1)
    vet = User(
        login="rephead2",
        full_name="Заведующий второй",
        email="rephead2@example.test",
        password_hash="x" * 60,
        role=UserRole.HEAD,
        active=True,
    )
    db_session.add(vet)
    await db_session.flush()
    db_session.add(UserScope(user_id=vet.id, laboratory_id=head_env.foreign.id, product_scope_id=uuid.uuid4()))
    await db_session.commit()
    other_env = SimpleNamespace(**{**head_env.__dict__, "vet": vet})
    async with _client_for(other_env) as (http, _identity):
        hidden = await http.get(f"/api/v1/reports/5vet/{view.id}/export.pdf")
        assert hidden.status_code in (403, 404)


@pytest.mark.asyncio
async def test_deleted_snapshot_export_is_404(db_session: AsyncSession, head_env: SimpleNamespace) -> None:
    from backend.src.modules.reporting.commands import delete_report, load_report
    from backend.tests.arrivals.test_api import _client_for

    lab_id, actor_id = await seed_lab(db_session, head_env.own, head_env.vet)
    view = await save_period(db_session, lab_id, actor_id, 2026, 1)
    await delete_report(
        CommandContext(actor_id=actor_id, idempotency_key="del-1", expected_revision=1), view.id, db=db_session
    )
    await db_session.commit()
    with pytest.raises(ProblemError) as removed:
        await load_report(db_session, view.id)
    assert removed.value.code == "NOT_FOUND"
    async with _client_for(head_env) as (http, _identity):
        missing = await http.get(f"/api/v1/reports/5vet/{view.id}/export.xlsx")
        assert missing.status_code == 404
