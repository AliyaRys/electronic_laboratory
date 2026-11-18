"""DR51 §2: the exact canonical catalogue of the printed form.

The 47 rows (order, code, name, mode) and the 8 animal columns are an exact
contract with the owner sample (`отчет 5 вет раздел 3.xlsx`, лист «отчет»,
A3:J55); the blank/zero semantics (§2.3) make ``null`` and ``0``
distinguishable in the payload, in the calculator and in the legacy adapter.
"""

from __future__ import annotations

import pytest

from backend.src.modules.documents.schemas import ReportMatrixRow
from backend.src.modules.reporting.projection import COLUMN_NAMES, report_document_view
from backend.src.modules.reporting.schemas import (
    AUTOMATIC_ROW_CODES,
    COUNT_ROWS,
    MASS_ROWS,
    ROW_NAMES,
    SECTION_III_ROW_CODES,
    SECTION_III_ROWS,
)
from backend.src.modules.reporting.snapshots import adapt_payload

EXACT_ROWS: tuple[tuple[str, str, str], ...] = (
    ("166", "1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц", "AUTO"),
    ("167", "в том числе: микроскопических", "AUTO"),
    ("168", "трихинеллоскопий", "AUTO"),
    ("169", "физико-химических", "AUTO"),
    ("170", "радиометрических", "AUTO"),
    ("171", "других лабораторных исследований", "AUTO"),
    ("172", "2. Проведено специальных лабораторных исследований всего, единиц", "AUTO"),
    ("173", "3. Выявлено случаев болезни при ВСЭ, единиц", "BLANK"),
    ("174", "Ящур", "BLANK"),
    ("175", "Сибирская язва", "BLANK"),
    ("176", "Туберкулез", "BLANK"),
    ("177", "Бруцеллез", "BLANK"),
    ("178", "Лейкоз", "BLANK"),
    ("179", "Сап", "BLANK"),
    ("189", "Оспа", "BLANK"),
    ("190", "Болезнь Ауески", "BLANK"),
    ("191", "Классическая чума свиней", "BLANK"),
    ("192", "Болезнь Марека", "BLANK"),
    ("193", "Цистицеркоз (финноз)", "BLANK"),
    ("195", "Трихинеллез", "BLANK"),
    ("200", "Миксоматоз", "BLANK"),
    ("205", "Аэромоноз карповых и лососевых (краснуха)", "BLANK"),
    ("206", "Весенняя виремия карпов", "BLANK"),
    ("207", "Псевдомоноз", "BLANK"),
    ("208", "Другие инфекционные болезни", "BLANK"),
    ("209", "Другие инвазионные болезни", "BLANK"),
    ("210", "Незаразные болезни", "AUTO"),
    ("211", "4. Направлено на обезвреживание мяса, тонн", "BLANK"),
    ("212", "из них по туберкулезу", "BLANK"),
    ("213", "лейкозу", "BLANK"),
    ("214", "болезни Марека", "BLANK"),
    ("215", "цистицеркозу (финнозу)", "BLANK"),
    ("216", "сальмонеллезу", "BLANK"),
    ("221", "5. Направлено на обезвреживание субпродуктов, тонн", "BLANK"),
    ("222", "из них по: туберкулезу", "BLANK"),
    ("223", "лейкозу", "BLANK"),
    ("224", "болезни Марека", "BLANK"),
    ("225", "цистицеркозу (финнозу)", "BLANK"),
    ("226", "сальмонеллезу", "BLANK"),
    ("231", "6. Направлено на утилизацию мяса, тонн", "BLANK"),
    ("232", "из них по: туберкулезу", "BLANK"),
    ("233", "лейкозу", "BLANK"),
    ("234", "болезни Марека", "BLANK"),
    ("235", "цистицеркозу (финнозу)", "BLANK"),
    ("240", "7. Направлено на уничтожение, тонн", "AUTO"),
    ("241", "из них: мяса", "AUTO"),
    ("242", "субпродуктов", "AUTO"),
)

EXACT_COLUMNS = ("CATTLE", "PIG", "SHEEP_GOAT", "RABBIT_NUTRIA", "CHICKEN", "OTHER_BIRDS", "FISH", "OTHER_ANIMALS")


def test_the_full_catalogue_is_exact() -> None:
    rows = tuple((row.code, row.name, row.mode) for row in SECTION_III_ROWS)
    assert rows == EXACT_ROWS
    assert len(rows) == 47
    assert len(set(SECTION_III_ROW_CODES)) == 47


def test_the_automatic_rows_are_exactly_the_owner_set() -> None:
    assert AUTOMATIC_ROW_CODES == ("166", "167", "168", "169", "170", "171", "172", "210", "240", "241", "242")
    assert frozenset({"166", "167", "168", "169", "170", "171", "172", "210"}) == COUNT_ROWS
    assert frozenset({"240", "241", "242"}) == MASS_ROWS
    assert set(ROW_NAMES) == set(SECTION_III_ROW_CODES)


