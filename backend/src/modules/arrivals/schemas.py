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

from backend.src.core.problems import ProblemItem
from backend.src.modules.catalog_pricing.schemas import PricingSnapshot
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
    "Comparison",
    "Inspection",
    "ReturnReason",
    "Repeat",
    "Transaction",
    "ServiceItem",
    "ReconciliationWrite",
    "ActItem",
    "ActPreview",
    "ReconciliationView",
    "PricingSnapshot",
    "DecimalString",
    "PackageEntry",
    "ProductMark",
    "PurposeRef",
    "GoodsDate",
    "goods_date_fields",
    "strict_calendar_date",
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
    global_id: str | None = Field(default=None, alias="globalID", max_length=64)


class ProductMark(StrictModel):
    """One ``dt:productMarks`` entry: its ``class`` attribute + the text."""

    mark_class: str | None = Field(default=None, alias="class", max_length=64)
    value: str = Field(max_length=255)


class PackageEntry(StrictModel):
    """One ``dt:package`` of ``vd:packageList`` — source-faithful, no float.

    ``quantity`` is the raw source string; the sum over the MAXIMAL level is
    computed separately (see ``normalizer.package_quantity``) and never mixed
    with the mass (``batch.volume``).
    """

    level: int | None = None
    packing_type: ExternalRef | None = Field(default=None, alias="packingType")
    quantity: str | None = Field(default=None, max_length=64)
    product_marks: list[ProductMark] = Field(default_factory=list, alias="productMarks")


def strict_calendar_date(value: str) -> str:
    """DR20 §8: a strict calendar date ``YYYY-MM-DD`` — nothing else passes.

    ``2026-02-30`` and ``2026-13-01`` are refused (no silent normalization,
    no datetime round-trip through a timezone).
    """
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is None:
        raise ValueError("Дата должна быть календарной датой в формате ГГГГ-ММ-ДД.")
    year_text, month_text, day_text = value.split("-")
    try:
        datetime(int(year_text), int(month_text), int(day_text))
    except ValueError as exc:
        raise ValueError("Дата должна быть существующей календарной датой.") from exc
    return value


StrictCalendarDate = Annotated[str, AfterValidator(strict_calendar_date)]


class GoodsDate(StrictModel):
    """DR20 §5.1: the typed ``vd:GoodsDate`` of the source XML.

    The TYPE of the source value survives end-to-end: a single date keeps
    ``secondDate`` strictly ``null`` (never a copy of ``firstDate``), an
    interval keeps both dates, an informal value keeps the source text and
    never becomes an invented calendar date. ``dt:hour`` is stored separately
    (``firstDateHour``/``secondDateHour``) for source/audit only — it is never
    added to the displayed calendar date and never shifts it by a timezone.
    """

    first_date: StrictCalendarDate | None = Field(default=None, alias="firstDate")
    second_date: StrictCalendarDate | None = Field(default=None, alias="secondDate")
    informal_date: str | None = Field(default=None, alias="informalDate", max_length=255)
    first_date_hour: int | None = Field(default=None, alias="firstDateHour")
    second_date_hour: int | None = Field(default=None, alias="secondDateHour")


def goods_date_fields(batch: dict[str, object], base: str) -> dict[str, str | None]:
    """DR20 §6: the read-model keys of one typed source GoodsDate.

    ``base`` is ``producedOn`` or ``expiresOn``; the four published keys
    ``<base>``/``<base>From``/``<base>To``/``<base>Informal`` keep the TYPE of
    the source value machine-readable: a single date fills only ``<base>``,
    an interval fills only ``From``/``To`` (never collapsed to one date), an
    informal value fills only ``<base>Informal`` with the source text. An
    absent node (or an empty structure) publishes four ``None`` values — no
    fictive date, no invented mark.
    """
    raw = batch.get("dateOfProduction" if base == "producedOn" else "expiryDate")
    goods = raw if isinstance(raw, dict) else {}

    def text(value: object) -> str | None:
        return None if value in (None, "") else str(value)

    first = text(goods.get("firstDate"))
    second = text(goods.get("secondDate"))
    informal = text(goods.get("informalDate"))
    if first is None and second is None and informal is None:
        return {base: None, f"{base}From": None, f"{base}To": None, f"{base}Informal": None}
    return {
        # An interval is never collapsed into one date: ``<base>`` stays None.
        base: first if second is None else None,
        f"{base}From": first if second is not None else None,
        f"{base}To": second,
        f"{base}Informal": informal,
    }


class PurposeRef(StrictModel):
    """``vd:authentication/vd:purpose`` — identifiers only; the Russian name is
    resolved at READ time from the contour-scoped local dictionary and is
    never written into the snapshot."""

    guid: uuid.UUID | None = None
    external_uuid: uuid.UUID | None = Field(default=None, alias="uuid")


class Batch(StrictModel):
    """``batch`` of the eVSD: three separate classification levels + unit.

    ``quantity`` is the number of transport packages (max-level sum of
    ``packageList``) — NEVER the mass (``volume``) and never a fabricated ``0``.
    """

    product: ExternalRef
    sub_product: ExternalRef | None = None
    product_item: ExternalRef | None = None
    volume: DecimalString
    quantity: DecimalString | None = None
    unit: ExternalRef | None = None
    package_list: list[PackageEntry] = Field(default_factory=list, alias="packageList")
    # DR20 §5: the typed production/expiry dates of the source batch; absent
    # nodes stay ``None`` (the read model never fabricates a date).
    date_of_production: GoodsDate | None = Field(default=None, alias="dateOfProduction")
    expiry_date: GoodsDate | None = Field(default=None, alias="expiryDate")


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
    # DR16: the raw vd:certifiedConsignment/vd:transportStorageType code; the
    # Russian label is resolved at READ time by vetis.storage_types and never
    # written into the snapshot.
    transport_storage_type: str | None = Field(default=None, alias="transportStorageType", max_length=64)
    # ТЗ DR17 §5.1: the trailer is a SEPARATE source fact, never merged with
    # the vehicle number into one string.
    trailer_number: str | None = Field(default=None, max_length=64)
    purpose: PurposeRef | None = None


