"""R03 projection: one saved snapshot payload → one printable ReportDocumentView.

The projection is built **exclusively** from the stored snapshot (API-08:
«готовый файл исключительно из snapshot»): no live ВСЭ query ever contributes,
so an export re-renders exactly the snapshot that was signed, never a silent
recomputation. The two decisions that belong to the projection:

- the printed form merges the two bird data columns (CHICKEN + OTHER_BIRDS,
  DATA-04) into one printed «Птица — куры/другие» column per the ФТ 09 table;
  the data layer keeps 8 columns (R01 note 1);
- the two rows the system never computes (INPUT-04 manifest
  ``noncalculated_cells``) are printed as non-calculated rows — «Не
  рассчитывается», never an invented number.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from backend.src.modules.documents.schemas import ReportCodes, ReportDocumentView, ReportMatrixRow
from backend.src.modules.reporting.schemas import ROW_CODES, ROW_NAMES, ReportSnapshotView

__all__ = ["report_document_view", "report_pdf_filename", "report_xlsx_filename"]

#: Printed labels of the 8 data columns; the two bird columns share one row.
COLUMN_NAMES: dict[str, str] = {
    "CATTLE": "КРС",
    "PIG": "Свиньи",
    "SHEEP_GOAT": "Овцы и козы",
    "RABBIT_NUTRIA": "Кролики и нутрии",
    "CHICKEN": "Птица — куры",
    "OTHER_BIRDS": "Птица — другие",
    "FISH": "Рыба",
    "OTHER_ANIMALS": "Прочие",
}

#: The single printed bird column that merges CHICKEN and OTHER_BIRDS.
BIRD_COLUMN = "Птица — куры/другие"
BIRD_KEYS = frozenset({"CHICKEN", "OTHER_BIRDS"})

#: The two rows that are never calculated by the system (INPUT-04 manifest
#: ``noncalculated_cells`` of form ``report-5vet``): printed «Не рассчитывается».
MANUAL_ROWS: tuple[tuple[str, str], ...] = (
    ("sickness_of_animals", "Заболеваемость животных"),
    ("inspections_of_meat", "Осмотры мяса"),
)

PERIOD_NAMES: dict[int, str] = {1: "январь—июнь", 2: "июль—декабрь"}

_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _decimal(value: object) -> Decimal | None:
    """The exact payload Decimal string; never a guess."""
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation, ValueError:
        return None


def _filename_stem(view: ReportSnapshotView) -> str:
    """``5-вет_раздел-III_<лаборатория>_<год>_<полугодие>``, path-safe (API-08)."""
    payload = view.payload
    laboratory = payload.get("laboratory")
    name = laboratory.get("name", "") if isinstance(laboratory, dict) else ""
    unsafe = f"5-вет_раздел-III_{name}_{view.year}_{view.half}-полугодие"
    cleaned = _UNSAFE.sub("", unsafe).strip().strip(".")
    return cleaned or "5-вет"


def report_pdf_filename(view: ReportSnapshotView) -> str:
    """The Content-Disposition-safe PDF name of API-08."""
    return f"{_filename_stem(view)}.pdf"


def report_xlsx_filename(view: ReportSnapshotView) -> str:
    """The spreadsheet name of API-08 (same stem as the PDF)."""
    return f"{_filename_stem(view)}.xlsx"


def report_document_view(view: ReportSnapshotView) -> ReportDocumentView:
    """Build the printable projection strictly from the saved payload."""
    payload = view.payload
    laboratory = payload.get("laboratory")
    laboratory_name = (laboratory.get("name", "") if isinstance(laboratory, dict) else "") or str(view.laboratory_id)

    # Printed columns: the bird pair is merged once, at CHICKEN's position.
    raw = payload.get("columns")
    raw_columns = [str(column) for column in raw] if isinstance(raw, list) else []
    printed: list[str] = []
    offsets: list[list[int]] = []  # per printed column: the payload column indices it sums
    for index, column in enumerate(raw_columns):
        if column == "OTHER_BIRDS":
            continue
        if column == "CHICKEN":
            other = raw_columns.index("OTHER_BIRDS") if "OTHER_BIRDS" in raw_columns else None
            printed.append(BIRD_COLUMN)
            offsets.append([index] if other is None else [index, other])
        else:
            printed.append(COLUMN_NAMES.get(column, column))
            offsets.append([index])

    raw_rows_value = payload.get("matrix")
    raw_rows = raw_rows_value if isinstance(raw_rows_value, list) else []
    matrix: list[ReportMatrixRow] = []
    for row_index, row_code in enumerate(ROW_CODES):
        raw_row = raw_rows[row_index] if row_index < len(raw_rows) else []
        values: dict[str, str | float | None] = {}
        for column, indices in zip(printed, offsets, strict=True):
            total = sum((_decimal(raw_row[i]) or Decimal(0) for i in indices if i < len(raw_row)), Decimal(0))
            values[column] = float(total) if any(i < len(raw_row) for i in indices) else None
        matrix.append(
            ReportMatrixRow(code=row_code, name=ROW_NAMES.get(row_code, row_code), automatic=True, values=values)
        )
    for code, name in MANUAL_ROWS:
        matrix.append(
            ReportMatrixRow(
                code=code,
                name=name,
                automatic=False,
                values=dict.fromkeys(printed, None),
            )
        )

    codes = dict(view.codes)
    return ReportDocumentView(
        form_id="report-5vet",
        laboratory=laboratory_name,
        year=view.year,
        half=view.half,
        period=f"{PERIOD_NAMES.get(view.half, '—')} {view.year}",
        codes=ReportCodes(
            okud=codes.get("okud", ""),
            okpo=codes.get("okpo", ""),
            okved=codes.get("okved", ""),
            oktmo=codes.get("oktmo", ""),
            okogu=codes.get("okogu", ""),
            okopf=codes.get("okopf", ""),
            okfs=codes.get("okfs", ""),
        ),
        columns=printed,
        matrix=matrix,
        versions={"версия классификации": str(payload.get("classification_version", "—"))},
        official=bool(payload.get("official", False)),
        warnings=["Предварительная форма"] if not bool(payload.get("official", False)) else [],
    )
