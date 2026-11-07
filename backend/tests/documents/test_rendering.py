"""D02: the controlled renderer and the user-facing document output.

Named assertions (task D02):

- PDF: nonempty, A4, Cyrillic text, the accepted mass present; long owner/
  product names and repeated page headers render without clipping;
- a rejected renderer (unavailable template/engine) is a 503 Problem without
  a file;
- XLSX: the code «001» is a text cell (never coerced), numbers are numeric,
  a text starting with ``=`` is NOT a formula (SPEC-05 injection protection),
  non-automatic cells print «Не рассчитывается», tonna keeps 6 decimals;
- HTTP: the PDF route answers no-store and the same no-store/re-check
  contract as the preview; a broken renderer is 503 Problem without a file;
- the controlled resource resolver forbids external URLs and arbitrary file
  paths; filenames are safe (no path/control characters).
"""

from __future__ import annotations

import io
import re
import uuid
import zipfile
from types import SimpleNamespace

import pytest
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.documents import resources
from backend.src.modules.documents.pdf import render_pdf
from backend.src.modules.documents.resources import (
    FONTS_DIR,
    FORMS_DIR,
    FontEntry,
    RendererUnavailable,
    font_file,
    load_manifest,
    resolve_within,
)
from backend.src.modules.documents.schemas import ConclusionView, ReportDocumentView, ReportMatrixRow
from backend.src.modules.documents.xlsx import render_xlsx, xlsx_filename
from backend.tests.documents.test_conclusion_basis import (  # noqa: F401  (fixtures; api_env/env re-exposed below)
    api_env,
    completed_exam,
    configure,
    enrich_document,
    env,
)
from backend.tests.examinations.test_create import BEEF, party_with_confirmation


@pytest.fixture
def conclusion_api_env(request) -> SimpleNamespace:
    """The D01 HTTP machinery (``api_env``), re-exposed under the tests' name."""
    return request.getfixturevalue("api_env")


LONG_NAME = (
    "Общество с ограниченной ответственностью «Агропромышленное объединение "
    "переработки мясной продукции и сопутствующих товарных позиций чрезвычайно "
    "длинного наименования владельца»"
)
LONG_PRODUCT = (
    "Говядина первая категория охлаждённая в полутушах крайне длинное "
    "наименование продукции для переноса на следующую строку таблицы"
)

VIEW = ConclusionView(
    basis_kind="LOCAL",
    basis_id=str(uuid.uuid4()),
    fields={
        "organization": "ГБУ «Ветлаб»",
        "laboratory": "Лаборатория №1",
        "date": "2026-11-07",
        "basis": "Местная ВСЭ № Д-1 от 2026-11-05",
        "evsd": "ЭВСД-120",
        "owner": "ИП Владелец",
        "product": "Говядина охлаждённая",
        "mass": "100",
        "count": "4",
        "unit": "руб/кг",
        "stamp": "Клеймо-1",
        "signature": "",
    },
    form_id="conclusion-local",
    form_version="1",
    official=False,
    warnings=["Предварительная форма"],
)

REPORT = ReportDocumentView(
    form_id="report-5vet",
    laboratory="Лаборатория №1",
    year=2026,
    half=2,
    period="июль—декабрь 2026",
    codes={
        "okud": "001",
        "okpo": "12345678",
        "okved": "01.46",
        "oktmo": "92701001",
        "okogu": "-",
        "okopf": "75404",
        "okfs": "42",
    },
    columns=["Всего", "КРС", "Свиньи"],
    matrix=[
        ReportMatrixRow(
            code="001", name="Поступило животных", automatic=True, values={"Всего": 12.0, "КРС": 8.0, "Свиньи": 4.0}
        ),
        ReportMatrixRow(
            code="010", name="Падёж животных", automatic=False, values={"Всего": None, "КРС": None, "Свиньи": None}
        ),
    ],
    versions={"mapping": "2026-11-07/1", "payload": "1"},
    official=False,
    warnings=["Предварительная форма"],
)


def _pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)


def _squeezed(text: str) -> str:
    return re.sub(r"\s+", "", text)


# --- PDF -----------------------------------------------------------------------------


def test_pdf_nonempty_a4_cyrillic_accepted_mass() -> None:
    form = load_manifest("conclusion-local")
    data = render_pdf(VIEW, form)

    assert isinstance(data, bytes) and len(data) > 1000
    assert data[:5] == b"%PDF-"
    reader = PdfReader(io.BytesIO(data))
    box = reader.pages[0].mediabox
    assert abs(float(box.width) - 595.0) < 2.0  # A4 portrait, not Letter
    assert abs(float(box.height) - 842.0) < 2.0
    text = _pdf_text(data)
    assert "ВЕТЕРИНАРНОЕ ЗАКЛЮЧЕНИЕ" in text  # Cyrillic really renders
    assert "Говядина охлаждённая" in text
    assert "100" in text  # the accepted mass of the frozen composition
    assert "Предварительная форма" in text  # official=false label