# ТЗ DR17 §1/§5.2: the agreed informational text published for an absent or
# empty ``vd:trailerNumber``. It is a projection value only — never written
# into the raw XML, never a fictive number, never «—» or «Не указано».
ABSENT_TRAILER_TEXT = "Прицеп отсутствует"


def trailer_projection(value: str | None) -> str:
    """The published trailer field: the source number or the agreed text."""
    text = (value or "").strip()
    return text if text else ABSENT_TRAILER_TEXT


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
    # ТЗ DR9 §6: the freshness diagnostics of the source observation, shown
    # separately from the local queue state (never a fabricated UTILIZED).
    source_presence: Literal["CURRENT_CONFIRMED", "NOT_IN_CURRENT_CONFIRMED_LIST", "UNKNOWN"] = "UNKNOWN"
    last_seen_sync_at: datetime | None = None
    source_presence_reason: str | None = None


# --- Reconciliation write/read contracts (API-04) -------------------------------


class Comparison(StrictModel):
    """API-04 ``Comparison`` for one CHK field: an explicit mark + facts."""

    matches: bool
    actual: str | int | None = None
    reason: str | None = Field(default=None, max_length=255)


class Inspection(StrictModel):
    """CHK-F13/F14: the transport inspection inputs (frozen after confirmation)."""

    compartment: Literal["COMPLIANT", "DIRTY_OR_DAMAGED"] | None = None
    joint_carriage: Literal["NONE", "SEPARATED", "NOT_SEPARATED"] | None = None


class ReturnReason(StrictModel):
    """CHK-F35: the Mercury return-reason code (OTHER_REASON needs text)."""

    code: str = Field(max_length=64)
    text: str | None = Field(default=None, max_length=240)


class Repeat(StrictModel):
    """CHK-F36–38: a repeated ВСЭ selection (only possible with a previous one)."""

    required: bool
    reason: str | None = Field(default=None, max_length=255)
    act_number: str | None = Field(default=None, max_length=64)


class Transaction(StrictModel):
    """CHK-F39/40: an analytical flag; «Нет» never keeps a type."""

    planned: bool | None = None
    type: Literal["INTERNAL", "EXTERNAL"] | None = None


class ServiceItem(StrictModel):
    """A performed service fact of the party (costing belongs to C01)."""

    code: str = Field(max_length=64)
    performed: bool


def _chk_key(value: str) -> str:
    if not re.fullmatch(r"CHK-F\d{2}", value):
        raise ValueError("Ключ проверки должен быть идентификатором CHK-Fxx.")
    return value


class ReconciliationWrite(StrictModel):
    """API-04 ``ReconciliationWrite``: facts the doctor entered; the source
    snapshot fields, act preview, allowed decisions and route are never
    accepted from the client."""

    checks: Annotated[dict[Annotated[str, AfterValidator(_chk_key)], Comparison], Field(default_factory=dict)]
    inspection: Inspection = Field(default_factory=Inspection)
    delivered: QuantitySet
    accepted: QuantitySet
    returned: QuantitySet
    decision: Literal["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"] | None = None
    return_reason: ReturnReason | None = None
    repeat: Repeat | None = None
    transaction: Transaction = Field(default_factory=Transaction)
    fair: bool = False
    services: list[ServiceItem] = Field(default_factory=list)


class ActItem(BaseModel):
    """One row of the derived discrepancy act (CHK-F44)."""

    model_config = ConfigDict(extra="forbid")

    field_id: str
    source: str | None = None
    actual: str | int | None = None
    reason: str


class ActPreview(BaseModel):
    """CHK-F44: derived, never accepted from the client."""

    model_config = ConfigDict(extra="forbid")

    required: bool
    items: list[ActItem] = Field(default_factory=list)


class ReconciliationView(BaseModel):
    """API-04 ``ReconciliationView`` with the server-calculated projection."""

    model_config = ConfigDict(extra="forbid")

    id: str
    party_id: str
    revision: int
    state: Literal["OPEN", "CONFIRMED", "RETURNED"]
    checks: dict[str, Comparison]
    inspection: Inspection
    delivered: QuantitySet
    accepted: QuantitySet
    returned: QuantitySet
    decision: Literal["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"] | None
    return_reason: ReturnReason | None
    repeat: Repeat | None
    transaction: Transaction
    fair: bool
    services: list[ServiceItem]
    # ТЗ DR11 §6: the frozen server-computed snapshot (context="CHECK"); NULL
    # for a started incomplete reconciliation — never an empty or fictitious
    # invoice. The client never sets it and a later tariff change does not
    # recalculate the saved value.
    pricing: PricingSnapshot | None = None
    actor_id: str
    saved_at: datetime
    completed_at: datetime | None
    # ServerView-derived data (API-04): the client never sets these.
    allowed_decisions: list[Literal["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]]
    act: ActPreview
    route: Literal["EXAMINATION", "CONCLUSION", "NONE"] | None
    errors: list[ProblemItem]
    complete: bool
