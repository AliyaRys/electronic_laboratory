"""The pure 5-вет contribution calculator (DATA-06, ФТ 09, FT-RPT-04).

No IO, no ORM, no clock: the whole function tree is ``Decimal`` arithmetic
over ``ReportSource`` facts. Selection rules the calculator owns itself:

- a WAITING card (``first_completed_at is None``) is never counted (ФТ 09:
  несохранённые формы, ожидание и прежние внешние ВСЭ не входят);
- a fair or internal party is counted (ФТ 09: ярмарочные и внутренние входят);
- the same card id is counted once — the newest revision (an edit of a
  completed card never shifts or duplicates its first completion, R-04);
- an unknown, unsupported or ambiguous classification fails the whole
  calculation with ``REPORT_MAPPING_INVALID`` — never a partial matrix
  (FT-RPT-04, AT-22).

Row semantics (ФТ 09): 166 +1 per selected ВСЭ; 167 +1 per performed
bacterioscopy and separately +1 per microscopy; 168 +1 trichinelloscopy (a
trichinella finding is not a second procedure); 169 +1 per pH, peroxidase,
copper; 170 +1 per dosimetry regardless of its two readings; 171 +1 per
cooking probe, luminescent analysis, muscle temperature; 172 +1 when the
samples were sent and the card is completed; 240 accepted mass / 1000 of the
«На уничтожение» direction only; 241/242 the meat/offal parts of 240.
Organoleptic, identification and the disease lists never add to 167–172;
sample disposal is a sample-ledger fact and never reaches a source.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from operator import attrgetter
from uuid import UUID

from backend.src.core.problems import ProblemError, ProblemItem
from backend.src.modules.catalog_pricing.mandatory import (
    BACTERIOSCOPY_INDICATOR_ID,
    COOKING_INDICATOR_ID,
    COPPER_INDICATOR_ID,
    DOSIMETRY_INDICATOR_ID,
    IDENTIFICATION_INDICATOR_ID,
    LUMINESCENT_INDICATOR_ID,
    MICROSCOPY_INDICATOR_ID,
    ORGANOLEPTIC_INDICATOR_ID,
    PEROXIDASE_INDICATOR_ID,
    PH_INDICATOR_ID,
    TEMPERATURE_INDICATOR_ID,
    TRICHINELLA_INDICATOR_ID,
)
from backend.src.modules.reporting.schemas import (
    COLUMNS,
    COUNT_ROWS,
    MASS_ROWS,
    ROW_CODES,
    ROW_NAMES,
    ClassificationMap,
    ReportMatrix,
    ReportSource,
    SpeciesClassification,
)

__all__ = [
    "BACTERIOSCOPY_INDICATOR_ID",
    "COOKING_INDICATOR_ID",
    "COPPER_INDICATOR_ID",
    "DOSIMETRY_INDICATOR_ID",
    "IDENTIFICATION_INDICATOR_ID",
    "LUMINESCENT_INDICATOR_ID",
    "MICROSCOPY_INDICATOR_ID",
    "ORGANOLEPTIC_INDICATOR_ID",
    "PEROXIDASE_INDICATOR_ID",
    "PH_INDICATOR_ID",
    "TEMPERATURE_INDICATOR_ID",
    "TRICHINELLA_INDICATOR_ID",
    "PERFORMED_ROW_IDS",
    "NON_COUNTING_INDICATOR_IDS",
    "MAPPING_INVALID_CODE",
    "build_classification_map",
    "calculate_5vet",
    "range_bounds",
    "sources_for_period",
]

# Stable FT field ids of the two non-counting researches (VSE-F18/F19); they
# are exported for the tests' documentation value and never keyed to a row.
NON_COUNTING_INDICATOR_IDS: frozenset[UUID] = frozenset({ORGANOLEPTIC_INDICATOR_ID, IDENTIFICATION_INDICATOR_ID})

#: Row → the FT indicators whose performed fact adds one unit to the row.
PERFORMED_ROW_IDS: dict[str, frozenset[UUID]] = {
    "167": frozenset({BACTERIOSCOPY_INDICATOR_ID, MICROSCOPY_INDICATOR_ID}),
    "168": frozenset({TRICHINELLA_INDICATOR_ID}),
    "169": frozenset({PH_INDICATOR_ID, PEROXIDASE_INDICATOR_ID, COPPER_INDICATOR_ID}),
    "170": frozenset({DOSIMETRY_INDICATOR_ID}),  # one procedure, not two readings
    "171": frozenset({COOKING_INDICATOR_ID, LUMINESCENT_INDICATOR_ID, TEMPERATURE_INDICATOR_ID}),
}

MAPPING_INVALID_CODE = "REPORT_MAPPING_INVALID"

TONNES_PER_KG = Decimal("1000")


def _mapping_invalid(message: str, path: str, field_id: str | None = None) -> ProblemError:
    return ProblemError(
        status=422,
        code=MAPPING_INVALID_CODE,
        title="Report mapping invalid",
        detail=message,
        errors=[ProblemItem(path=path, field_id=field_id, message=message)],
    )


def build_classification_map(version: str, items: Sequence[SpeciesClassification]) -> ClassificationMap:
    """Freeze a classification version, rejecting ambiguity loud (INPUT-05).

    Two entries for the same Mercury species — even the same column with a
    different material kind — is an ambiguous configuration: the whole map is
    rejected, so no report can ever be built on name guessing.
    """
    frozen: dict[str, SpeciesClassification] = {}
    seen: dict[str, SpeciesClassification] = {}
    for item in items:
        previous = seen.get(item.mercury_species_id)
        if previous is not None and previous != item:
            raise _mapping_invalid(
                "Классификация неоднозначна: вид продукции сопоставлен двум разным строкам.",
                path=f"items.{item.mercury_species_id}",
            )
        seen[item.mercury_species_id] = item
        frozen.setdefault(item.mercury_species_id, item)
    return ClassificationMap(version=version, items=frozen)


def _empty_matrix() -> ReportMatrix:
    return ReportMatrix(
        columns=COLUMNS,
        rows={code: {column: Decimal(0) for column in COLUMNS} for code in ROW_CODES},
        names={code: name for code, name in ROW_NAMES.items() if code in COUNT_ROWS or code in MASS_ROWS},
    )


def _resolved(map_: ClassificationMap, source: ReportSource) -> tuple[SpeciesClassification, str, str]:
    item = map_.items.get(source.classification)
    if item is None:
        raise _mapping_invalid(
            "Классификация не содержит вид продукции партии; исправьте конфигурацию.",
            path=f"sources.{source.id}.classification",
            field_id=source.classification,
        )
    if not item.supported:
        raise _mapping_invalid(
            "Вид продукции не поддержан классификацией отчёта; исправьте конфигурацию.",
            path=f"sources.{source.id}.classification",
            field_id=source.classification,
        )
    # The supported branch guarantees both values (DB check + write DTO); the
    # honest guard never casts None into a valid column (DR49 §2.4).
    if item.animal_column is None or item.material_kind is None:  # pragma: no cover - guarded upstream
        raise _mapping_invalid(
            "Поддерживаемая строка классификации повреждена; исправьте конфигурацию.",
            path=f"sources.{source.id}.classification",
            field_id=source.classification,
        )
    return item, item.animal_column, item.material_kind


def calculate_5vet(sources: Sequence[ReportSource], mapping: ClassificationMap) -> ReportMatrix:
    """The exact 166–172/240–242 contributions of the selected sources.

    Mass sums as exact ``Decimal`` kg and is converted to tonnes once at the
    end, so 240 = 241 + 242 for a supported composition (AT-16).
    """
    matrix = _empty_matrix()
    kg: dict[str, dict[str, Decimal]] = {
        code: {column: Decimal(0) for column in COLUMNS} for code in ("240", "241", "242")
    }

    # One card is one source: the newest revision wins, corrections never
    # duplicate the contribution of a completed card.
    newest: dict[UUID, ReportSource] = {}
    for source in sources:
        current = newest.get(source.id)
        if current is None or source.revision >= current.revision:
            newest[source.id] = source

    selected = sorted(
        (source for source in newest.values() if source.first_completed_at is not None),
        key=attrgetter("id"),
    )
    for source in selected:
        _classification, column, material_kind = _resolved(mapping, source)
        matrix.rows["166"][column] += Decimal(1)
        for row, indicator_ids in PERFORMED_ROW_IDS.items():
            performed = len(source.performed_indicator_ids & indicator_ids)
            matrix.rows[row][column] += Decimal(performed)
        if source.sent_to_lab:
            matrix.rows["172"][column] += Decimal(1)
        # DR51 §3: row 210 «Незаразные болезни» counts every saved finding
        # line of the newest revision as one separate case — no dedup, and an
        # invasive/organoleptic fact never adds here (209/173 stay BLANK).
        matrix.rows["210"][column] += Decimal(source.noncontagious_findings_count)
        if source.direction == "DESTRUCTION":
            kg["240"][column] += source.accepted_mass_kg
            # DR49 §2.2: meat and offal of the same animal share the column
            # but split between rows 241/242 (240 = 241 + 242 is preserved).
            if material_kind == "MEAT":
                kg["241"][column] += source.accepted_mass_kg
            else:
                kg["242"][column] += source.accepted_mass_kg

    for row in ("240", "241", "242"):
        for col in matrix.columns:
            matrix.rows[row][col] = kg[row][col] / TONNES_PER_KG

    _verify_decomposition(matrix)
    return matrix


def _verify_decomposition(matrix: ReportMatrix) -> None:
    """240 = 241 + 242 for every supported composition (fail-loud guard)."""
    for column in matrix.columns:
        total = matrix.rows["240"][column]
        parts = matrix.rows["241"][column] + matrix.rows["242"][column]
        if total != parts:  # pragma: no cover - construction guarantees this
            raise RuntimeError(f"Строки 240–242 разошлись в колонке {column}: {total} != {parts}")


def range_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """The half-open window of a chosen inclusive calendar range in Europe/Moscow.

    ``[date_from 00:00; date_to + 1 день 00:00)``: the ending day itself is
    included, the instant after its last second is not (DR48 §3.1). There is
    no artificial length limit and no requirement of a completed half-year.
    """
    from datetime import timedelta

    from backend.src.core.clock import MOSCOW

    return (
        datetime(date_from.year, date_from.month, date_from.day, 0, 0, 0, tzinfo=MOSCOW),
        datetime(date_to.year, date_to.month, date_to.day, 0, 0, 0, tzinfo=MOSCOW) + timedelta(days=1),
    )


def _as_instant(moment: datetime) -> datetime:
    """A naive value is an UTC instant (PostgreSQL ``timestamptz`` semantics)."""
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def sources_for_period(sources: Sequence[ReportSource], date_from: date, date_to: date) -> list[ReportSource]:
    """The completed sources whose first completion falls in the chosen range."""
    start, end = range_bounds(date_from, date_to)
    return [
        source
        for source in sources
        if source.first_completed_at is not None and start <= _as_instant(source.first_completed_at) < end
    ]
