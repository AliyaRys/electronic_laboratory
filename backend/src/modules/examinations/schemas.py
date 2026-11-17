"""Strict typed API-05 contracts for the first examination save."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from backend.src.modules.catalog_pricing.schemas import (
    DecimalString,
    DosimetryPair,
    PricingSnapshot,
)
from backend.src.modules.samples.schemas import SampleSelection

__all__ = [
    "ResearchWrite",
    "InvasiveFinding",
    "NoncontagiousFinding",
    "ExaminationWrite",
    "ExaminationView",
    "ExaminationSampleView",
    "OutcomeWrite",
    "FormParticipantEntry",
    "FormClassificationEntry",
    "FormAccepted",
    "EligibleSpecialist",
    "ExaminationFormView",
    "PricingPreviewRequest",
    "PricingPreviewResponse",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class BooleanResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["BOOLEAN"]
    value: bool


class DecimalResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["DECIMAL"]
    value: DecimalString


class EnumResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["ENUM"]
    value: str = Field(min_length=1, max_length=255)
    other_text: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def other_requires_text(self) -> EnumResearch:
        if self.value.casefold() in {"other", "иное", "другое"} and not (self.other_text or "").strip():
            raise ValueError("Для значения «Иное» требуется пояснение.")
        return self


class TextResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["TEXT"]
    value: str = Field(min_length=1, max_length=2000)


class DosimetryResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["DOSIMETRY"]
    value: DosimetryPair


ResearchWrite = Annotated[
    BooleanResearch | DecimalResearch | EnumResearch | TextResearch | DosimetryResearch,
    Field(discriminator="kind"),
]


class InvasiveFinding(StrictModel):
    disease: str = Field(min_length=1, max_length=255)
    location: str = Field(min_length=1, max_length=1000)
    other_text: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def other_requires_text(self) -> InvasiveFinding:
        if self.disease.casefold() in {"other", "другое"} and not (self.other_text or "").strip():
            raise ValueError("Для другого паразитарного заболевания требуется название.")
        return self


class NoncontagiousFinding(StrictModel):
    disease: str = Field(min_length=1, max_length=255)
    other_text: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def other_requires_text(self) -> NoncontagiousFinding:
        if (
            self.disease.casefold() in {"other", "другое", "другое незаразное заболевание"}
            and not (self.other_text or "").strip()
        ):
            raise ValueError("Для другого незаразного заболевания требуется название.")
        return self


class ExaminationWrite(StrictModel):
    mode: Literal["WAITING", "COMPLETED"]
    number: str = Field(min_length=1, max_length=128)
    stamp: str = Field(min_length=1, max_length=255)
    researches: list[ResearchWrite] = Field(min_length=1)
    invasive_findings: list[InvasiveFinding] = Field(default_factory=list)
    noncontagious_findings: list[NoncontagiousFinding] = Field(default_factory=list, max_length=10)
    sent_to_lab: bool = False
    sample: SampleSelection
    # DR35 §12.3: the chosen Госветслужбы specialist — a distinct audited
    # entity from created_by/updated_by. A new card requires an explicit
    # specialist (the server refuses a forged fallback); edits keep None to
    # preserve the current specialist.
    specialist_id: uuid.UUID | None = None
    # DR35 §13.5: the total the user saw in the CONFIRMED pricing preview.
    # Money is never computed client-side; this value only lets the final save
    # return a managed conflict when the server recomputation differs — it is
    # never stored or used as an input of the calculation.
    expected_total: DecimalString | None = None
    outcome: Literal["FIT", "UNFIT"] | None = None
    direction: Literal["SALE", "DISPOSAL", "DESTRUCTION"] | None = None
    reason: str | None = Field(default=None, max_length=2000)

    @field_validator("number", "stamp")
    @classmethod
    def trim_nonblank(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Поле не может быть пустым.")
        return trimmed

    @model_validator(mode="after")
    def state_contract(self) -> ExaminationWrite:
        if self.mode == "WAITING":
            if not self.sent_to_lab:
                raise ValueError("Ожидание возможно только после отправки проб в специальную лабораторию.")
            if self.outcome is not None or self.direction is not None or self.reason is not None:
                raise ValueError("В режиме ожидания итог, направление и причина не сохраняются.")
            return self
        if self.outcome == "FIT":
            if self.direction != "SALE" or self.reason is not None:
                raise ValueError("Для пригодной продукции требуется направление SALE без причины.")
        elif self.outcome == "UNFIT":
            if self.direction not in {"DISPOSAL", "DESTRUCTION"} or not (self.reason or "").strip():
                raise ValueError("Для непригодной продукции нужны направление и причина.")
        else:
            raise ValueError("Для завершения требуется итог экспертизы.")
        return self


class OutcomeWrite(StrictModel):
    """The late completion body (API-05): only the outcome block, nothing else."""

    outcome: Literal["FIT", "UNFIT"]
    direction: Literal["SALE", "DISPOSAL", "DESTRUCTION"]
    reason: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def outcome_matrix(self) -> OutcomeWrite:
        if self.outcome == "FIT":
            if self.direction != "SALE" or self.reason is not None:
                raise ValueError("Для пригодной продукции требуется направление SALE без причины.")
        elif self.direction not in {"DISPOSAL", "DESTRUCTION"} or not (self.reason or "").strip():
            raise ValueError("Для непригодной продукции нужны направление и причина.")
        return self


class ExaminationSampleView(BaseModel):
    """ТЗ DR44 §2/Task 3: the linked physical sample fact of the card.

    Read through ``ExaminationSample -> SampleCollection`` with ONE join —
    never by searching the party's collection list. ``revision`` is the card
    revision the read happened at (the card ``rev``).
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    collected_on: str
    mass_kg: DecimalString
    revision: int


