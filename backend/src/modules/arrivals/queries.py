"""Arrival read models (API-04): queues as query-time classification.

The scope filter (``laboratory_id``) is applied to the same WHERE as count and
search and is built first — no foreign row can ever be counted. Queue labels
are derived per request from actual table state (started reconciliation,
receipt confirmation, completed examination), never stored.
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, cast

from sqlalchemy import Column, MetaData, String, Table, func, select
from sqlalchemy import false as sql_false
from sqlalchemy.dialects.postgresql import UUID as SqlUUID
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.models import (
    HiddenIncoming,
    IncomingDocument,
    Party,
    ReceiptConfirmation,
    Reconciliation,
)
from backend.src.modules.arrivals.schemas import (
    AccompanyingDocumentView,
    ClassificationView,
    ConfirmationSummary,
    ExaminationSummary,
    ExternalFields,
    IncomingView,
    QuantitySet,
    ReconciliationSummary,
    goods_date_fields,
    trailer_projection,
)
from backend.src.modules.catalog_pricing.schemas import PricingSnapshot
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.models import User
from backend.src.modules.integrations.vetis.document_types import document_type_label
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.queries import find_purpose_name
from backend.src.modules.integrations.vetis.reference_names import (
    participant_name_overrides,
    resolve_participants,
)
from backend.src.modules.integrations.vetis.status import status_label
from backend.src.modules.integrations.vetis.storage_types import storage_type_label
from backend.src.modules.integrations.vetis.transport_types import transport_type_label

__all__ = [
    "PAGE_SIZE",
    "accompanying_documents_of",
    "arrival_page",
    "build_incoming_view",
    "combined_total_of",
    "examination_summaries",
    "party_view",
    "previous_vse_fields",
    "queue_of",
    "reconciliation_summaries",
]

# CHK source keys of the previous-ВСЭ block (CHK-F24/28–32, field-mapping).
PREVIOUS_VSE_KEYS: tuple[str, ...] = (
    "previousStamp",
    "previousNumber",
    "previousPerformedOn",
    "previousOrganization",
    "previousResult",
    "previousConclusion",
)


def previous_vse_fields(snapshot: object) -> dict[str, str | None]:
    """The previous-ВСЭ source projection of one normalized snapshot.

    The normalized external document carries the linked veterinary documents
    (``vet_documents``); an entry with a nonblank ``previousNumber`` is the
    previous-ВСЭ record of the eVSD (CHK-F28). V01 binds the real XML paths;
    here the projection only surfaces the facts the source carries — an absent
    record stays absent (informational absence never demands a fictitious
    mark, FT-ARR-03/11).
    """
    root = snapshot.get("vetDocuments") if isinstance(snapshot, dict) else None
    entries = root if isinstance(root, list) else []
    record: dict[str, object] = {}
    for entry in entries:
        if isinstance(entry, dict) and str(entry.get("previousNumber") or "").strip() != "":
            record = entry
            break
    return {key: (str(record.get(key)) if record.get(key) not in (None, "") else None) for key in PREVIOUS_VSE_KEYS}


PAGE_SIZE = 20

# ТЗ DR40 §6.1: the deterministic document key is a short digest of the
# normalized source combination typeCode + relationshipType + series +
# number + date; identical documents get a visible occurrence suffix so two
# equal rows never share one key (a mark can never silently cover both).
_KEY_DIGEST_LENGTH = 16


def _text_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def accompanying_document_key(
    *,
    type_code: str | None,
    relationship_type: str | None,
    series: str | None,
    number: str | None,
    created_on: str | None,
    occurrence: int = 0,
) -> str:
    """ТЗ DR40 §6.1: the deterministic key of one accompanying document."""
    combination = "|".join(
        (type_code or "", relationship_type or "", series or "", number or "", created_on or "")
    )
    digest = hashlib.sha1(combination.encode("utf-8")).hexdigest()[:_KEY_DIGEST_LENGTH]
    return digest if occurrence == 0 else f"{digest}#{occurrence + 1}"


def accompanying_documents_of(payload: object) -> list[AccompanyingDocumentView]:
    """ТЗ DR40 §6: the typed accompanying documents of one vdDocument payload.

    The source order is preserved (``sourceOrder``); the key is derived from
    the source fields with an occurrence suffix for fully identical
    documents; the Russian label comes ONLY from the single backend registry
    (``vetis.document_types``) — the client never duplicates the dictionary.
    """
    raw = payload if isinstance(payload, dict) else {}
    documents = raw.get("referencedDocuments")
    documents = documents if isinstance(documents, list) else []
    views: list[AccompanyingDocumentView] = []
    occurrences: dict[str, int] = {}

    def _digest(
        type_code: str | None,
        relationship_type: str | None,
        series: str | None,
        number: str | None,
        created_on: str | None,
    ) -> str:
        combination = "|".join((type_code or "", relationship_type or "", series or "", number or "", created_on or ""))
        return hashlib.sha1(combination.encode("utf-8")).hexdigest()[:_KEY_DIGEST_LENGTH]

    for order, document in enumerate(documents):
        entry = document if isinstance(document, dict) else {}
        type_code = _text_or_none(entry.get("type"))
        relationship_type = _text_or_none(entry.get("relationshipType"))
        series = _text_or_none(entry.get("issueSeries"))
        number = _text_or_none(entry.get("issueNumber"))
        created_on = _text_or_none(entry.get("issueDate"))
        base = _digest(type_code, relationship_type, series, number, created_on)
        occurrence = occurrences.get(base, 0)
        occurrences[base] = occurrence + 1
        key = base if occurrence == 0 else f"{base}#{occurrence + 1}"
        series_and_number = " ".join(part for part in (series, number) if part) or None
        views.append(
            AccompanyingDocumentView(
                key=key,
                sourceOrder=order,
                typeCode=type_code,
                typeLabel=document_type_label(type_code) or "Тип не указан",
                series=series,
                number=number,
                seriesAndNumber=series_and_number,
                createdOn=created_on,
                relationshipType=relationship_type,
            )
        )
    return views

# Core projection of the ТЗ-06 examination table; the queue read model already
# accounts for the examination separately from the confirmation (DATA-02) and
# works before that table ships.
_EXAMINATIONS = Table(
    "examinations",
    MetaData(),
    Column("id", SqlUUID(as_uuid=True)),
    Column("party_id", SqlUUID(as_uuid=True)),
    Column("status", String(20)),
)

# Raw probe helper kept minimal: only to_regclass probes are used.


class _UNSET:
    """Sentinel: the caller did not pass a bulk summary (single-read path)."""


def _escape_like(query: str) -> str:
    return re.sub(r"([\\%_])", r"\\\1", query.strip())


def _rec_exists() -> Any:
    return select(Reconciliation.id).where(Reconciliation.party_id == Party.id).exists()


def _conf_exists() -> Any:
    return select(ReceiptConfirmation.id).where(ReceiptConfirmation.party_id == Party.id).exists()


def _conf_positive_exists() -> Any:
    return (
        select(ReceiptConfirmation.id)
        .where(ReceiptConfirmation.party_id == Party.id, ReceiptConfirmation.accepted_quantity > 0)
        .exists()
    )


def _exam_done_exists() -> Any:
    return (
        select(_EXAMINATIONS.c.id)
        .where(_EXAMINATIONS.c.party_id == Party.id, _EXAMINATIONS.c.status == "COMPLETED")
        .exists()
    )


def _hidden_not_exists() -> Any:
    return (
        ~select(HiddenIncoming.contour)
        .where(
            HiddenIncoming.contour == IncomingDocument.contour,
            HiddenIncoming.evsd_uuid == IncomingDocument.evsd_uuid,
            HiddenIncoming.content_hash == IncomingDocument.content_hash,
        )
        .exists()
    )


async def _examinations_available(db: AsyncSession) -> bool:
    return (await db.execute(select(func.to_regclass("examinations")))).scalar() is not None


def _queue_condition(queue: str, exams_available: bool) -> Any:
    conf = _conf_exists()
    accepted = _conf_positive_exists()
    exam_done = _exam_done_exists() if exams_available else select(Party.id).where(sql_false()).exists()
    if queue == "EXPECTED":
        # ТЗ DR9 §6, уточнено решением владельца 2026-11-12: EXPECTED требует
        # наблюдаемой свежести источника CURRENT_CONFIRMED — устаревший документ
        # не возвращается в активную очередь. НАЧАТАЯ сверка (OPEN) НЕ выводит
        # документ из EXPECTED: сверка продолжается из EXPECTED.
        return ~conf & (IncomingDocument.source_presence == "CURRENT_CONFIRMED")
    if queue == "WORK":
        # Решение владельца 2026-11-12: «В работе» = только ВСД, погашенные
        # через систему (существует локальный ReceiptConfirmation).
        return conf & ~(accepted & exam_done)
    if queue == "ACCEPTED":
        return accepted & exam_done
    raise ValueError(f"Unknown queue {queue}")


def _result_condition(result: str, exams_available: bool) -> Any:
    if result == "WAITING":
        return _queue_condition("EXPECTED", exams_available)
    if result == "COMPLETED":
        return _queue_condition("ACCEPTED", exams_available)
    if result == "RETURNED":
        return (
            _conf_exists() & (ReceiptConfirmation.accepted_quantity == 0) & (ReceiptConfirmation.returned_quantity > 0)
        )
    raise ValueError(f"Unknown result {result}")


def _search_condition(query: str) -> Any:
    pattern = f"%{_escape_like(query)}%"
    snapshot = IncomingDocument.source_snapshot
    classification = Party.classification_snapshot
    issue_number = snapshot["vdDocument"]["issueNumber"].astext
    product_item = snapshot["vdDocument"]["batch"]["productItem"]["name"].astext
    product_name = classification["product"]["name"].astext
    from sqlalchemy import or_

    return or_(
        issue_number.ilike(pattern, escape="\\"),
        product_item.ilike(pattern, escape="\\"),
        product_name.ilike(pattern, escape="\\"),
        # The search finds a document by its UUID ВСД (full or partial).
        IncomingDocument.evsd_uuid.cast(String).ilike(pattern, escape="\\"),
    )


async def arrival_page(
    db: AsyncSession,
    *,
    laboratory_id: uuid.UUID,
    queue: str | None,
    result: str | None,
    query: str | None,
    page: int,
    sort: str | None = None,
    reconciled_from: datetime | None = None,
    reconciled_to: datetime | None = None,
) -> tuple[list[Party], list[IncomingDocument], int]:
    """A page of arrivals for one laboratory (API-01 paging semantics).

    ТЗ DR39 §3: ``reconciled_from/to`` (a half-open instant range computed
    from the user's московский day/period) filter the COMPLETED reconciliation
    date in SQL; the same WHERE serves the rows and ``total`` and both run
    BEFORE offset/limit. Sorting is queue-aware: EXPECTED sorts by the ВСД
    issue date (DR15), WORK/ACCEPTED by ``Reconciliation.completed_at`` —
    ``nulls last`` in BOTH directions, the stable tie-breaker stays
    ``Party.created_at DESC, Party.id DESC`` and the unique left join never
    duplicates a row.
    """
    exams_available = await _examinations_available(db)
    conditions: list[Any] = [
        Party.laboratory_id == laboratory_id,  # scope first — before count/search
        _hidden_not_exists(),
    ]
    label = queue.upper() if queue else None
    if label is not None:
        conditions.append(_queue_condition(label, exams_available))
    elif result is not None:
        conditions.append(_result_condition(result.upper(), exams_available))
    if query and query.strip():
        conditions.append(_search_condition(query))
    # ТЗ DR39: an active date filter excludes a NULL completed_at by itself
    # (a NULL comparison is never true) — no fictional rows ever pass.
    if reconciled_from is not None:
        conditions.append(Reconciliation.completed_at >= reconciled_from)
    if reconciled_to is not None:
        conditions.append(Reconciliation.completed_at < reconciled_to)
    where = conditions[0]
    for condition in conditions[1:]:
        where = where & condition

    reconciliation_join = Reconciliation.party_id == Party.id
    total = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Party)
                .join(IncomingDocument)
                .outerjoin(Reconciliation, reconciliation_join)
                .where(where)
            )
        ).scalar_one()
    )
    current = max(page, 1)
    # DR15 §5.3: the EXPECTED sort is the ВСД issue date from the source
    # snapshot. ТЗ DR39 §3: WORK/ACCEPTED sort by the COMPLETED reconciliation
    # date (never Party.created_at or a confirmation date) — missing dates
    # keep an explicit deterministic position at the END in both directions;
    # the stable tie-breaker stays Party.created_at DESC / id DESC.
    issue_date = IncomingDocument.source_snapshot["vdDocument"]["issueDate"].astext
    completed = Reconciliation.completed_at
    order: list[Any] = [Party.created_at.desc(), Party.id.desc()]
    if label in ("WORK", "ACCEPTED"):
        if sort == "asc":
            order.insert(0, completed.asc().nulls_last())
        else:  # default (and explicit desc): the latest completed сверка first.
            order.insert(0, completed.desc().nulls_last())
    elif sort == "asc":
        order.insert(0, issue_date.asc().nulls_last())
    else:  # default (and explicit desc): the newest issued ВСД first.
        order.insert(0, issue_date.desc().nulls_last())
    rows = await db.execute(
        select(Party, IncomingDocument)
        .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
        .outerjoin(Reconciliation, reconciliation_join)
        .where(where)
        .order_by(*order)
        .offset((current - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    parties: list[Party] = []
    documents: list[IncomingDocument] = []
    for party, document in rows.all():
        parties.append(party)
        documents.append(document)
    return parties, documents, total


async def party_view(db: AsyncSession, party_id: uuid.UUID) -> tuple[Party, IncomingDocument] | None:
    """Resolve one party inside its document for the single-read endpoint."""
    row = (
        await db.execute(
            select(Party, IncomingDocument)
            .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
            .where(Party.id == party_id)
        )
    ).first()
    if row is None:
        return None
    party, document = row
    return party, document


async def queue_of(
    db: AsyncSession,
    party: Party,
    has_reconciliation: bool,
    has_confirmation: bool,
) -> Literal["EXPECTED", "WORK", "ACCEPTED"]:
    """The query-time queue label of one party (DATA-02, owner decision 2026-11-12).

    «В работе» = только ВСД, погашенные через систему: начатая сверка не
    переводит документ в WORK — сверка продолжается из EXPECTED.
    """
    exams_available = await _examinations_available(db)
    if not has_confirmation:
        return "EXPECTED"
    positive = await _scalar(
        db, select(ReceiptConfirmation.accepted_quantity).where(ReceiptConfirmation.party_id == party.id)
    )
    if positive is not None and positive > 0:
        if exams_available and await _exam_done(db, party.id):
            return "ACCEPTED"
        return "WORK"
    return "WORK"


async def _scalar(db: AsyncSession, statement: Any) -> Any:
    return (await db.execute(statement)).scalar()


async def _exam_done(db: AsyncSession, party_id: uuid.UUID) -> bool:
    statement = (
        select(_EXAMINATIONS.c.id)
        .where(_EXAMINATIONS.c.party_id == party_id, _EXAMINATIONS.c.status == "COMPLETED")
        .limit(1)
    )
    return (await db.execute(statement)).scalar() is not None


async def started_flags(db: AsyncSession, party_id: uuid.UUID) -> tuple[bool, ReceiptConfirmation | None]:
    """(reconciliation started, confirmation row) for one party."""
    has_reconciliation = (
        await db.execute(select(func.count()).select_from(Reconciliation).where(Reconciliation.party_id == party_id))
    ).scalar()
    confirmation = (
        await db.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party_id))
    ).scalar_one_or_none()
    return bool(has_reconciliation), confirmation


def _classification_view(snapshot: dict[str, object]) -> ClassificationView:
    return ClassificationView.model_validate(snapshot, by_alias=True)


def _quantity_set(batch: dict[str, object]) -> QuantitySet:
    unit_raw = batch.get("unit")
    unit = unit_raw if isinstance(unit_raw, dict) else None
    # ТЗ DR8 R-DR8-1: the canonical identity is the SOURCE unit GUID stored as
    # an external reference in the normalized snapshot — never a local
    # dictionary `unit.id` lookup.
    unit_id = str(unit.get("guid") or "") if unit is not None else ""
    # The documentary quantity is the number of transport packages the source
    # carried (max-level packageList sum). An absent source quantity stays
    # ABSENT: the mass (`volume`) is a different entity and is NEVER
    # substituted, and no `0` is fabricated (ТЗ DR5 §5.2).
    quantity_raw = batch.get("quantity")
    quantity = str(quantity_raw) if quantity_raw not in (None, "") else ""
    return QuantitySet(
        mass_kg=str(batch.get("volume", "0")),
        quantity=quantity,
        unit_id=unit_id,
    )


def _unit_name(batch: dict[str, object]) -> str | None:
    """The optional display-only source unit name (ТЗ DR10 §5)."""
    unit = batch.get("unit")
    if not isinstance(unit, dict):
        return None
    name = unit.get("name")
    text = str(name).strip() if name is not None else ""
    return text or None


def _external_fields(
    document: IncomingDocument,
    *,
    purpose_name: str | None = None,
    purpose_guid: str | None = None,
    purpose_uuid: str | None = None,
    participant_fields: dict[str, str | None] | None = None,
) -> ExternalFields:
    payload = document.source_snapshot["vdDocument"]
    document_payload = payload if isinstance(payload, dict) else {}
    consignor_raw = document_payload.get("consignor")
    consignor = consignor_raw if isinstance(consignor_raw, dict) else {}
    consignee_raw = document_payload.get("consignee")
    consignee = consignee_raw if isinstance(consignee_raw, dict) else {}
    batch_raw = document_payload.get("batch")
    batch = batch_raw if isinstance(batch_raw, dict) else {}
    product_item_raw = batch.get("productItem")
    product_item = product_item_raw if isinstance(product_item_raw, dict) else None
    transport_document_raw = document_payload.get("transportDocument")
    transport_document = transport_document_raw if isinstance(transport_document_raw, dict) else {}
    fields: dict[str, str | None] = {
        # Deprecated alias with ONE fixed meaning: the blank issueNumber. The
        # UUID ВСД is `documentUuid`/`evsd_uuid` — never this field.
        "documentNumber": str(document_payload.get("issueNumber") or ""),
        "documentUuid": str(document.evsd_uuid),
        "issuedOn": document_payload.get("issueDate") or None,
        "status": document.external_status,
        # Russian label projection (single backend owner, vetis.status).
        "statusLabel": status_label(document.external_status),
        # The purpose NAME is resolved from the contour-scoped local dictionary;
        # the identifiers stay as backend requisites, never shown as text.
        "purpose": purpose_name,
        "purposeGuid": purpose_guid,
        "purposeUuid": purpose_uuid,
        "transportNumber": document_payload.get("transportNumber") or None,
        # ТЗ DR17 §5.2: the separate vehicle/trailer keys; an absent trailer
        # publishes the agreed informational text «Прицеп отсутствует».
        "vehicleNumber": document_payload.get("transportNumber") or None,
        "trailerNumber": trailer_projection(document_payload.get("trailerNumber")),
        # ТЗ DR16 §5.3: the raw storage code stays with the Russian label in
        # the read model; old fields keep their meanings (R-DR16-4).
        "storageCode": document_payload.get("transportStorageType") or None,
        "storage": storage_type_label(document_payload.get("transportStorageType")),
        # ТЗ DR19 §4.2: the raw transport-type code stays AS A STRING next to
        # the Russian label (one dictionary, vetis.transport_types); an absent
        # node stays absent (no fictitious mark), an unknown code keeps the
        # source value and renders the honest fallback (R-DR19-3/4).
        "transportTypeCode": document_payload.get("transportType") or None,
        "transportType": transport_type_label(document_payload.get("transportType")),
        # The top-level eVSD reference is the consignment waybill.  Research
        # documents are excluded by the normalizer and never reach this field.
        "transportDocumentType": document_type_label(
            str(transport_document.get("type")) if transport_document.get("type") is not None else None
        ),
        "transportDocumentNumber": (
            str(transport_document.get("issueNumber"))
            if transport_document.get("issueNumber") not in (None, "")
            else None
        ),
        "transportDocumentIssuedOn": (
            str(transport_document.get("issueDate"))
            if transport_document.get("issueDate") not in (None, "")
            else None
        ),
        "consignor": str(consignor.get("name") or ""),
        "consignee": str(consignee.get("name") or ""),
        "productItem": str(product_item.get("name") or "") if product_item is not None else None,
        # ТЗ DR10 §5: the optional display name of the source unit; its
        # absence does NOT mean the unit is missing (the GUID is the identity).
        "unitName": _unit_name(batch),
        # DR20 §6: the typed production/expiry read model — machine-readable
        # ISO calendar dates + the informal source text; a single date fills
        # only ``producedOn``/``expiresOn``, an interval only From/To, an
        # informal value only ``…Informal``; the type never collapses.
        **goods_date_fields(batch, "producedOn"),
        **goods_date_fields(batch, "expiresOn"),
        **previous_vse_fields(document.source_snapshot),
        # ТЗ DR18 §9: the unified read model of the participant names (old
        # keys keep their single meaning; each name carries its honest state
        # under ``<key>NameSource``). The values come from the contour-scoped
        # local cache — the browser never reaches VetIS.
        **(participant_fields or {}),
    }
    return ExternalFields(
        contour=document.contour,
        evsd_uuid=str(document.evsd_uuid),
        status=document.external_status,
        fields=fields,
        # ТЗ DR40 §6: the typed accompanying documents (keys + Russian labels
        # owned by the backend registry; the flat legacy fields above stay).
        accompanying_documents=accompanying_documents_of(document_payload),
    )


def _confirmation_summary(confirmation: ReceiptConfirmation) -> ConfirmationSummary:
    return ConfirmationSummary(
        id=str(confirmation.id),
        accepted_mass_kg=str(confirmation.accepted_mass_kg),
        accepted_quantity=str(confirmation.accepted_quantity),
        accepted_unit_id=confirmation.accepted_unit_id,
        returned_mass_kg=str(confirmation.returned_mass_kg),
        returned_quantity=str(confirmation.returned_quantity),
        confirmed_at=confirmation.confirmed_at,
    )


# --- ТЗ DR39: the compact server-side reconciliation summary ----------------------


def _summary_of(reconciliation: Reconciliation, author_name: str | None) -> ReconciliationSummary:
    """The read-model summary of one saved reconciliation row.

    The frozen ``pricing_snapshot`` is validated through the existing strict
    ``PricingSnapshot`` schema — never re-computed and never rebuilt as a
    loosely typed dict. A corrupt stored value keeps an honest absence.
    """
    pricing = None
    if reconciliation.pricing_snapshot is not None:
        try:
            pricing = PricingSnapshot.model_validate(reconciliation.pricing_snapshot)
        except Exception:  # noqa: BLE001 - a corrupt legacy value stays absent
            pricing = None
    return ReconciliationSummary(
        completed_at=reconciliation.completed_at,
        author_name=author_name,
        pricing=pricing,
    )


async def reconciliation_summaries(
    db: AsyncSession,
    party_ids: list[uuid.UUID],
) -> dict[uuid.UUID, ReconciliationSummary]:
    """The reconciliation summaries of one PAGE in ONE SQL read (no N+1).

    One join against ``users`` resolves the author ``full_name`` of every row
    by ``actor_id`` (CHK-F33): the client never receives a raw id to resolve
    and the list read never calls a user endpoint nor any VetIS/SOAP service.
    """
    if not party_ids:
        return {}
    rows = await db.execute(
        select(Reconciliation, User.full_name)
        .join(User, User.id == Reconciliation.actor_id, isouter=True)
        .where(Reconciliation.party_id.in_(party_ids))
    )
    return {
        reconciliation.party_id: _summary_of(reconciliation, author_name)
        for reconciliation, author_name in rows.all()
    }


async def _open_examination_id(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID | None:
    if not await _examinations_available(db):
        return None
    return (await db.execute(select(_EXAMINATIONS.c.id).where(_EXAMINATIONS.c.party_id == party_id).limit(1))).scalar()


# --- ТЗ DR44 §2: the bulk examination summary (no N+1, no VetIS) -------------------


def combined_total_of(
    reconciliation_total: str | None,
    reconciliation_currency: str | None,
    examination_total: str | None,
    examination_currency: str | None,
) -> str | None:
    """ТЗ DR44 §2: the server-side Decimal sum of the two frozen totals.

    The sum exists ONLY when both totals are present and the currencies match;
    a missing обязательный component is never substituted by zero and a saved
    ``0.00`` stays data. The result is a scale-2 decimal string.
    """
    if reconciliation_total is None or examination_total is None:
        return None
    if reconciliation_currency != examination_currency:
        return None
    combined = Decimal(reconciliation_total) + Decimal(examination_total)
    return str(combined.quantize(Decimal("0.01")))


def _examination_summary_of(
    examination: Examination,
    legacy_specialist_name: str | None,
    reconciliation_pricing: PricingSnapshot | None,
) -> ExaminationSummary:
    pricing: PricingSnapshot | None = None
    if examination.pricing_snapshot is not None:
        try:
            pricing = PricingSnapshot.model_validate(examination.pricing_snapshot)
        except Exception:  # noqa: BLE001 - a corrupt legacy value stays absent
            pricing = None
    # The frozen selected ФИО wins; a legacy row keeps ONLY the existing
    # server fallback (the resolved display name) — never created_by-as-login,
    # never a UUID and never the current user.
    specialist_name = examination.specialist_name or legacy_specialist_name
    total = combined_total_of(
        reconciliation_pricing.total if reconciliation_pricing is not None else None,
        reconciliation_pricing.currency if reconciliation_pricing is not None else None,
        pricing.total if pricing is not None else None,
        pricing.currency if pricing is not None else None,
    )
    currency = None
    if (
        pricing is not None
        and reconciliation_pricing is not None
        and pricing.currency == reconciliation_pricing.currency
    ):
        currency = pricing.currency
    return ExaminationSummary(
        id=str(examination.id),
        number=examination.number,
        status=examination.status,
        outcome=examination.outcome,
        specialist_name=specialist_name,
        pricing=pricing,
        combined_total=total,
        currency=currency,
    )


async def examination_summaries(
    db: AsyncSession,
    party_ids: list[uuid.UUID],
    reconciliation_pricings: dict[uuid.UUID, PricingSnapshot | None] | None = None,
) -> dict[uuid.UUID, ExaminationSummary]:
    """The examination summaries of one PAGE in ONE SQL read (no N+1).

    One join against ``users`` resolves the legacy display name of a pre-DR35
    row; the frozen ``specialist_name`` of newer rows is never recomputed. The
    frozen сверка totals arrive already validated (``reconciliation_summaries``)
    — no second validation pass, no VetIS call, no per-row query.
    """
    if not party_ids or not await _examinations_available(db):
        return {}
    rows = await db.execute(
        select(Examination, User.full_name)
        .join(User, User.id == func.coalesce(Examination.specialist_id, Examination.created_by), isouter=True)
        .where(Examination.party_id.in_(party_ids))
    )
    pricings = reconciliation_pricings or {}
    return {
        examination.party_id: _examination_summary_of(
            examination, legacy_name, pricings.get(examination.party_id)
        )
        for examination, legacy_name in rows.all()
    }


async def build_incoming_view(
    db: AsyncSession,
    party: Party,
    document: IncomingDocument,
    *,
    reconciliation_summary: ReconciliationSummary | None | _UNSET = _UNSET(),
    examination_summary: ExaminationSummary | None | _UNSET = _UNSET(),
) -> IncomingView:
    """The API-04 ``IncomingView`` of one arrival.

    ``reconciliation_summary`` carries the page's bulk read (ТЗ DR39);
    ``examination_summary`` carries the page's bulk ВСЭ read (ТЗ DR44). The
    default sentinels load the summaries of this one party with one query each
    for the single-read endpoint.
    """
    if isinstance(reconciliation_summary, _UNSET):
        summary = (await reconciliation_summaries(db, [party.id])).get(party.id)
    else:
        summary = reconciliation_summary
    if isinstance(examination_summary, _UNSET):
        exam_summary = (
            await examination_summaries(
                db,
                [party.id],
                {party.id: summary.pricing if summary is not None else None},
            )
        ).get(party.id)
    else:
        exam_summary = examination_summary
    has_reconciliation, confirmation = await started_flags(db, party.id)
    document_payload = document.source_snapshot["vdDocument"]
    batch = document_payload["batch"] if isinstance(document_payload, dict) else {}
    batch = cast(dict[str, object], batch if isinstance(batch, dict) else {})
    examination_id = await _open_examination_id(db, party.id)
    queue_label = await queue_of(db, party, has_reconciliation, confirmation is not None)
    purpose_name, purpose_guid, purpose_uuid = await _resolve_purpose(db, document, document_payload)
    # ТЗ DR18 §6/§9: the unified read model of the participant names — cache
    # only, never a VetIS request per view.
    participants = await resolve_participants(db, VetisContour(document.contour), document.source_snapshot)
    return IncomingView(
        id=str(document.id),
        party_id=str(party.id),
        laboratory_id=str(party.laboratory_id),
        external=_external_fields(
            document,
            purpose_name=purpose_name,
            purpose_guid=purpose_guid,
            purpose_uuid=purpose_uuid,
            participant_fields=participant_name_overrides(participants),
        ),
        classification=_classification_view(dict(party.classification_snapshot)),
        documentary=_quantity_set(batch),
        confirmation=_confirmation_summary(confirmation) if confirmation is not None else None,
        reconciliation=summary,
        queue=queue_label,
        examination_id=str(examination_id) if examination_id is not None else None,
        examination=exam_summary,
        revision=party.rev,
        # ТЗ DR9 §6: freshness is shown SEPARATELY from the local queue state;
        # the list gate (arrival_page) already excludes stale rows from EXPECTED.
        source_presence=cast(
            Literal["CURRENT_CONFIRMED", "NOT_IN_CURRENT_CONFIRMED_LIST", "UNKNOWN"], document.source_presence
        ),
        last_seen_sync_at=document.last_seen_sync_at,
        source_presence_reason=document.source_presence_reason,
    )


# Honest UI fallback for a purpose GUID absent from the local dictionary
# (ТЗ DR5 §9.1): the import is never rejected and the raw GUID never surfaces.
PURPOSE_NOT_FOUND_TEXT = "Назначение не найдено в справочнике"

_PURPOSE_LOG = logging.getLogger("vetis.purpose")


async def _resolve_purpose(
    db: AsyncSession,
    document: IncomingDocument,
    document_payload: object,
) -> tuple[str | None, str | None, str | None]:
    """Resolve the purpose name inside the SAME contour (contour isolation).

    A GUID/UUID the snapshot carries but the dictionary does not know keeps
    the import intact: the identifiers stay in the API, the UI receives the
    honest fallback text and a structured diagnostic is recorded (no secrets,
    no SOAP payloads).
    """
    payload = document_payload if isinstance(document_payload, dict) else {}
    purpose_raw = payload.get("purpose")
    purpose = purpose_raw if isinstance(purpose_raw, dict) else {}
    guid = purpose.get("guid")
    purpose_uuid = purpose.get("uuid")
    if not guid and not purpose_uuid:
        return None, None, None
    name: str | None = None
    try:
        key = uuid.UUID(str(guid)) if guid else uuid.UUID(str(purpose_uuid))
    except ValueError:
        key = None
    if key is not None:
        name = await find_purpose_name(db, VetisContour(document.contour), key)
    if name is None:
        _PURPOSE_LOG.warning(
            "purpose_dictionary_miss",
            extra={
                "contour": str(document.contour),
                "purpose_guid": str(guid) if guid else None,
                "evsd_uuid": str(document.evsd_uuid),
            },
        )
        return PURPOSE_NOT_FOUND_TEXT, str(guid) if guid else None, str(purpose_uuid) if purpose_uuid else None
    return name, str(guid) if guid else None, str(purpose_uuid) if purpose_uuid else None
