"""Strict typed API-05 contracts for the first examination save."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from backend.src.modules.catalog_pricing.schemas import DecimalString, DosimetryPair
from backend.src.modules.samples.schemas import SampleSelection

__all__ = [
    "ResearchWrite",
    "InvasiveFinding",
    "NoncontagiousFinding",
    "ExaminationWrite",
    "ExaminationView",
    "OutcomeWrite",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class BooleanResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["BOOLEAN"]
    value: bool


class IntegerResearch(StrictModel):
    indicator_id: uuid.UUID
    kind: Literal["INTEGER"]
    value: int = Field(ge=0)


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
    BooleanResearch | IntegerResearch | DecimalResearch | EnumResearch | TextResearch | DosimetryResearch,
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
    outcome: str | None
    direction: str | None
    reason: str | None
    created_by: str
    created_at: datetime
    first_completed_at: datetime | None
    revision: int