def test_the_columns_stay_eight_with_separate_birds() -> None:
    assert tuple(COLUMN_NAMES) == EXACT_COLUMNS
    assert "CHICKEN" in COLUMN_NAMES and "OTHER_BIRDS" in COLUMN_NAMES
    assert len(set(COLUMN_NAMES.values())) == 8


def _view(payload: dict[str, object], **kwargs: object) -> object:
    from types import SimpleNamespace

    return SimpleNamespace(payload=payload, **kwargs)


def test_adapt_payload_passes_a_full_form_through_and_validates_it() -> None:
    rows = [{"code": code, "name": name, "mode": mode} for code, name, mode in EXACT_ROWS]
    matrix = [["1"] * 8 if EXACT_ROWS[i][2] == "AUTO" else [None] * 8 for i in range(47)]
    payload: dict[str, object] = {
        "columns": list(EXACT_COLUMNS),
        "rows": rows,
        "row_codes": [row[0] for row in EXACT_ROWS],
        "matrix": matrix,
        "form_version": "2",
    }
    assert adapt_payload(payload) is payload


def test_adapt_payload_rejects_a_value_in_a_blank_row() -> None:
    rows = [{"code": code, "name": name, "mode": mode} for code, name, mode in EXACT_ROWS]
    matrix = [["1"] * 8 if EXACT_ROWS[i][2] == "AUTO" else [None] * 8 for i in range(47)]
    matrix[7] = ["0"] * 8  # row 173 is BLANK
    payload: dict[str, object] = {
        "columns": list(EXACT_COLUMNS),
        "rows": rows,
        "row_codes": [row[0] for row in EXACT_ROWS],
        "matrix": matrix,
        "form_version": "2",
    }
    with pytest.raises(Exception, match="повреждён"):
        adapt_payload(payload)


def test_legacy_compact_payload_opens_in_the_full_form_without_recalculation() -> None:
    legacy: dict[str, object] = {
        "columns": list(EXACT_COLUMNS),
        "row_codes": ["166", "167", "168", "169", "170", "171", "172", "240", "241", "242"],
        "matrix": [
            ["1", None, None, None, None, None, None, None],
            ["2", None, None, None, None, None, None, None],
            ["0", None, None, None, None, None, None, None],
            ["0", None, None, None, None, None, None, None],
            ["0", None, None, None, None, None, None, None],
            ["0", None, None, None, None, None, None, None],
            ["0", None, None, None, None, None, None, None],
            ["0.25", None, None, None, None, None, None, None],
            ["0.25", None, None, None, None, None, None, None],
            ["0", None, None, None, None, None, None, None],
        ],
    }
    adapted = adapt_payload(legacy)
    assert adapted["form_version"] == "2"
    matrix = adapted["matrix"]
    assert len(matrix) == 47
    codes = adapted["row_codes"]
    assert codes[:3] == ["166", "167", "168"]
    index = {code: position for position, code in enumerate(codes)}
    # The saved numbers stay exactly where they were saved…
    assert matrix[index["166"]][0] == "1" and matrix[index["240"]][0] == "0.25"
    # …row 210 of a legacy report stays empty (never recalculated)…
    assert matrix[index["210"]][0] is None
    # …and every BLANK row stays null.
    assert all(value is None for value in matrix[index["174"]])
    # The birds are kept separate exactly as saved: nothing merged, nothing
    # fabricated.
    assert adapted["columns"] == list(EXACT_COLUMNS)


def test_projection_prints_blanks_empty_and_zeroes_visible() -> None:
    rows = [{"code": code, "name": name, "mode": mode} for code, name, mode in EXACT_ROWS]
    matrix: list[list[object]] = []
    for code, _name, mode in EXACT_ROWS:
        if mode == "AUTO":
            matrix.append(["0.25" if code == "240" else "0"] + [None] * 7)
        else:
            matrix.append([None] * 8)
    payload: dict[str, object] = {
        "columns": list(EXACT_COLUMNS),
        "rows": rows,
        "row_codes": [row[0] for row in EXACT_ROWS],
        "matrix": matrix,
        "official": False,
        "laboratory": {"name": "Лаборатория"},
    }
    view = _view(payload, date_from=__import__("datetime").date(2026, 11, 1), date_to=__import__("datetime").date(2026, 11, 18), saved_at=__import__("datetime").datetime(2026, 11, 18, 15, 51))  # type: ignore[arg-type]
    model = report_document_view(view)  # type: ignore[arg-type]
    assert len(model.matrix) == 47
    row240 = model.matrix[44]
    assert isinstance(row240, ReportMatrixRow) and row240.code == "240"
    assert row240.values["Крупный рогатый скот, яки, буйволы"] == 0.25  # a calculated value stays visible
    assert row240.values["Свиньи"] is None
    row210 = model.matrix[26]
    assert isinstance(row210, ReportMatrixRow) and row210.values["Крупный рогатый скот, яки, буйволы"] == 0.0
    row174 = model.matrix[8]
    assert isinstance(row174, ReportMatrixRow) and row174.automatic is False
    assert all(value is None for value in row174.values.values())
