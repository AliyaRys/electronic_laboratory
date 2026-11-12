"""DTOs and typed rule schemas (API-03, INPUT-02/03/05, SPEC-05).

Every decimal is a finite plain string with a dot and no exponent; JSON floats
are rejected outright so no float can ever enter the pricing path (SPEC-05).
Client-side prices do not exist: the pricing write DTOs carry no price field
beyond the tariff editor, and every schema forbids extras.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

__all__ = [
    "DECIMAL_SCHEMAS",
    "ANIMAL_COLUMNS",
    "DecimalString",
    "QuantityStringType",
    "QuantityString",
    "MoneyStringType",
    "parse_decimal",
    "SourceRef",
    "ResultSchema",
    "IntervalRule",
    "QualitativeRule",
    "Rule",
    "DosimetryPair",
    "MethodRuleWrite",
    "TariffWrite",
    "CheckServiceRuleWrite",
    "ClassificationItemWrite",
    "ClassificationWrite",
    "ResearchValue",
    "PricingRequest",
    "PricingLine",
    "PricingSnapshot",
    "ReadinessMissing",
    "Readiness",
    "MethodRuleView",
    "TariffView",
    "CheckServiceRuleView",
    "ClassificationItemView",
]

DECIMAL_SCHEMAS = frozenset({"DECIMAL", "INTEGER_NONNEGATIVE"})
ANIMAL_COLUMNS = (
    "CATTLE",
    "PIG",
    "SHEEP_GOAT",
    "RABBIT_NUTRIA",
    "CHICKEN",
    "OTHER_BIRDS",
    "FISH",
    "OTHER_ANIMALS",
)

_DECIMAL_PATTERN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z")


def parse_decimal(value: str) -> Decimal:
    """Parse a finite plain decimal string; anything else raises ``ValueError``.

    Exponent notation, NaN/Infinity, spaces, comma separators and empty strings
    are all rejected (SPEC-05: empty is not zero).
    """
    if not isinstance(value, str) or _DECIMAL_PATTERN.fullmatch(value) is None:
        raise ValueError(f"Ожидается конечное десятичное число с точкой, получено: {value!r}")
    try:
        return Decimal(value)
    except InvalidOperation as exc:  # pragma: no cover - pattern guarantees success
        raise ValueError(f"Неподдерживаемое число: {value!r}") from exc


def _no_float(value: Any) -> Any:
    if isinstance(value, float):
        raise ValueError("Числа передаются строкой с точкой; float недопустим.")
    return value


def _scale_limited(max_scale: int) -> Callable[[str], str]:
    def _check(value: str) -> str:
        parsed = parse_decimal(value)
        exponent = parsed.as_tuple().exponent
        if isinstance(exponent, int) and -exponent > max_scale:
            raise ValueError(f"Поддерживается не более {max_scale} знаков после точки.")
        return value

    return _check


class QuantityString:
    """External quantity/mass input: plain decimal string, at most scale 6."""

    MAX_SCALE = 6

    @staticmethod
    def validate(value: str) -> str:
        checked = _scale_limited(QuantityString.MAX_SCALE)(value)
        return checked


DecimalString = Annotated[str, AfterValidator(_no_float), AfterValidator(lambda v: (parse_decimal(v), v)[1])]
MoneyStringType = Annotated[str, AfterValidator(_scale_limited(2))]
QuantityStringType = Annotated[str, AfterValidator(_scale_limited(6))]


class SourceRef(BaseModel):
    """Provenance of a norm/tariff value (INPUT-02/03): never invented by code."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    edition: str | None = None
    reference: str | None = None


class DosimetryPair(BaseModel):
    """The two decimal readings of one performed dosimetry procedure."""

    model_config = ConfigDict(extra="forbid")

    first: DecimalString
    last: DecimalString


class IntervalRule(BaseModel):
    """A numeric interval with explicit inclusivity of both borders."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["interval"]
    lower: DecimalString | None = None
    upper: DecimalString | None = None
    lower_inclusive: bool = True
    upper_inclusive: bool = True

    @model_validator(mode="after")
    def _ordered(self) -> IntervalRule:
        if self.lower is not None and self.upper is not None and parse_decimal(self.lower) > parse_decimal(self.upper):
            raise ValueError("lower должен быть не больше upper.")
        return self


class QualitativeRule(BaseModel):
    """An explicit list of accepted textual values (clinical mapping from source)."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["qualitative"]
    accepted_values: list[str] = Field(min_length=1)


Rule = Annotated[IntervalRule | QualitativeRule, Field(discriminator="type")]


class ResultSchema(StrEnum):
    """Typed result schemas from INPUT-02."""

    BOOLEAN_MATCH = "BOOLEAN_MATCH"
    INTEGER_NONNEGATIVE = "INTEGER_NONNEGATIVE"
    DECIMAL = "DECIMAL"
    ENUM = "ENUM"
    TEXT = "TEXT"
    DOSIMETRY_PAIR = "DOSIMETRY_PAIR"


