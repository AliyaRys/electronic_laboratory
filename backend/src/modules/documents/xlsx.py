"""XLSX renderer (D02, DR51 §9): one API-08 report projection → one spreadsheet.

``render_xlsx`` consumes :class:`ReportDocumentView` — built exclusively from
the stored snapshot, never from live ВСЭ queries — and its verified
:class:`FormManifest`. The DR51 output rules:

- one sheet «Раздел III»; no formal half-year heading sheet and no seven
  organizational codes (owner decision 2026-11-18);
- the browser thead repeats in Excel: group header row (the «Птица» merge),
  bird subheader row, then the printed column numbers 1–10;
- AUTO values are numeric cells (a calculated ``0`` is stored as the number
  ``0``, never skipped by a truthiness check); BLANK cells stay genuinely
  empty (no «—», no empty string, no ``data_type='n'``);
- freeze panes below the header and right of the first two columns;
- print setup: landscape, fit to width, repeated header rows, centered;
- the laboratory name stays injection-protected: a text starting with
  ``=``, ``+``, ``-``, ``@`` or a tab is stored as an inline string.
"""

from __future__ import annotations

import io
import re
from decimal import Decimal
from typing import Any

from backend.src.modules.documents.resources import FormManifest
from backend.src.modules.documents.schemas import ReportDocumentView

__all__ = ["render_xlsx", "xlsx_filename"]

_MALICIOUS = re.compile(r"^[=+\-@\t\r]")


def xlsx_filename(model: ReportDocumentView) -> str:
    """``5-вет_раздел-III_<лаборатория>_<период>.xlsx``, path-safe."""
    unsafe = f"5-вет_раздел-III_{model.laboratory}_{model.period}"
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", unsafe).strip().strip(".")
    return f"{cleaned or '5-вет'}.xlsx"


def _safe_text(cell: Any, value: str) -> None:
    """Store the string as text; a formula-looking value is never a formula."""
    cell.value = value
    if _MALICIOUS.match(value):
        cell.data_type = "s"
        cell.quotePrefix = True


def _number(cell: Any, value: str, precision: int) -> None:
    try:
        number = float(Decimal(value).quantize(Decimal(1).scaleb(-precision)))
    except ArithmeticError:
        # A non-numeric string (e.g. injected text) is stored as text, never
        # as a formula (SPEC-05).
        _safe_text(cell, value)
        return
    cell.value = number
    cell.data_type = "n"


_GROUP_HEADERS = (
    ("Наименование показателей", 1, 1),
    ("№ строки", 2, 2),
    ("Крупный рогатый скот, яки, буйволы", 3, 3),
    ("Свиньи", 4, 4),
    ("Овцы, козы", 5, 5),
    ("Кролики, нутрии", 6, 6),
    ("Птица", 7, 8),
    ("Рыба", 9, 9),
    ("Другие виды животных", 10, 10),
)

_SUB_HEADERS = {7: "куры", 8: "другие виды"}

_COLUMN_WIDTHS = {
    1: 52,
    2: 9,
    3: 13,
    4: 10,
    5: 10,
    6: 12,
    7: 9,
    8: 13,
    9: 9,
    10: 13,
}


def render_xlsx(model: ReportDocumentView, _form: FormManifest) -> bytes:
    """Render the snapshot projection of one saved report to a spreadsheet."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # a fresh workbook always has its active sheet
    sheet.title = "Раздел III"

    # Simplified header block (DR51 §9): title, creation date, period, lab.
    sheet.cell(row=1, column=1, value=model.title)
    sheet.cell(row=1, column=1).font = Font(size=13, bold=True)
    _safe_text(sheet.cell(row=2, column=1), f"{model.created_label}: {model.created_at}")
    _safe_text(sheet.cell(row=3, column=1), f"Период: {model.period}")
    _safe_text(sheet.cell(row=4, column=1), f"Лаборатория: {model.laboratory}")
    if not model.official:
        _safe_text(sheet.cell(row=5, column=1), "Предварительная форма")

    # The three thead rows mirror the browser table exactly (DR51 §2.1).
    group_row = 7
    sub_row = 8
    number_row = 9
    for name, start, end in _GROUP_HEADERS:
        cell = sheet.cell(row=group_row, column=start, value=name)
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        cell.font = Font(bold=True)
        if end > start:
            sheet.merge_cells(start_row=group_row, start_column=start, end_row=group_row, end_column=end)
    for column, name in _SUB_HEADERS.items():
        cell = sheet.cell(row=sub_row, column=column, value=name)
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        cell.font = Font(bold=True)
    for column in range(1, 11):
        cell = sheet.cell(row=number_row, column=column, value=column)
        cell.alignment = Alignment(horizontal="center")
        cell.font = Font(bold=True)
    for column, width in _COLUMN_WIDTHS.items():
        sheet.column_dimensions[get_column_letter(column)].width = width

    first_data_row = number_row + 1
    for offset, row in enumerate(model.matrix):
        row_index = first_data_row + offset
        _safe_text(sheet.cell(row=row_index, column=1), row.name)
        _safe_text(sheet.cell(row=row_index, column=2), row.code)
        for index, column in enumerate(model.columns):
            value = row.values.get(column)
            cell = sheet.cell(row=row_index, column=3 + index)
            if row.automatic and value is not None:
                _number(cell, str(value), model.ton_precision)  # a calculated 0 stays 0
            # else: the BLANK cell stays genuinely empty.
        if row.code in {"166", "172", "210", "240"}:
            for column in range(1, 11):
                header_cell = sheet.cell(row=row_index, column=column)
                if header_cell.font is None or not header_cell.font.bold:
                    header_cell.font = Font(bold=True)

    sheet.freeze_panes = f"C{first_data_row}"
    sheet.print_title_rows = f"{group_row}:{number_row}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.print_options.horizontalCentered = True

    destination = io.BytesIO()
    workbook.save(destination)
    return destination.getvalue()