def test_pdf_escapes_text_and_never_serves_markup() -> None:
    form = load_manifest("conclusion-local")
    hostile = VIEW.model_copy(
        update={"fields": {**VIEW.fields, "owner": "<script>alert(1)</script>", "product": "Лук & перец <кг>"}}
    )
    text = _pdf_text(render_pdf(hostile, form))
    # The literal hostile text renders inert (escaped), markup is never executed.
    assert "alert(1)" in text
    assert "Лук & перец <кг>" in text


def test_pdf_long_names_and_repeated_headers_without_clipping() -> None:
    form = load_manifest("conclusion-local")
    long_view = VIEW.model_copy(update={"fields": {**VIEW.fields, "owner": LONG_NAME, "product": LONG_PRODUCT}})
    text = _pdf_text(render_pdf(long_view, form))
    # Nothing is truncated to an ellipsis; the full long requisites are present.
    assert _squeezed(LONG_NAME) in _squeezed(text)
    assert _squeezed(LONG_PRODUCT) in _squeezed(text)

    report_form = load_manifest("report-5vet")
    rows = [
        ReportMatrixRow(code=f"{index:03d}", name=f"Показатель №{index}", automatic=True, values={"Всего": 1.0})
        for index in range(1, 121)
    ]
    data = render_pdf(REPORT.model_copy(update={"matrix": rows}), report_form)
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) >= 2
    second = reader.pages[1].extract_text() or ""
    assert "Наименование показателя" in second  # the matrix header repeats per page


def test_pdf_of_previous_basis_uses_its_template() -> None:
    previous = VIEW.model_copy(update={"form_id": "conclusion-previous"})
    form = load_manifest("conclusion-previous")
    assert "убойного пункта" in _pdf_text(render_pdf(previous, form)).lower()


# --- rejected renderer ----------------------------------------------------------------


def test_unknown_form_is_503_problem_without_file() -> None:
    from backend.src.core.problems import ProblemError

    with pytest.raises(ProblemError) as raised:
        load_manifest("unknown-form")
    assert raised.value.status == 503
    assert raised.value.code == "RENDERER_UNAVAILABLE"


def test_missing_template_file_is_503() -> None:
    manifest = load_manifest("conclusion-local")
    missing = manifest.model_copy(update={"template": "missing-template.html"})
    with pytest.raises(RendererUnavailable):
        resources.read_template(missing)


def test_tampered_template_hash_is_503() -> None:
    manifest = load_manifest("conclusion-local")
    tampered = manifest.model_copy(update={"template_sha256": "0" * 64})
    with pytest.raises(RendererUnavailable):
        resources.read_template(tampered)


def test_tampered_font_hash_is_503() -> None:
    manifest = load_manifest("conclusion-local")
    font = font_file(manifest)
    assert font.is_file() and font.parent == FONTS_DIR.resolve()
    wrong_font = manifest.model_copy(
        update={"fonts": [FontEntry(**{**manifest.fonts[0].model_dump(), "sha256": "1" * 64})]}
    )
    with pytest.raises(RendererUnavailable):
        font_file(wrong_font)


# --- controlled resources ------------------------------------------------------------


def test_resource_resolver_forbids_external_urls_and_file_paths() -> None:
    for hostile in (
        "https://evil.example/template.html",
        "http://evil/x.html",
        "file:///C:/boot.ini",
        "C:/Windows/win.ini",
        "..\\..\\win.ini",
        "../fonts/DejaVuSans.ttf",
        "/etc/passwd",
        "manifest.json:extra",
    ):
        with pytest.raises(RendererUnavailable):
            resolve_within(FORMS_DIR, hostile)


def test_resource_resolver_allows_only_registered_dirs() -> None:
    assert resolve_within(FONTS_DIR, "DejaVuSans.ttf").is_file()


# --- XLSX ----------------------------------------------------------------------------


def _load_sheet(data: bytes):
    from openpyxl import load_workbook

    return load_workbook(io.BytesIO(data)).active


def test_xlsx_code_001_is_text_not_coerced() -> None:
    sheet = _load_sheet(render_xlsx(REPORT, load_manifest("report-5vet")))
    okud = sheet.cell(row=2, column=2)
    assert okud.value == "001"
    assert okud.data_type == "s"  # the code keeps its leading zero as text


def test_xlsx_numbers_are_numeric_with_ton_precision() -> None:
    model = REPORT.model_copy(
        update={"matrix": [ReportMatrixRow(code="001", name="Масса, т", automatic=True, values={"Всего": 1.234567891})]}
    )
    cell = _load_sheet(render_xlsx(model, load_manifest("report-5vet"))).cell(row=5, column=3)
    assert cell.data_type == "n"
    assert cell.value == pytest.approx(1.234568)  # 6 decimals until official precision


def test_xlsx_formula_text_is_not_a_formula() -> None:
    model = REPORT.model_copy(
        update={
            "matrix": [
                ReportMatrixRow(code="001", name="=cmd|' /C calc'!A0", automatic=True, values={"Всего": "=1+1"}),
            ]
        }
    )
    data = render_xlsx(model, load_manifest("report-5vet"))
    sheet = _load_sheet(data)
    for cell in (sheet.cell(row=5, column=1), sheet.cell(row=5, column=3)):
        assert cell.data_type == "s"
        assert cell.value.startswith("=")
    zf = zipfile.ZipFile(io.BytesIO(data))
    xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
    assert "<f>" not in xml  # never a formula element
    assert "inlineStr" in xml