class MethodRuleWrite(BaseModel):
    """Create/update payload for a versioned method rule (INPUT-02)."""

    model_config = ConfigDict(extra="forbid")

    laboratory_id: UUID
    product_species_id: UUID
    product_state_id: UUID
    indicator_id: UUID
    version: int = Field(ge=1)
    result_schema: ResultSchema
    unit_id: str = Field(min_length=1, max_length=64)
    rule: Rule
    source: SourceRef
    effective_from: str | None = None

    @field_validator("effective_from")
    @classmethod
    def _date_form(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\Z", value):
            raise ValueError("effective_from передаётся датой в форме YYYY-MM-DD.")
        return value


class TariffWrite(BaseModel):
    """Create/update payload for a tariff (INPUT-03): price is server-side data.

    Owner decision DR14: the two CHECK services are laboratory-scoped only —
    ``product_species_id`` is NOT sent (and is never persisted for them). VSE
    service codes require the species.
    """

    model_config = ConfigDict(extra="forbid")

    laboratory_id: UUID
    product_species_id: UUID | None = None
    service_code: str = Field(min_length=1, max_length=128)
    unit_id: str = Field(min_length=1, max_length=64)
    price: MoneyStringType
    version: int = Field(ge=1)
    source: SourceRef

    @field_validator("price")
    @classmethod
    def _nonnegative(cls, value: str) -> str:
        if parse_decimal(value) < 0:
            raise ValueError("Цена не может быть отрицательной.")
        return value


class CheckServiceRuleWrite(BaseModel):
    """The two CHECK services only; the rule arrives with the price list owner."""

    model_config = ConfigDict(extra="forbid")

    service_code: Literal["PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION"]
    unit_id: str = Field(min_length=1, max_length=64)
    multiplier_basis: Literal["ACCEPTED_QUANTITY", "DELIVERED_QUANTITY", "ONE_SERVICE"]
    applicable_decisions: list[Literal["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]] = Field(min_length=1)
    version: int = Field(ge=1)
    source: SourceRef


class ClassificationItemWrite(BaseModel):
    """One species mapping row (INPUT-05): agreed IDs, never name guessing."""

    model_config = ConfigDict(extra="forbid")

    mercury_species_id: str = Field(min_length=1, max_length=64)
    product_type_id: str | None = Field(default=None, max_length=64)
    product_state_id: str | None = Field(default=None, max_length=64)
    supported: bool
    animal_column: Literal[
        "CATTLE", "PIG", "SHEEP_GOAT", "RABBIT_NUTRIA", "CHICKEN", "OTHER_BIRDS", "FISH", "OTHER_ANIMALS"
    ]
    material_kind: Literal["MEAT", "OFFAL"]


class ClassificationWrite(BaseModel):
    """A whole classification map version written atomically."""

    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=64)
    items: list[ClassificationItemWrite] = Field(min_length=1)


# --- pricing DTOs (API-03) -------------------------------------------------------


class ResearchValue(BaseModel):
    """One typed research result (API-05); absence of ``value`` is allowed."""

    model_config = ConfigDict(extra="forbid")

    indicator_id: UUID
    performed: bool = True
    value: bool | int | str | DosimetryPair | None = None


class PricingRequest(BaseModel):
    """The pricing input (API-03).

    ``party_id`` identifies the working record; ``product_species_id`` /
    ``product_state_id`` and the accepted/delivered quantities are resolved
    server-side from the party in later tasks (Task A0x). C01 accepts them as
    request fields because the arrivals module does not exist yet; the boundary
    is recorded in the evidence file.
    """

    model_config = ConfigDict(extra="forbid")

    party_id: UUID
    laboratory_id: UUID | None = None
    context: Literal["CHECK", "VSE"]
    performed: list[str] = Field(default_factory=list)
    results: list[ResearchValue] = Field(default_factory=list)
    fair: bool = False
    product_species_id: UUID | None = None
    product_state_id: UUID | None = None
    accepted_quantity: QuantityStringType | None = None
    accepted_unit_id: str | None = None
    delivered_quantity: QuantityStringType | None = None
    delivered_unit_id: str | None = None
    decision: Literal["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"] | None = None


class PricingLine(BaseModel):
    """One priced line of the snapshot; money is a scale-2 decimal string."""

    model_config = ConfigDict(extra="forbid")

    service_code: str
    name: str
    unit_id: str
    quantity: QuantityStringType
    unit_price: MoneyStringType
    amount: MoneyStringType
    method_snapshot: dict[str, Any] | None = None
    evaluation: dict[str, Any] | None = None


class PricingSnapshot(BaseModel):
    """The frozen pricing outcome (ADR-020); fair mode stores only zeros."""

    model_config = ConfigDict(extra="forbid")

    lines: list[PricingLine]
    total: MoneyStringType
    currency: Literal["RUB"] = "RUB"
    fair: bool


class ReadinessMissing(BaseModel):
    """One missing configuration input for a working scope (API-03)."""

    model_config = ConfigDict(extra="forbid")

    input_id: str
    field: str
    message: str


class Readiness(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    missing: list[ReadinessMissing]


# --- catalog views ----------------------------------------------------------------


class MethodRuleView(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    laboratory_id: UUID
    product_species_id: UUID
    product_state_id: UUID
    indicator_id: UUID
    version: int
    result_schema: str
    unit_id: str
    rule: dict[str, Any]
    source: dict[str, Any]
    effective_from: str | None = None
    active: bool
    revision: int


class TariffView(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    laboratory_id: UUID
    product_species_id: UUID | None
    service_code: str
    unit_id: str
    price: MoneyStringType
    version: int
    source: dict[str, Any]
    revision: int


class CheckServiceRuleView(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    service_code: str
    unit_id: str
    multiplier_basis: str
    applicable_decisions: list[str]
    version: int
    source: dict[str, Any]
    revision: int


class ClassificationItemView(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    version: str
    mercury_species_id: str
    product_type_id: str | None
    product_state_id: str | None
    supported: bool
    animal_column: str
    material_kind: str
    revision: int
