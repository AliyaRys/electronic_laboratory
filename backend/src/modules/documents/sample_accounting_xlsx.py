"""XLSX «Учёт проб» (DR49 §9): one projection → exactly two formatted sheets.

Sheet 1 «Остатки проб», sheet 2 «История утилизаций». The type discipline of
SPEC-05: masses stay numeric ``Decimal``-based cells (never strings, never
binary float drift beyond the quantized display), disposal dates are real
Excel dates, every text value is a forced text cell and any value starting
with ``=``, ``+``, ``-``, ``@``, tab or CR gets a quotePrefix so it can never
become a formula.
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from decimal import Decimal
from typing import Any

from zoneinfo import ZoneInfo

from backend.src.modules.samples.export_schemas import SampleAccountingDocumentView
from backend.src.modules.samples.export_service import export_filename

__all__ = ["MOSCOW_TZ", "render_sample_accounting_xlsx", "sample_accounting_xlsx_filename"]

MOSCOW_TZ = ZoneInfo("Europe/Moscow")

_MALICIOUS = re.compile(r"^[=+\-@\t\r]")
_MASS_FORMAT = "0.######"
_DATE_FORMAT = "DD.MM.YYYY"

_TITLE_FILL = "146C73"
_HEADER_FILL = "EAF6F4"
_LINE_COLOR = "DFE9E9"


def sample_accounting_xlsx_filename(view: SampleAccountingDocumentView) -> str:
    return export_filename("xlsx", view.laboratory_name, view.date_from, view.date_to)


def _force_text(cell: Any, value: str) -> None:  # noqa: ANN401 - openpyxl cell
    cell.value = value
    cell.data_type = "s"
    cell.quotePrefix = _MALICIOUS.match(value) is not None


def _mass(cell: Any, value: Decimal) -> None:  # noqa: ANN401 - openpyxl cell
    cell.value = float(value.quantize(Decimal("0.000001")))
    cell.data_type = "n"
    cell.number_format = _MASS_FORMAT


def _moscow_stamp(moment: datetime) -> str:
    local = moment.astimezone(MOSCOW_TZ)
    return f"{local.strftime('%d.%m.%Y %H:%M')} (МСК)"


def _sheet_header(
    ws: Any,  # noqa: ANN401 - openpyxl worksheet
    columns: list[str],
    widths: list[int],
    view: SampleAccountingDocumentView,
    sub4: str,
    landscape: bool,
) -> None:
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(columns))
    title = ws.cell(row=1, column=1)
    title.value = "Учёт проб"
    title.font = Font(bold=True, size=15, color="FFFFFF")
    title.fill = PatternFill("solid", fgColor=_TITLE_FILL)
    title.alignment = Alignment(vertical="center")

    for row, text in (
        (2, f"Лаборатория: {view.laboratory_name}"),
        (3, f"Сформировано: {_moscow_stamp(view.generated_at)}"),
        (4, sub4),
    ):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=len(columns))
        _force_text(ws.cell(row=row, column=1), text)

    thin = Side(style="thin", color=_LINE_COLOR)
    fill = PatternFill("solid", fgColor=_HEADER_FILL)
    for index, name in enumerate(columns, start=1):
        cell = ws.cell(row=6, column=index)
        _force_text(cell, name)
        cell.font = Font(bold=True)
        cell.fill = fill
        cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=6, column=index).column_letter].width = width

    ws.freeze_panes = "A7"
    ws.auto_filter.ref = f"A6:{ws.cell(row=6, column=len(columns)).column_letter}6"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:6"
    ws.page_margins.left = 0.5
    ws.page_margins.right = 0.5
    ws.page_margins.top = 0.6
    ws.page_margins.bottom = 0.6


def _balances_sheet(ws: Any, view: SampleAccountingDocumentView) -> None:  # noqa: ANN401
    _sheet_header(
        ws,
        ["Вид продукции", "Остаток, кг"],
        [46, 16],
        view,
        "Состояние остатков на момент формирования",
        False,
    )
    if not view.balances:
        ws.merge_cells("A7:B7")
        _force_text(ws.cell(row=7, column=1), "Положительных остатков нет.")
        return
    thin_row = 7
    for row in view.balances:
        _force_text(ws.cell(row=thin_row, column=1), row.product_name)
        _mass(ws.cell(row=thin_row, column=2), row.mass_kg)
        thin_row += 1


def _history_sheet(ws: Any, view: SampleAccountingDocumentView) -> None:  # noqa: ANN401
    _sheet_header(
        ws,
        ["Дата утилизации", "Вид продукции", "Вес, кг", "Номер исходящей эВСД", "Провёл"],
        [16, 38, 14, 42, 32],
        view,
        f"Период истории: {view.period_label()}",
        True,
    )
    if not view.disposals:
        ws.merge_cells("A7:E7")
        _force_text(ws.cell(row=7, column=1), view.empty_history_text())
        return
    row_index = 7
    for row in view.disposals:
        date_cell = ws.cell(row=row_index, column=1)
        date_cell.value = row.disposed_on
        date_cell.number_format = _DATE_FORMAT
        date_cell.data_type = "d"
        _force_text(ws.cell(row=row_index, column=2), row.product_name)
        _mass(ws.cell(row=row_index, column=3), row.mass_kg)
        _force_text(ws.cell(row=row_index, column=4), row.external_vsd_number)
        _force_text(ws.cell(row=row_index, column=5), row.actor_name)
        row_index += 1


def render_sample_accounting_xlsx(view: SampleAccountingDocumentView) -> bytes:
    """Render the two-sheet workbook; any engine failure is an honest 503."""
    from openpyxl import Workbook

    from backend.src.modules.documents.resources import RendererUnavailable

    try:
        workbook = Workbook()
        balances = workbook.active
        assert balances is not None
        balances.title = "Остатки проб"
        _balances_sheet(balances, view)
        history = workbook.create_sheet("История утилизаций")
        _history_sheet(history, view)
        destination = io.BytesIO()
        workbook.save(destination)
        return destination.getvalue()
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001 - the engine failure is a 503 by contract
        raise RendererUnavailable(f"Движок формирования XLSX недоступен: {error}.") from error
