"""R01 tests: the exact 5-vet contribution calculator (ФТ 09, FT-RPT-04).

Named controller assertions:

- one VSE → 166=1; bacterioscopy+microscopy → 167=2; trichinelloscopy → 168=1;
  pH+peroxidase+copper → 169=3; dosimetry (two readings = one procedure) →
  170=1; cooking+luminescent+temperature → 171=3; sent after completion →
  172=1; organoleptic/identification/disease lists never add to 167–172;
- destroy 250 kg MEAT → 240=0.25 / 241=0.25 / 242=0; the DISPOSAL direction
  and sample disposal never add to 240; AT-16: 250 kg meat + 50 kg offal →
  240=0.3, 241=0.25, 242=0.05, and 240=241+242 for supported composition;
- WAITING cards and previous-only parties are excluded; fair and internal
  parties are included;
- an ambiguous/unsupported/missing classification mapping fails the whole
  calculation (fail-loud, never a partial matrix) — AT-22;
- half-year boundaries [01.01; 01.07) and [01.07; 01.01) in Europe/Moscow
  (AT-17); a corrected card is counted once, its first completion never moves;
- mass aggregates as exact Decimal kg until the final tonnes display
  conversion (no float, no per-party rounding).

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from zoneinfo import ZoneInfo

from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing.schemas import ANIMAL_COLUMNS
from backend.src.modules.reporting.calculator import (
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
    build_classification_map,
    calculate_5vet,
    period_bounds,
    sources_for_period,
)
from backend.src.modules.reporting.schemas import ReportSource, SpeciesClassification

MOSCOW = ZoneInfo("Europe/Moscow")
IN_HALF1 = datetime(2026, 2, 1, 12, 0, 0, tzinfo=MOSCOW)
MEAT_SPECIES = "sp-meat"
OFFAL_SPECIES = "sp-offal"
UNMAPPED_SPECIES = "sp-unknown"


def species_classification(species: str, column: str, kind: str, supported: bool = True) -> SpeciesClassification:
    return SpeciesClassification(
        mercury_species_id=species,
        animal_column=column,
        material_kind=kind,
        supported=supported,  # type: ignore[arg-type]
    )


def default_map() -> Any:
    return build_classification_map(
        "map-v1",
        [
            species_classification(MEAT_SPECIES, "CATTLE", "MEAT"),
            species_classification(OFFAL_SPECIES, "CATTLE", "OFFAL"),
        ],
    )


def source(
    performed: tuple[UUID, ...] = (),
    *,
    species: str = MEAT_SPECIES,
    mass_kg: str = "0",
    direction: str | None = None,
    sent_to_lab: bool = False,
    first_completed_at: datetime | None = IN_HALF1,
    id_: str = "11111111-1111-1111-1111-111111111111",
    revision: int = 1,
    outcome: str | None = None,
    fair: bool = False,
    internal: bool = False,
) -> Any:
    return ReportSource(
        id=UUID(id_),
        revision=revision,
        first_completed_at=first_completed_at,
        classification=species,
        accepted_mass_kg=Decimal(mass_kg),
        performed_indicator_ids=frozenset(performed),
        sent_to_lab=sent_to_lab,
        outcome=outcome,  # type: ignore[arg-type]
        direction=direction,  # type: ignore[arg-type]
        fair=fair,
        internal=internal,
    )


def cell(matrix: Any, code: str, column: str) -> Decimal:
    return matrix.rows[code][column]


def calculate(sources: list[Any], mapping: Any | None = None) -> Any:
    return calculate_5vet(sources, default_map() if mapping is None else mapping)


# --- named assertions ---------------------------------------------------------------


def test_one_vse_adds_exactly_one_to_row_166() -> None:
    matrix = calculate([source()])
    assert cell(matrix, "166", "CATTLE") == Decimal(1)
    for row in ("167", "168", "169", "170", "171", "172", "240", "241", "242"):
        assert cell(matrix, row, "CATTLE") == Decimal(0)


@pytest.mark.parametrize(
    ("performed", "row", "expected"),
    [
        pytest.param((BACTERIOSCOPY_INDICATOR_ID, MICROSCOPY_INDICATOR_ID), "167", 2, id="bact+micro-167=2"),
        pytest.param((BACTERIOSCOPY_INDICATOR_ID,), "167", 1, id="bact-only-167=1"),
        pytest.param((TRICHINELLA_INDICATOR_ID,), "168", 1, id="trich-168=1"),
        pytest.param((PH_INDICATOR_ID, PEROXIDASE_INDICATOR_ID, COPPER_INDICATOR_ID), "169", 3, id="ph+perox+cu-169=3"),
        pytest.param((PH_INDICATOR_ID, PEROXIDASE_INDICATOR_ID), "169", 2, id="ph+perox-169=2"),
        pytest.param((DOSIMETRY_INDICATOR_ID,), "170", 1, id="dosimetry-two-values-is-one-170=1"),
        pytest.param(
            (COOKING_INDICATOR_ID, LUMINESCENT_INDICATOR_ID, TEMPERATURE_INDICATOR_ID),
            "171",
            3,
            id="cooking+lum+temp-171=3",
        ),
        pytest.param((COOKING_INDICATOR_ID,), "171", 1, id="cooking-only-171=1"),
    ],
)
def test_row_contributions_by_performed_indicators(performed: tuple[UUID, ...], row: str, expected: int) -> None:
    matrix = calculate([source(performed=performed)])
    assert cell(matrix, row, "CATTLE") == Decimal(expected)


@pytest.mark.parametrize(
    ("performed",),
    [
        pytest.param((ORGANOLEPTIC_INDICATOR_ID,), id="organoleptic"),
        pytest.param((IDENTIFICATION_INDICATOR_ID,), id="identification"),
        pytest.param((ORGANOLEPTIC_INDICATOR_ID, IDENTIFICATION_INDICATOR_ID), id="both-mandatory"),
    ],
)
def test_non_counting_indicators_never_add(performed: tuple[UUID, ...]) -> None:
    matrix = calculate([source(performed=performed)])
    for row in ("167", "168", "169", "170", "171", "172"):
        assert cell(matrix, row, "CATTLE") == Decimal(0)


def test_disease_findings_never_duplicate_trichinelloscopy() -> None:
    # The trichinella finding lives in the invasive list (no indicator id), the
    # performed procedure is one indicator id: the row counts the procedure.
    matrix = calculate([source(performed=(TRICHINELLA_INDICATOR_ID,))])
    assert cell(matrix, "168", "CATTLE") == Decimal(1)


def test_sent_after_completion_adds_row_172() -> None:
    sent = calculate([source(sent_to_lab=True)]).rows["172"]["CATTLE"]
    not_sent = calculate([source()]).rows["172"]["CATTLE"]
    assert sent == Decimal(1)
    assert not_sent == Decimal(0)


def test_ft_rpt_04_reference_combination() -> None:
    # Acceptance of FT-RPT-04: bacterioscopy, microscopy, pH, peroxidase and
    # temperature → 166:1, 167:2, 169:2, 171:1.
    matrix = calculate(
        [
            source(
                performed=(
                    BACTERIOSCOPY_INDICATOR_ID,
                    MICROSCOPY_INDICATOR_ID,
                    PH_INDICATOR_ID,
                    PEROXIDASE_INDICATOR_ID,
                    TEMPERATURE_INDICATOR_ID,
                )
            )
        ]
    )
    assert cell(matrix, "166", "CATTLE") == Decimal(1)
    assert cell(matrix, "167", "CATTLE") == Decimal(2)
    assert cell(matrix, "169", "CATTLE") == Decimal(2)
    assert cell(matrix, "171", "CATTLE") == Decimal(1)


def test_destroy_250kg_meat_split() -> None:
    matrix = calculate([source(mass_kg="250", direction="DESTRUCTION", outcome="UNFIT")])
    assert cell(matrix, "240", "CATTLE") == Decimal("0.25")
    assert cell(matrix, "241", "CATTLE") == Decimal("0.25")
    assert cell(matrix, "242", "CATTLE") == Decimal(0)


def test_disposal_direction_and_sample_disposal_never_add_240() -> None:
    # «На утилизацию» is not «На уничтожение»; a sample disposal is a separate
    # sample-ledger fact and is never part of a ReportSource.
    disposal = calculate([source(mass_kg="250", direction="DISPOSAL", outcome="UNFIT")])
    for row in ("240", "241", "242"):
        assert cell(disposal, row, "CATTLE") == Decimal(0)
    fit_sale = calculate([source(mass_kg="250", direction="SALE", outcome="FIT")])
    for row in ("240", "241", "242"):
        assert cell(fit_sale, row, "CATTLE") == Decimal(0)


def test_at_16_meat_and_offal_destruction() -> None:
    matrix = calculate(
        [
            source(mass_kg="250", direction="DESTRUCTION", outcome="UNFIT"),
            source(
                mass_kg="50",
                direction="DESTRUCTION",
                outcome="UNFIT",
                species=OFFAL_SPECIES,
                id_="22222222-2222-2222-2222-222222222222",
            ),
        ]
    )
    assert cell(matrix, "240", "CATTLE") == Decimal("0.3")
    assert cell(matrix, "241", "CATTLE") == Decimal("0.25")
    assert cell(matrix, "242", "CATTLE") == Decimal("0.05")
    assert cell(matrix, "240", "CATTLE") == cell(matrix, "241", "CATTLE") + cell(matrix, "242", "CATTLE")


def test_mass_aggregates_exact_decimal_before_tonnes() -> None:
    matrix = calculate(
        [
            source(mass_kg="100.5", direction="DESTRUCTION", outcome="UNFIT"),
            source(
                mass_kg="100.25",
                direction="DESTRUCTION",
                outcome="UNFIT",
                id_="22222222-2222-2222-2222-222222222222",
            ),
        ]
    )
    assert cell(matrix, "240", "CATTLE") == Decimal("0.20075")


def test_waiting_card_is_excluded() -> None:
    waiting = source(sent_to_lab=True, first_completed_at=None)
    matrix = calculate([waiting])
    for row in ("166", "167", "168", "169", "170", "171", "172", "240", "241", "242"):
        assert cell(matrix, row, "CATTLE") == Decimal(0)


def test_fair_and_internal_parties_are_included() -> None:
    matrix = calculate([source(fair=True), source(internal=True, id_="22222222-2222-2222-2222-222222222222")])
    assert cell(matrix, "166", "CATTLE") == Decimal(2)


def test_corrected_card_is_counted_once() -> None:
    # A correction of a completed card keeps its first completion time and is
    # one source of the period: the newest revision is counted exactly once.
    base = source(revision=1)
    corrected = source(revision=2, performed=(BACTERIOSCOPY_INDICATOR_ID,), first_completed_at=IN_HALF1)
    matrix = calculate([base, corrected])
    assert cell(matrix, "166", "CATTLE") == Decimal(1)
    assert cell(matrix, "167", "CATTLE") == Decimal(1)


def test_columns_are_exactly_the_catalog_animal_columns() -> None:
    matrix = calculate([])
    assert tuple(matrix.columns) == ANIMAL_COLUMNS


# --- fail-loud mapping (AT-22) --------------------------------------------------------


def test_unknown_species_fails_whole_calculation() -> None:
    with pytest.raises(ProblemError) as error:
        calculate([source(), source(species=UNMAPPED_SPECIES, id_="22222222-2222-2222-2222-222222222222")])
    assert error.value.code == "REPORT_MAPPING_INVALID"


def test_unsupported_species_fails_whole_calculation() -> None:
    mapping = build_classification_map(
        "map-v1",
        [
            species_classification(MEAT_SPECIES, "CATTLE", "MEAT"),
            species_classification(OFFAL_SPECIES, "CATTLE", "OFFAL", supported=False),
        ],
    )
    with pytest.raises(ProblemError) as error:
        calculate([source(species=OFFAL_SPECIES)], mapping)
    assert error.value.code == "REPORT_MAPPING_INVALID"


def test_ambiguous_mapping_fails_before_any_matrix() -> None:
    # The same Mercury species mapped to two different animal columns is an
    # ambiguous configuration: the map is rejected as a whole, so the caller
    # can never receive a partially filled matrix.
    entries = [
        species_classification(MEAT_SPECIES, "CATTLE", "MEAT"),
        species_classification(MEAT_SPECIES, "PIG", "MEAT"),
    ]
    with pytest.raises(ProblemError) as error:
        build_classification_map("map-ambiguous", entries)
    assert error.value.code == "REPORT_MAPPING_INVALID"


def test_duplicate_material_kind_is_ambiguous_too() -> None:
    entries = [
        species_classification(MEAT_SPECIES, "CATTLE", "MEAT"),
        species_classification(MEAT_SPECIES, "CATTLE", "OFFAL"),
    ]
    with pytest.raises(ProblemError) as error:
        build_classification_map("map-ambiguous", entries)
    assert error.value.code == "REPORT_MAPPING_INVALID"


# --- half-year boundaries (AT-17) -----------------------------------------------------


def test_half_year_bounds_are_half_open_moscow() -> None:
    start1, end1 = period_bounds(2026, 1)
    start2, end2 = period_bounds(2026, 2)
    assert (start1.isoformat(), end1.isoformat()) == ("2026-01-01T00:00:00+03:00", "2026-07-01T00:00:00+03:00")
    assert (start2.isoformat(), end2.isoformat()) == ("2026-07-01T00:00:00+03:00", "2027-01-01T00:00:00+03:00")
    with pytest.raises(ValueError):
        period_bounds(2026, 3)


@pytest.mark.parametrize(
    ("moment", "year", "half", "included"),
    [
        pytest.param(datetime(2025, 12, 31, 23, 59, 59, tzinfo=MOSCOW), 2026, 1, False, id="before-half1"),
        pytest.param(datetime(2026, 1, 1, 0, 0, 0, tzinfo=MOSCOW), 2026, 1, True, id="half1-start-inclusive"),
        pytest.param(datetime(2026, 6, 30, 23, 59, 59, tzinfo=MOSCOW), 2026, 1, True, id="half1-last-second"),
        pytest.param(datetime(2026, 7, 1, 0, 0, 0, tzinfo=MOSCOW), 2026, 1, False, id="at-17-exact-july-not-half1"),
        pytest.param(datetime(2026, 7, 1, 0, 0, 0, tzinfo=MOSCOW), 2026, 2, True, id="at-17-exact-july-in-half2"),
        pytest.param(datetime(2026, 12, 31, 23, 59, 59, tzinfo=MOSCOW), 2026, 2, True, id="half2-last-second"),
        pytest.param(datetime(2027, 1, 1, 0, 0, 0, tzinfo=MOSCOW), 2026, 2, False, id="after-half2"),
    ],
)
def test_period_selection_boundaries(moment: datetime, year: int, half: int, included: bool) -> None:
    selected = sources_for_period([source(first_completed_at=moment)], year, half)
    assert bool(selected) is included


def test_naive_first_completed_at_is_treated_as_utc_instant() -> None:
    naive = datetime(2026, 2, 1, 12, 0, 0)
    selected = sources_for_period([source(first_completed_at=naive)], 2026, 1)
    assert len(selected) == 1
