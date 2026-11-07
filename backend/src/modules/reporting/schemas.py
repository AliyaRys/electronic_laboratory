"""Reporting contracts (API-08, DATA-04/05, ФТ 09): the pure calculator DTOs.

Every mass is an exact ``Decimal`` in kilograms; the tonnes conversion for the
official rows 240–242 happens once, after the whole aggregation (FT-RPT-04:
«Вес суммируется до итогового отображаемого округления») — never per source.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from backend.src.modules.catalog_pricing.schemas import ANIMAL_COLUMNS
from backend.src.modules.samples.schemas import BalanceView

__all__ = [
    "AnimalColumn",
    "MaterialKind",
    "SpeciesClassification",
    "ClassificationMap",
    "ReportSource",
    "ReportMatrix",
    "OperationalView",
    "ReportPeriod",
    "ROW_CODES",
    "ROW_NAMES",
    "COUNT_ROWS",
    "MASS_ROWS",
]

AnimalColumn = Literal[
    "CATTLE", "PIG", "SHEEP_GOAT", "RABBIT_NUTRIA", "CHICKEN", "OTHER_BIRDS", "FISH", "OTHER_ANIMALS"
]
MaterialKind = Literal["MEAT", "OFFAL"]

#: The animal columns of the calculator: exactly the classification map
#: columns of INPUT-05/DATA-04. The printed form merges «птица — куры/другие»
#: at projection time (R02/R03); the data layer never invents a column.
COLUMNS: tuple[str, ...] = ANIMAL_COLUMNS

#: The only automatically calculated rows of the official form (INPUT-04):
#: every other printed row is «Не рассчитывается», never guessed.
ROW_CODES: tuple[str, ...] = ("166", "167", "168", "169", "170", "171", "172", "240", "241", "242")
COUNT_ROWS: frozenset[str] = frozenset({"166", "167", "168", "169", "170", "171", "172"})
MASS_ROWS: frozenset[str] = frozenset({"240", "241", "242"})

# Provisional display names of the automatic rows (ФТ 09 table). The official
# form is not approved yet (INPUT-04, official=false); R02/R03 projections may
# relabel without changing the arithmetic.
ROW_NAMES: dict[str, str] = {
    "166": "Проведено ВСЭ",
    "167": "Бактериоскопия и микроскопия",
    "168": "Трихинеллоскопия",
    "169": "pH, пероксидаза, реакция с сернокислой медью",
    "170": "Дозометрическое исследование",
    "171": "Проба варки, люминесцентный анализ, температура",
    "172": "Отправка проб в аккредитованную лабораторию",
    "240": "На уничтожение, тонн",
    "241": "в том числе мясо",
    "242": "в том числе субпродукты",
}


class SpeciesClassification(BaseModel):
    """One mapping entry of the report classification (INPUT-05/DATA-04)."""

    model_config = ConfigDict(extra="forbid")

    mercury_species_id: str
    animal_column: AnimalColumn
    material_kind: MaterialKind
    supported: bool


class ClassificationMap(BaseModel):
    """The frozen classification version a report is calculated with."""

    model_config = ConfigDict(extra="forbid")

    version: str
    items: dict[str, SpeciesClassification]


class ReportSource(BaseModel):
    """One completed local ВСЭ of the period, as the calculator sees it.

    ``classification`` is the Mercury species id (the second-level product
    guid, exactly what the examination validation resolves); the animal column
    and the meat/offal split come only from the classification map. Waiting
    cards carry ``first_completed_at=None`` and are dropped by the calculator.
    ``fair``/``internal`` parties are facts of the source, never exclusions:
    the 5-вет selection includes them (ФТ 09).
    """

    model_config = ConfigDict(extra="forbid")

    id: UUID
    revision: int
    first_completed_at: datetime | None
    classification: str
    accepted_mass_kg: Decimal
    performed_indicator_ids: frozenset[UUID]
    sent_to_lab: bool
    outcome: Literal["FIT", "UNFIT"] | None
    direction: Literal["SALE", "DISPOSAL", "DESTRUCTION"] | None
    fair: bool = False
    internal: bool = False


class ReportMatrix(BaseModel):
    """The automatic 166–172/240–242 contributions per animal column.

    ``rows`` is zero-initialized for every automatic row and column; count
    rows carry whole numbers, mass rows 240–242 carry tonnes as exact
    ``Decimal`` values after the single final kg→t conversion.
    """

    columns: tuple[str, ...]
    rows: dict[str, dict[str, Decimal]]
    names: dict[str, str]


class ReportPeriod(BaseModel):
    """The reporting window as it was requested (API-08 ``period``)."""

    model_config = ConfigDict(extra="forbid")

    date_from: datetime
    date_to: datetime


class OperationalView(BaseModel):
    """API-08 ``GET /reports/operational``: the operational indicators of one
    laboratory over a period plus the current live sample balances."""

    model_config = ConfigDict(extra="forbid")

    processed_parties: int
    product_identifications: int
    transport_inspections: int
    current_sample_balances: list[BalanceView]
    period: ReportPeriod
