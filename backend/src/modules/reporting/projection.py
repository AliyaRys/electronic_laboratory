"""R03 projection: one saved snapshot payload → one printable ReportDocumentView.

The projection is built **exclusively** from the stored snapshot (API-08:
«готовый файл исключительно из snapshot»): no live ВСЭ query ever contributes,
so an export re-renders exactly the snapshot that was signed, never a silent
recomputation. DR51 decisions:

- the full printed form keeps CHICKEN and OTHER_BIRDS as two separate
  columns under the «Птица» group (DR51 §2.1) — nothing is merged;
- a BLANK row is printed as an EMPTY cell, never «Не рассчитывается», «—»
  or a forged zero; a calculated zero stays the visible number ``0``;
- the header is the simplified user header: title, creation date, period,
  laboratory — the seven organizational codes and the formal half-year
  heading are cancelled (owner decision 2026-11-18).
"""

from __future__ import annotations

import re
from datetime import datetime

from backend.src.core.clock import MOSCOW
from backend.src.modules.documents.schemas import ReportDocumentView, ReportMatrixRow
from backend.src.modules.reporting.schemas import ReportSnapshotView

__all__ = [
    "period_label",
    "report_document_view",
    "report_pdf_filename",
    "report_xlsx_filename",
]

#: The printed labels of the 8 data columns (DR51 §2.1); CHICKEN and
#: OTHER_BIRDS stay two columns under the «Птица» group header.
COLUMN_NAMES: dict[str, str] = {
    "CATTLE": "Крупный рогатый скот, яки, буйволы",
    "PIG": "Свиньи",
    "SHEEP_GOAT": "Овцы, козы",
    "RABBIT_NUTRIA": "Кролики, нутрии",
    "CHICKEN": "Птица: куры",
    "OTHER_BIRDS": "Птица: другие виды",
    "FISH": "Рыба",
    "OTHER_ANIMALS": "Другие виды животных",
}

_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def period_label(date_from: str, date_to: str) -> str:
    """«ДД.ММ.ГГГГ — ДД.ММ.ГГГГ»; one day prints a single date (DR48 §3.5)."""

    def _ru(value: str) -> str:
        parts = value.split("-")
        return f"{parts[2]}.{parts[1]}.{parts[0]}" if len(parts) == 3 else value

    if date_from == date_to:
        return _ru(date_from)
    return f"{_ru(date_from)} — {_ru(date_to)}"


def _created_label(moment: datetime) -> str:
    """«ДД.ММ.ГГГГ, ЧЧ:ММ» in Europe/Moscow (server time, never the browser)."""
    local = moment.astimezone(MOSCOW)
    return f"{local.day:02d}.{local.month:02d}.{local.year:04d}, {local.hour:02d}:{local.minute:02d}"


def _filename_stem(view: ReportSnapshotView) -> str:
    """``5-вет_раздел-III_<лаборатория>_<date_from>_<date_to>``, path-safe (API-08)."""
    payload = view.payload
    laboratory = payload.get("laboratory")
    name = laboratory.get("name", "") if isinstance(laboratory, dict) else ""
    unsafe = f"5-вет_раздел-III_{name}_{view.date_from.isoformat()}_{view.date_to.isoformat()}"
    cleaned = _UNSAFE.sub("", unsafe).strip().strip(".")
    return cleaned or "5-вет"


def report_pdf_filename(view: ReportSnapshotView) -> str:
    """The Content-Disposition-safe PDF name of API-08."""
    return f"{_filename_stem(view)}.pdf"


def report_xlsx_filename(view: ReportSnapshotView) -> str:
    """The spreadsheet name of API-08 (same stem as the PDF)."""
    return f"{_filename_stem(view)}.xlsx"


def report_document_view(view: ReportSnapshotView) -> ReportDocumentView:
    """Build the printable projection strictly from the saved payload.

    ``view.payload`` is already the read-only full-form adaptation (DR51 §4):
    47 rows with the canonical code/name/mode catalogue and a 47×8 matrix of
    decimal strings (AUTO, always present incl. ``0``) and ``null`` (BLANK).
    """
    payload = view.payload
    laboratory = payload.get("laboratory")
    laboratory_name = (laboratory.get("name", "") if isinstance(laboratory, dict) else "") or str(view.laboratory_id)

    raw_columns = payload.get("columns")
    columns = (
        [COLUMN_NAMES.get(str(column), str(column)) for column in raw_columns] if isinstance(raw_columns, list) else []
    )

    raw_matrix = payload.get("matrix")
    matrix_rows: list[ReportMatrixRow] = []
    rows_catalogue = payload.get("rows")
    if isinstance(rows_catalogue, list):
        for index, row_meta in enumerate(rows_catalogue):
            if not isinstance(row_meta, dict):
                continue
            code = str(row_meta.get("code", ""))
            name = str(row_meta.get("name", code))
            automatic = row_meta.get("mode") == "AUTO"
            raw_values = raw_matrix[index] if index < len(raw_matrix) and isinstance(raw_matrix[index], list) else []
            values: dict[str, str | float | None] = {}
            for column_index, column in enumerate(columns):
                raw = raw_values[column_index] if column_index < len(raw_values) else None
                if not automatic or raw is None:
                    values[column] = None
                else:
                    values[column] = float(str(raw))
            matrix_rows.append(ReportMatrixRow(code=code, name=name, automatic=automatic, values=values))

    return ReportDocumentView(
        form_id="report-5vet",
        title="5-вет, раздел III",
        created_label="Дата создания",
        created_at=_created_label(view.saved_at),
        laboratory=laboratory_name,
        period=period_label(view.date_from.isoformat(), view.date_to.isoformat()),
        columns=columns,
        matrix=matrix_rows,
        official=bool(payload.get("official", False)),
        warnings=["Предварительная форма"] if not bool(payload.get("official", False)) else [],
    )
