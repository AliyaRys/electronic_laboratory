"""XLSX renderer (D02): one API-08 report projection → one spreadsheet.

``render_xlsx`` consumes :class:`ReportDocumentView` — built exclusively from
the stored snapshot, never from live ВСЭ queries — and its verified
:class:`FormManifest`. The output rules (INPUT-04 + SPEC-05):

- header codes (ОКУД «001», …) are written as **text cells** — a leading zero
  is never coerced into a number;
- numeric matrix values stay numeric and follow the manifest tonna precision
  (6 decimals until the official precision is defined);
- a text value starting with ``=`` (or any other formula-looking string) is
  stored as an inline string, never as a formula cell;
- cells that the system does not compute automatically print
  «Не рассчитывается» instead of an invented number;
- the file name of API-08 is ``5-вет_раздел-III_<лаборатория>_<год>_<полугодие>``
  cleaned of path/control characters.
"""

from __future__ import annotations

import io
import re
from decimal import Decimal
from typing import Any

from backend.src.modules.documents.resources import FormManifest
from backend.src.modules.documents.schemas import ReportDocumentView

__all__ = ["NOT_CALCULATED", "render_xlsx", "xlsx_filename"]

NOT_CALCULATED = "Не рассчитывается"
_MALICIOUS = re.compile(r"^[=+\-@\t\r]")

_CODE_ORDER = ("okud", "okpo", "okved", "oktmo", "okogu", "okopf", "okfs")
_CODE_LABELS = {
    "okud": "ОКУД",
    "okpo": "ОКПО",
    "okved": "ОКВЭД",
    "oktmo": "ОКТМО",
    "okogu": "ОКОГУ",
    "okopf": "ОКОПФ",
    "okfs": "ОКФС",
}


def xlsx_filename(model: ReportDocumentView) -> str:
    """``5-вет_раздел-III_<лаборатория>_<год>_<полугодие>.xlsx``, path-safe."""
    unsafe = f"5-вет_раздел-III_{model.laboratory}_{model.year}_{model.half}-полугодие"
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", unsafe).strip().strip(".")
    return f"{cleaned or '5-вет'}.xlsx"


def _force_text(cell: Any, value: str) -> None:
    """Store the string as text even when Excel-style inference would run it."""
    cell.value = value
    cell.data_type = "s"
    cell.quotePrefix = True


def _put(ws: Any, row: int, column: int, value: Any, precision: int) -> None:
    """Write one cell with the type discipline of SPEC-05 (text vs numeric)."""
    cell = ws.cell(row=row, column=column)
    if value is None:
        cell.value = "—"
        cell.data_type = "s"
    elif isinstance(value, str):
        _force_text(cell, value)  # «=…» and codes are text, never a formula
    else:
        cell.value = float(Decimal(str(value)).quantize(Decimal(1).scaleb(-precision)))
        cell.data_type = "n"


def render_xlsx(model: ReportDocumentView, form: FormManifest) -> bytes:
    """Render the snapshot projection of one saved report to a spreadsheet."""
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # a fresh workbook always has its active sheet
    sheet.title = "Раздел III"

    sheet.cell(row=1, column=1).value = "Форма 5-вет, раздел III"
    title = f"{model.laboratory} — {model.period}"
    if not model.official:
        title += " — Предварительная форма"
    sheet.cell(row=1, column=2).value = title

    code_cells: dict[str, tuple[int, int]] = {}
    column = 1
    for code in _CODE_ORDER:
        label = sheet.cell(row=2, column=column)
        label.value = _CODE_LABELS[code]
        label.data_type = "s"
        code_cell = sheet.cell(row=2, column=column + 1)
        _force_text(code_cell, getattr(model.codes, code))
        code_cells[code] = (2, column + 1)
        column += 2

    header_row = 4
    for index, name in enumerate(["Наименование показателя", "Код", *model.columns]):
        cell = sheet.cell(row=header_row, column=index + 1)
        cell.value = name
        cell.data_type = "s"

    for offset, row in enumerate(model.matrix, start=1):
        row_index = header_row + offset
        _force_text(sheet.cell(row=row_index, column=1), row.name)
        _force_text(sheet.cell(row=row_index, column=2), row.code)
        for index, column_name in enumerate(model.columns):
            value = row.values.get(column_name) if row.automatic else NOT_CALCULATED
            _put(sheet, row_index, 3 + index, value, model.ton_precision)

    destination = io.BytesIO()
    workbook.save(destination)
    return destination.getvalue()
