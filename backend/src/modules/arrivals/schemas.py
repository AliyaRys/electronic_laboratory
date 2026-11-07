"""API-04 arrival read/write contracts (strict DTOs, ``extra=forbid``).

The source snapshot is the external eVSD shape as received from VetIS: it is
validated strictly on import and stored as JSONB. Product levels are kept
separate — ``product`` (level 2), ``subProduct`` (level 3) and
``productItem`` (level 4) — and the fourth level never substitutes the
second-level product name (plan Global Constraints).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from backend.src.modules.integrations.vetis.models import VetisContour

__all__ = [
    "IncomingDocument",
    "SourceSnapshot",
    "QuantitySet",
    "ExternalFields",
    "ClassificationView",
    "ClassificationEntry",
    "ConfirmationSummary",
    "IncomingView",
    "DecimalString",
    "parse_decimal",
]

_DECIMAL_PATTERN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z")


def parse_decimal(value: str) -> Decimal:
    """Parse a finite plain decimal string; anything else raises ``ValueError``."""
    if not isinstance(value, str) or _DECIMAL_PATTERN.fullmatch(value) is None:
        raise ValueError("Значение должно быть конечной десятичной строкой с точкой.")
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:  # pragma: no cover - guarded by the pattern
        raise ValueError("Значение должно быть конечной десятичной строкой.") from exc
    if not parsed.is_finite():
        raise ValueError("Значение должно быть конечным числом.")
    return parsed


DecimalString = Annotated[str, AfterValidator(parse_decimal)]


class StrictModel(BaseModel):
    """Every DTO forbids extras and accepts the camelCase wire names."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class ExternalRef(StrictModel):
    """A classification/external object reference (guid — stable identity)."""

    guid: uuid.UUID | None = None
    external_uuid: uuid.UUID | None = Field(default=None, alias="uuid")
    name: str | None = Field(default=None, max_length=255)


class Batch(StrictModel):
    """``batch`` of the eVSD: three separate classification levels + unit."""

    product: ExternalRef
    sub_product: ExternalRef | None = None
    product_item: ExternalRef | None = None
    volume: DecimalString
    quantity: DecimalString | None = None
    unit: ExternalRef | None = None


class ConsignorConsignee(StrictModel):
    name: str = Field(max_length=255)
    business_entity: ExternalRef | None = None
    enterprise: ExternalRef | None = None


class VdDocument(StrictModel):
    type: str = Field(max_length=64)
    status: str = Field(max_length=64)
    issue_series: str | None = Field(default=None, max_length=64)
    issue_number: str = Field(max_length=128)
    issue_date: str | None = Field(default=None, max_length=64)
    consignor: ConsignorConsignee
    consignee: ConsignorConsignee
    batch: Batch
    transport_number: str | None = Field(default=None, max_length=64)


class SourceSnapshot(StrictModel):
    """The normalized external document (DATA-02 ``source_snapshot``)."""

    vd_document: VdDocument
    vet_documents: list[dict[str, str | None]] = Field(default_factory=list)


class IncomingDocument(StrictModel):
    """The command input of ``upsert_incoming`` (one external fetch result)."""

    contour: VetisContour
    evsd_uuid: uuid.UUID
    laboratory_id: uuid.UUID | None = None
    external_status: str = Field(max_length=64)
    snapshot: SourceSnapshot
    fetched_at: datetime


class QuantitySet(BaseModel):
    """API-04 ``QuantitySet``: finite decimal strings, one unit identity."""

    model_config = ConfigDict(extra="forbid")

    mass_kg: str
    quantity: str
    unit_id: str


class ExternalFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contour: str
    evsd_uuid: str
    status: str
    fields: dict[str, str | None]


class ClassificationEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None
    name: str | None


class ClassificationView(StrictModel):
    product: ClassificationEntry
    sub_product: ClassificationEntry | None = None
    product_item: ClassificationEntry | None = None
    unit: ClassificationEntry | None = None
    product_type: int | None = Field(default=None, alias="productType")


class ConfirmationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    accepted_mass_kg: str
    accepted_quantity: str
    accepted_unit_id: str
    returned_mass_kg: str
    returned_quantity: str
    confirmed_at: datetime


class IncomingView(BaseModel):
    """API-04 ``IncomingView``."""

    model_config = ConfigDict(extra="forbid")

    id: str
    party_id: str
    laboratory_id: str
    external: ExternalFields
    classification: ClassificationView
    documentary: QuantitySet
    confirmation: ConfirmationSummary | None
    queue: Literal["EXPECTED", "WORK", "ACCEPTED"]
    examination_id: str | None
    revision: int
