"""DR49 §8/§9 rendering tests for the «Учёт проб» PDF and XLSX.

The tests check the exact template contract: A4, the Russian text, the
repeated header, the footer stamp, no GUID leakage, hostile values rendered
as text, and the XLSX two-sheet structure with the typed cells.
"""

from __future__ import annotations

import io
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from openpyxl import load_workbook
from pypdf import PdfReader

from backend.src.modules.documents.resources import load_manifest
from backend.src.modules.documents.sample_accounting_pdf import (
    render_sample_accounting_pdf,
    sample_accounting_pdf_filename,
)
from backend.src.modules.documents.sample_accounting_xlsx import (
    render_sample_accounting_xlsx,
    sample_accounting_xlsx_filename,
)
from backend.src.modules.samples.export_schemas import (
    BalanceRow,
    DisposalRow,
    SampleAccountingDocumentView,
)

GENERATED = datetime(2026, 11, 18, 14, 30, tzinfo=UTC)


def view(balances=None, disposals=None) -> SampleAccountingDocumentView:
    return SampleAccountingDocumentView(
        laboratory_name="ГБУ «Лаборатория №1 г. Казань»",
        generated_at=GENERATED,
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 18),
        balances=balances or [],
        disposals=disposals or [],
    )


def hostile_view() -> SampleAccountingDocumentView:
    long_name = "Очень длинное наименование продукции " * 6
    return view(
        balances=[BalanceRow(product_name='<script>alert("x")</script>', mass_kg=Decimal("12.125"))],
        disposals=[
            DisposalRow(
                disposed_on=date(2026, 11, 3),
                product_name=long_name,
                mass_kg=Decimal("0.8"),
                external_vsd_number="=2+5+9",
                actor_name="& <b>Иванов</b> И.И.",
            ),
            DisposalRow(
                disposed_on=date(2026, 11, 4),
                product_name="Говядина",
                mass_kg=Decimal("12"),
                external_vsd_number="00123",
                actor_name="Петров П.П.",
            ),
        ],
    )


def full_view() -> SampleAccountingDocumentView:
    return view(
        balances=[
            BalanceRow(product_name="Говядина", mass_kg=Decimal("12.6")),
            BalanceRow(product_name="Свинина", mass_kg=Decimal("0.8")),
        ],
        disposals=[
            DisposalRow(
                disposed_on=date(2026, 11, 3),
                product_name="Говядина",
                mass_kg=Decimal("0.8"),
                external_vsd_number="ВСД-001",
                actor_name="Ветеринарный врач",
            )
        ],
    )


# --- PDF -----------------------------------------------------------------------------


@pytest.fixture
def pdf_bytes() -> bytes:
    return render_sample_accounting_pdf(full_view(), load_manifest("sample-accounting"))


def test_pdf_is_a4_and_contains_the_report_text(pdf_bytes: bytes) -> None:
    assert pdf_bytes.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert abs(float(reader.pages[0].mediabox.width) - 595.28) <= 3
    assert abs(float(reader.pages[0].mediabox.height) - 841.89) <= 3
    text = " ".join((page.extract_text() or "") for page in reader.pages)
    assert "Учёт проб" in text
    assert "ГБУ «Лаборатория №1 г. Казань»" in text
    assert "01.11.2026 — 18.11.2026" in text
    assert "Остатки проб" in text
    assert "История утилизаций" in text
    assert "Сформировано: 18.11.2026 17:30 (МСК)" in text
    assert "Страница 1 из 1" in text
    assert "12,6" in text and "0,8" in text


def test_pdf_empty_state_is_honest() -> None:
    empty = render_sample_accounting_pdf(view(), load_manifest("sample-accounting"))
    text = " ".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(empty)).pages)
    assert "Положительных остатков нет." in text
    assert "За выбранный период утилизаций нет." in text


def test_pdf_no_filter_history_message() -> None:
    document = SampleAccountingDocumentView(
        laboratory_name="Лаборатория",
        generated_at=GENERATED,
        date_from=None,
        date_to=None,
        balances=[],
        disposals=[],
    )
    data = render_sample_accounting_pdf(document, load_manifest("sample-accounting"))
    text = " ".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages)
    assert "Утилизаций пока нет." in text
    assert "за всё время" in text


def test_pdf_hostile_values_are_text_only() -> None:
    data = render_sample_accounting_pdf(hostile_view(), load_manifest("sample-accounting"))
    text = " ".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages)
    # The escaped value is displayed as literal text — the markup never
    # becomes a live element in the rendered PDF.
    assert '<script>alert("x")</script>' in text
    assert "=2+5+9" in text  # shown as text, never computed
    # No technical identifiers leak into the file.
    assert "product_species" not in text and "actor_id" not in text