def test_xlsx_noncalculated_cells_show_not_calculated() -> None:
    sheet = _load_sheet(render_xlsx(REPORT, load_manifest("report-5vet")))
    assert REPORT.matrix[1].automatic is False
    values = [sheet.cell(row=6, column=column).value for column in range(3, 6)]
    assert values == ["Не рассчитывается"] * 3


def test_xlsx_filename_is_safe_for_content_disposition() -> None:
    name = xlsx_filename(REPORT.model_copy(update={"laboratory": "ГБУ «Вет»/1:*?"}))
    assert "/" not in name and "\\" not in name and ":" not in name
    assert name.startswith("5-вет")
    assert all(ch >= " " for ch in name)


def test_xlsx_scales_to_200_rows() -> None:
    rows = [
        ReportMatrixRow(code=f"{index:03d}", name=f"Показатель №{index}", automatic=True, values={"Всего": 1.0})
        for index in range(1, 201)
    ]
    sheet = _load_sheet(render_xlsx(REPORT.model_copy(update={"matrix": rows}), load_manifest("report-5vet")))
    assert sheet.cell(row=204, column=1).value == "Показатель №200"


# --- HTTP: the same no-store contract, honest 503, re-checked access ------------------


async def test_pdf_api_no_store_and_admin_forbidden(
    db_session: AsyncSession, conclusion_api_env: SimpleNamespace
) -> None:
    from backend.src.modules.identity.models import User, UserRole
    from backend.tests.arrivals.test_api import _client_for

    await configure(conclusion_api_env.db, conclusion_api_env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(conclusion_api_env.db, conclusion_api_env.lab.id, BEEF)
    await enrich_document(conclusion_api_env.db, party)
    await completed_exam(conclusion_api_env.db, conclusion_api_env, party.id, "PDF-1")

    async with _client_for(conclusion_api_env) as (http, _identity):
        response = await http.get(f"/api/v1/arrivals/{party.id}/conclusion.pdf")
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["content-type"].startswith("application/pdf")
        assert "attachment" in response.headers.get("content-disposition", "")
        assert len(response.content) > 1000

        unknown = await http.get("/api/v1/arrivals/00000000-0000-4000-8000-000000000000/conclusion.pdf")
        assert unknown.status_code == 404

    admin = User(
        login="d02-admin",
        full_name="Администратор",
        email="d02-admin@example.test",
        password_hash="x" * 60,
        role=UserRole.ADMIN,
        active=True,
    )
    conclusion_api_env.db.add(admin)
    await conclusion_api_env.db.commit()
    admin_env = SimpleNamespace(**{**conclusion_api_env.__dict__, "vet": admin})
    async with _client_for(admin_env) as (http, _identity):
        denied = await http.get(f"/api/v1/arrivals/{party.id}/conclusion.pdf")
        assert denied.status_code in (403, 404)


async def test_pdf_api_503_when_renderer_unavailable(
    db_session: AsyncSession, conclusion_api_env: SimpleNamespace, monkeypatch
) -> None:
    from backend.tests.arrivals.test_api import _client_for

    await configure(conclusion_api_env.db, conclusion_api_env.lab.id, BEEF, trich=False)
    party = await party_with_confirmation(conclusion_api_env.db, conclusion_api_env.lab.id, BEEF)
    await enrich_document(conclusion_api_env.db, party)
    await completed_exam(conclusion_api_env.db, conclusion_api_env, party.id, "PDF-2")

    def broken(form_id: str) -> None:
        raise RendererUnavailable("Шаблон формы недоступен.")

    monkeypatch.setattr(resources, "load_manifest", broken)
    async with _client_for(conclusion_api_env) as (http, _identity):
        response = await http.get(f"/api/v1/arrivals/{party.id}/conclusion.pdf")
        assert response.status_code == 503
        assert response.headers["content-type"].startswith("application/problem+json")
        assert response.json()["code"] == "RENDERER_UNAVAILABLE"
        assert b"%PDF" not in response.content  # a Problem, never a file


async def test_pdf_api_422_incomplete_basis_is_problem_json(
    db_session: AsyncSession, conclusion_api_env: SimpleNamespace
) -> None:
    from backend.tests.arrivals.test_api import _client_for
    from backend.tests.documents.test_conclusion_basis import previous_party, previous_record

    await configure(conclusion_api_env.db, conclusion_api_env.lab.id, BEEF, trich=False)
    party, _ = await previous_party(
        conclusion_api_env.db, conclusion_api_env.lab.id, BEEF, record=previous_record(), previous_sufficient=False
    )

    async with _client_for(conclusion_api_env) as (http, _identity):
        response = await http.get(f"/api/v1/arrivals/{party.id}/conclusion.pdf")
        assert response.status_code == 422
        assert response.headers["content-type"].startswith("application/problem+json")
        assert response.json()["code"] == "DOCUMENT_BASIS_INCOMPLETE"
