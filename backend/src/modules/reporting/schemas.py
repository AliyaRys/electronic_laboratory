"""Reporting contracts (API-08, DATA-04/05, ФТ 09): the pure calculator DTOs.

Every mass is an exact ``Decimal`` in kilograms; the tonnes conversion for the
official rows 240–242 happens once, after the whole aggregation (FT-RPT-04:
«Вес суммируется до итогового отображаемого округления») — never per source.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from backend.src.modules.catalog_pricing.schemas import ANIMAL_COLUMNS

__all__ = [
    "AnimalColumn",
    "FormRow",
    "MaterialKind",
    "SpeciesClassification",
    "ClassificationMap",
    "ReportSource",
    "ReportMatrix",
    "OperationalView",
    "ReportPeriod",
    "SECTION_III_ROWS",
    "SECTION_III_ROW_CODES",
    "ROW_NAMES",
    "AUTOMATIC_ROW_CODES",
    "ROW_CODES",
    "COUNT_ROWS",
    "MASS_ROWS",
    "ReportPreviewParams",
    "SignedPreview",
    "SaveReportWrite",
    "ReportSnapshotView",
    "ReportSummary",
    "ReportSummaryPage",
]

AnimalColumn = Literal[
    "CATTLE", "PIG", "SHEEP_GOAT", "RABBIT_NUTRIA", "CHICKEN", "OTHER_BIRDS", "FISH", "OTHER_ANIMALS"
]
MaterialKind = Literal["MEAT", "OFFAL"]

#: The animal columns of the calculator: exactly the classification map
#: columns of INPUT-05/DATA-04. The printed form keeps CHICKEN and
#: OTHER_BIRDS as two separate columns under the «Птица» group (DR51 §2.1);
#: the data layer never invents or merges a column.
COLUMNS: tuple[str, ...] = ANIMAL_COLUMNS


class FormRow(BaseModel):
    """One canonical printed row of the 5-вет section III form (DR51 §2.2).

    ``mode`` is the honest display contract: ``AUTO`` rows are always filled
    by the server (a real calculated zero is the number ``0``), ``BLANK``
    rows are never computed — every cell stays ``null`` and is rendered as
    an empty cell in UI, PDF and XLSX (never «Не рассчитывается», «—» or 0).
    """

    model_config = ConfigDict(frozen=True)

    code: str
    name: str
    mode: Literal["AUTO", "BLANK"]


#: The exact canonical catalogue of the printed form (DR51 §2.2, owner
#: sample `отчет 5 вет раздел 3.xlsx`, лист «отчет», A3:J55). Order, codes and
#: texts are an exact contract; the only tolerated normalisation is the
#: ё/е spelling of this very table. The XLSX sample is not a runtime
#: dependency — this catalogue IS the single source of truth.
SECTION_III_ROWS: tuple[FormRow, ...] = (
    FormRow(code="166", name="1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц", mode="AUTO"),
    FormRow(code="167", name="в том числе: микроскопических", mode="AUTO"),
    FormRow(code="168", name="трихинеллоскопий", mode="AUTO"),
    FormRow(code="169", name="физико-химических", mode="AUTO"),
    FormRow(code="170", name="радиометрических", mode="AUTO"),
    FormRow(code="171", name="других лабораторных исследований", mode="AUTO"),
    FormRow(code="172", name="2. Проведено специальных лабораторных исследований всего, единиц", mode="AUTO"),
    FormRow(code="173", name="3. Выявлено случаев болезни при ВСЭ, единиц", mode="BLANK"),
    FormRow(code="174", name="Ящур", mode="BLANK"),
    FormRow(code="175", name="Сибирская язва", mode="BLANK"),
    FormRow(code="176", name="Туберкулез", mode="BLANK"),
    FormRow(code="177", name="Бруцеллез", mode="BLANK"),
    FormRow(code="178", name="Лейкоз", mode="BLANK"),
    FormRow(code="179", name="Сап", mode="BLANK"),
    FormRow(code="189", name="Оспа", mode="BLANK"),
    FormRow(code="190", name="Болезнь Ауески", mode="BLANK"),
    FormRow(code="191", name="Классическая чума свиней", mode="BLANK"),
    FormRow(code="192", name="Болезнь Марека", mode="BLANK"),
    FormRow(code="193", name="Цистицеркоз (финноз)", mode="BLANK"),
    FormRow(code="195", name="Трихинеллез", mode="BLANK"),
    FormRow(code="200", name="Миксоматоз", mode="BLANK"),
    FormRow(code="205", name="Аэромоноз карповых и лососевых (краснуха)", mode="BLANK"),
    FormRow(code="206", name="Весенняя виремия карпов", mode="BLANK"),
    FormRow(code="207", name="Псевдомоноз", mode="BLANK"),
    FormRow(code="208", name="Другие инфекционные болезни", mode="BLANK"),
    FormRow(code="209", name="Другие инвазионные болезни", mode="BLANK"),
    FormRow(code="210", name="Незаразные болезни", mode="AUTO"),
    FormRow(code="211", name="4. Направлено на обезвреживание мяса, тонн", mode="BLANK"),
    FormRow(code="212", name="из них по туберкулезу", mode="BLANK"),
    FormRow(code="213", name="лейкозу", mode="BLANK"),
    FormRow(code="214", name="болезни Марека", mode="BLANK"),
    FormRow(code="215", name="цистицеркозу (финнозу)", mode="BLANK"),
    FormRow(code="216", name="сальмонеллезу", mode="BLANK"),
    FormRow(code="221", name="5. Направлено на обезвреживание субпродуктов, тонн", mode="BLANK"),
    FormRow(code="222", name="из них по: туберкулезу", mode="BLANK"),
    FormRow(code="223", name="лейкозу", mode="BLANK"),
    FormRow(code="224", name="болезни Марека", mode="BLANK"),
    FormRow(code="225", name="цистицеркозу (финнозу)", mode="BLANK"),
    FormRow(code="226", name="сальмонеллезу", mode="BLANK"),
    FormRow(code="231", name="6. Направлено на утилизацию мяса, тонн", mode="BLANK"),
    FormRow(code="232", name="из них по: туберкулезу", mode="BLANK"),
    FormRow(code="233", name="лейкозу", mode="BLANK"),
    FormRow(code="234", name="болезни Марека", mode="BLANK"),
    FormRow(code="235", name="цистицеркозу (финнозу)", mode="BLANK"),
    FormRow(code="240", name="7. Направлено на уничтожение, тонн", mode="AUTO"),
    FormRow(code="241", name="из них: мяса", mode="AUTO"),
    FormRow(code="242", name="субпродуктов", mode="AUTO"),
)

#: The 47 printed row codes in the exact form order (DR51 §2.2).
SECTION_III_ROW_CODES: tuple[str, ...] = tuple(row.code for row in SECTION_III_ROWS)

#: The names of every printed row, keyed by code (display/export projection).
ROW_NAMES: dict[str, str] = {row.code: row.name for row in SECTION_III_ROWS}

#: The only automatically calculated rows of the printed form (DR51 §4):
#: 166–172, 210 and 240–242. Every other row is BLANK — ``null`` forever.
AUTOMATIC_ROW_CODES: tuple[str, ...] = tuple(row.code for row in SECTION_III_ROWS if row.mode == "AUTO")

#: The rows the calculator fills (DR51 §2.2): counts (166–172, 210) and
#: masses 240–242. Kept under the historical names for the audit tests.
ROW_CODES: tuple[str, ...] = AUTOMATIC_ROW_CODES
COUNT_ROWS: frozenset[str] = frozenset({"166", "167", "168", "169", "170", "171", "172", "210"})
MASS_ROWS: frozenset[str] = frozenset({"240", "241", "242"})


class SpeciesClassification(BaseModel):
    """One mapping entry of the report classification (INPUT-05/DATA-04).

    DR49 §2.4: an explicitly unsupported row carries ``animal_column=None``
    and ``material_kind=None``; ``_resolved`` checks ``supported`` first, so a
    supported entry always has both values narrowed non-null.
    """

    model_config = ConfigDict(extra="forbid")

    mercury_species_id: str
    animal_column: AnimalColumn | None
    material_kind: MaterialKind | None
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
    #: DR51 §3: the number of saved «незаразные» finding lines of the card's
    #: newest revision (row 210 counts every saved line as one case; a card
    #: without such findings contributes the honest calculated zero).
    noncontagious_findings_count: int = Field(default=0, ge=0)


class ReportMatrix(BaseModel):
    """The automatic row contributions per animal column (166–172, 210, 240–242).

    ``rows`` is zero-initialized for every automatic row and column; count
    rows carry whole numbers, mass rows 240–242 carry tonnes as exact
    ``Decimal`` values after the single final kg→t conversion. BLANK rows of
    the printed form never enter this matrix — they are ``null`` in the
    payload by construction (DR51 §2.3).
    """

    columns: tuple[str, ...]
    rows: dict[str, dict[str, Decimal]]
    names: dict[str, str]


class ReportPeriod(BaseModel):
    """The reporting window as it was requested (API-08 ``period``)."""

    model_config = ConfigDict(extra="forbid")

    date_from: date
    date_to: date


class OperationalView(BaseModel):
    """API-08 ``GET /reports/operational``: the operational indicators of one
    laboratory over a period (DR48: «Сохранённых ВСЭ» counts the saved local
    cards; the current sample balances are NOT part of the endpoint)."""

    model_config = ConfigDict(extra="forbid")

    saved_examinations: int
    product_identifications: int
    transport_inspections: int
    period: ReportPeriod


REPORT_TYPE: Literal["5VET_SECTION_III"] = "5VET_SECTION_III"


class ReportPreviewParams(BaseModel):
    """Server-scoped parameters of an immutable 5-vet preview.

    DR48 §3.1: the period is any valid inclusive calendar range, not a
    completed half-year; both bounds are required and ``date_from <= date_to``.
    """

    model_config = ConfigDict(extra="forbid")

    report_type: Literal["5VET_SECTION_III"] = REPORT_TYPE
    laboratory_id: UUID
    date_from: date
    date_to: date

    @field_validator("date_to")
    @classmethod
    def ordered_range(cls, value: date, info: ValidationInfo) -> date:
        start = info.data.get("date_from")
        if start is not None and value < start:
            raise ValueError("Дата начала не может быть позже даты окончания.")
        return value


class SignedPreview(BaseModel):
    """The exact compact payload shown by the UI and its session-bound MAC."""

    model_config = ConfigDict(extra="forbid")

    payload: dict[str, object]
    key_id: str
    signature: str
    byte_size: int


class SaveReportWrite(BaseModel):
    """DR51 §6.2: the save request carries only the signed preview — the seven
    organizational codes are cancelled and never accepted again."""

    model_config = ConfigDict(extra="forbid")

    preview: SignedPreview


class ReportSnapshotView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    report_type: str
    laboratory_id: UUID
    date_from: date
    date_to: date
    payload: dict[str, object]
    source_count: int
    saved_at: datetime
    saved_by: UUID
    rev: int


class ReportSummary(BaseModel):
    """One row of the saved-report list (API-08 ``Page<ReportSummary>``).

    The summary never carries the payload: the heavy signed snapshot belongs
    to the single-report read, not to the list projection.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    report_type: str
    laboratory_id: UUID
    date_from: date
    date_to: date
    source_count: int
    saved_at: datetime
    saved_by: UUID
    rev: int


class ReportSummaryPage(BaseModel):
    """API-08 list page of saved reports, newest period first."""

    items: list[ReportSummary]
    total: int
    page: int
    page_size: int