def test_pdf_filename() -> None:
    name = sample_accounting_pdf_filename(full_view())
    assert name == "Учёт_проб_ГБУ «Лаборатория №1 г. Казань»_01.11.2026_18.11.2026.pdf"


# --- XLSX -----------------------------------------------------------------------------


def test_xlsx_two_sheets_structure_and_types() -> None:
    data = render_sample_accounting_xlsx(full_view())
    workbook = load_workbook(io.BytesIO(data))
    assert workbook.sheetnames == ["Остатки проб", "История утилизаций"]

    balances = workbook["Остатки проб"]
    assert balances["A1"].value == "Учёт проб"
    assert balances["A1"].fill.start_color.rgb.endswith("146C73")
    assert balances["A2"].value == "Лаборатория: ГБУ «Лаборатория №1 г. Казань»"
    assert balances["A3"].value == "Сформировано: 18.11.2026 17:30 (МСК)"
    assert balances["A4"].value == "Состояние остатков на момент формирования"
    assert balances["A6"].value == "Вид продукции" and balances["B6"].value == "Остаток, кг"
    assert balances.freeze_panes == "A7"
    assert balances.auto_filter.ref == "A6:B6"
    assert balances["A7"].value == "Говядина"
    assert balances["B7"].value == 12.6 and balances["B7"].data_type == "n"
    assert balances["B7"].number_format == "0.######"
    assert balances.column_dimensions["A"].width == 46

    history = workbook["История утилизаций"]
    assert history["A4"].value.startswith("Период истории:")
    assert history["E6"].value == "Провёл"
    assert history.freeze_panes == "A7"
    assert history["A7"].value == datetime(2026, 11, 3)
    assert history["A7"].number_format == "DD.MM.YYYY"
    assert history["C7"].data_type == "n" and history["C7"].value == 0.8
    assert history["D7"].value == "ВСД-001"
    assert history["D7"].data_type == "s"
    assert history.page_setup.orientation == "landscape"


def test_xlsx_formula_injection_and_leading_zeroes() -> None:
    data = render_sample_accounting_xlsx(hostile_view())
    workbook = load_workbook(io.BytesIO(data))
    history = workbook["История утилизаций"]
    vsd = history["D7"]
    assert vsd.value == "=2+5+9"
    assert vsd.data_type == "s"
    assert vsd.quotePrefix is True
    number = history["D8"]
    assert number.value == "00123"
    assert number.data_type == "s"
    # Hostile product names are text, never formulas.
    assert workbook["Остатки проб"]["A7"].value == '<script>alert("x")</script>'


def test_xlsx_empty_states() -> None:
    data = render_sample_accounting_xlsx(view())
    workbook = load_workbook(io.BytesIO(data))
    balances = workbook["Остатки проб"]
    assert balances["A7"].value == "Положительных остатков нет."
    history = workbook["История утилизаций"]
    assert history["A7"].value == "За выбранный период утилизаций нет."


def test_xlsx_filename() -> None:
    assert sample_accounting_xlsx_filename(full_view()).endswith(".xlsx")
    assert sample_accounting_xlsx_filename(full_view()).startswith("Учёт_проб_")


def test_xlsx_engine_failure_is_renderer_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """DR49 §7.3/§9: a broken engine answers the honest 503, never a 500."""
    from openpyxl import Workbook

    def broken_save(_self: Workbook, _file: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(Workbook, "save", broken_save)
    from backend.src.modules.documents.resources import RendererUnavailable

    with pytest.raises(RendererUnavailable) as error:
        render_sample_accounting_xlsx(full_view())
    assert error.value.status == 503


def test_xlsx_full_history_beyond_20_rows_reopens_with_openpyxl() -> None:
    rows = [
        DisposalRow(
            disposed_on=date(2026, 11, 3 + index % 10),
            product_name=f"Продукция №{index}",
            mass_kg=Decimal("0.5"),
            external_vsd_number=f"ВСД-{index:03d}",
            actor_name=f"Исполнитель №{index}",
        )
        for index in range(25)
    ]
    data = render_sample_accounting_xlsx(view(disposals=rows))
    history = load_workbook(io.BytesIO(data))["История утилизаций"]
    # All 25 rows are present, beyond the 20-row screen page (row 7..31).
    assert history["A31"].value == datetime(2026, 11, 3 + 24 % 10)
    assert history["D31"].value == "ВСД-024"
    assert history["A32"].value is None