class ExaminationView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    party_id: str
    laboratory_id: str
    number: str
    stamp: str
    status: str
    sent_to_lab: bool
    researches: list[object]
    invasive_findings: list[object]
    noncontagious_findings: list[object]
    pricing: dict[str, object]
    sample_collection_id: str
    # ТЗ DR44 Task 3: the linked physical sample (date + mass), never a search
    # of the party's collection list.
    sample: ExaminationSampleView
    outcome: str | None
    direction: str | None
    reason: str | None
    created_by: str
    # DR35 §12.3: the displayed specialist (specialist_id, falling back to the
    # audit actor for pre-DR35 rows) and the ФИО frozen at save time.
    specialist_id: str
    specialist_name: str | None
    created_at: datetime
    first_completed_at: datetime | None
    revision: int


# --- DR35 §4/§5/§6/§9/§12.3: the create-page read model ---------------------------


class FormParticipantEntry(StrictModel):
    """One frozen participant display value with its honest name state.

    A missing name stays ``state='MISSING'`` with ``name=None`` — the UI shows
    «Название не получено», never a GUID/UUID and never «—» for a known id.
    """

    name: str | None
    state: str  # SOURCE_XML | VETIS_LOOKUP | PENDING | ERROR | MISSING


class FormClassificationEntry(StrictModel):
    id: str | None
    name: str | None


class FormAccepted(StrictModel):
    """The accepted volume FROZEN by the confirmed reconciliation (§7.2)."""

    mass_kg: str
    quantity: str
    unit_id: str
    unit_name: str | None


class EligibleSpecialist(StrictModel):
    """One scoped specialist option (active VET/HEAD with the ВСЭ right)."""

    id: str
    full_name: str


class ExaminationFormView(BaseModel):
    """API-05 ``ExaminationFormView``: the single read source of the create page.

    Everything is read from the frozen reconciliation step (the party snapshot
    plus the frozen confirmation): no SOAP, no GUID re-resolution, no lookup
    job on open (§4.1).
    """

    model_config = ConfigDict(extra="forbid")

    party_id: str
    laboratory_id: str
    participants: dict[str, FormParticipantEntry]
    product: FormClassificationEntry
    sub_product: FormClassificationEntry | None = None
    product_item: FormClassificationEntry | None = None
    unit: FormClassificationEntry | None = None
    product_type: int | None = None
    product_type_label: str | None
    accepted: FormAccepted
    # The required research set of THIS party (§9.3): the fixed ФТ mandatory
    # indicators plus trichinelloscopy when the pinned classification demands
    # it — the frontend never guesses by name.
    required_research_ids: list[str]
    eligible_specialists: list[EligibleSpecialist]
    source_revision: str
    reconciliation_revision: int | None
    revision: int


class PricingPreviewRequest(StrictModel):
    """DR35 §13.3: only the data needed to know which researches are fully
    performed. No money, no quantity, no totals are ever accepted."""

    researches: list[ResearchWrite] = Field(default_factory=list)


class PricingPreviewResponse(StrictModel):
    """DR35 §13.3: the typed preview — the SAME ``PricingSnapshot`` the final
    save persists, plus the frozen quantity context it was computed from."""

    snapshot: PricingSnapshot
    accepted_quantity: str
    accepted_unit_id: str
    fair: bool
    revision: int
