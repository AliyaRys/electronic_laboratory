"""Arrival read models (API-04): queues as query-time classification.

The scope filter (``laboratory_id``) is applied to the same WHERE as count and
search and is built first — no foreign row can ever be counted. Queue labels
are derived per request from actual table state (started reconciliation,
receipt confirmation, completed examination), never stored.
"""

from __future__ import annotations

import logging
import re
import uuid
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
    ClassificationView,
    ConfirmationSummary,
    ExternalFields,
    IncomingView,
    QuantitySet,
)
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.queries import find_purpose_name
from backend.src.modules.integrations.vetis.status import status_label

__all__ = [
    "PAGE_SIZE",
    "arrival_page",
    "build_incoming_view",
    "party_view",
    "previous_vse_fields",
    "queue_of",
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
    rec = _rec_exists()
    conf = _conf_exists()
    accepted = _conf_positive_exists()
    exam_done = _exam_done_exists() if exams_available else select(Party.id).where(sql_false()).exists()
    if queue == "EXPECTED":
        return ~rec & ~conf
    if queue == "WORK":
        return (rec | conf) & ~(accepted & exam_done)
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
) -> tuple[list[Party], list[IncomingDocument], int]:
    """A page of arrivals for one laboratory (API-01 paging semantics)."""
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
    where = conditions[0]
    for condition in conditions[1:]:
        where = where & condition

    total = int(
        (await db.execute(select(func.count()).select_from(Party).join(IncomingDocument).where(where))).scalar_one()
    )
    current = max(page, 1)
    rows = await db.execute(
        select(Party, IncomingDocument)
        .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
        .where(where)
        .order_by(Party.created_at.desc(), Party.id.desc())
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
    """The query-time queue label of one party (DATA-02)."""
    exams_available = await _examinations_available(db)
    if not has_reconciliation and not has_confirmation:
        return "EXPECTED"
    if has_confirmation:
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


def _external_fields(
    document: IncomingDocument,
    *,
    purpose_name: str | None = None,
    purpose_guid: str | None = None,
    purpose_uuid: str | None = None,
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
        "consignor": str(consignor.get("name") or ""),
        "consignee": str(consignee.get("name") or ""),
        "productItem": str(product_item.get("name") or "") if product_item is not None else None,
        **previous_vse_fields(document.source_snapshot),
    }
    return ExternalFields(
        contour=document.contour,
        evsd_uuid=str(document.evsd_uuid),
        status=document.external_status,
        fields=fields,
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


async def _open_examination_id(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID | None:
    if not await _examinations_available(db):
        return None
    return (await db.execute(select(_EXAMINATIONS.c.id).where(_EXAMINATIONS.c.party_id == party_id).limit(1))).scalar()


async def build_incoming_view(
    db: AsyncSession,
    party: Party,
    document: IncomingDocument,
) -> IncomingView:
    """The API-04 ``IncomingView`` of one arrival."""
    has_reconciliation, confirmation = await started_flags(db, party.id)
    document_payload = document.source_snapshot["vdDocument"]
    batch = document_payload["batch"] if isinstance(document_payload, dict) else {}
    batch = cast(dict[str, object], batch if isinstance(batch, dict) else {})
    examination_id = await _open_examination_id(db, party.id)
    queue_label = await queue_of(db, party, has_reconciliation, confirmation is not None)
    purpose_name, purpose_guid, purpose_uuid = await _resolve_purpose(db, document, document_payload)
    return IncomingView(
        id=str(document.id),
        party_id=str(party.id),
        laboratory_id=str(party.laboratory_id),
        external=_external_fields(
            document,
            purpose_name=purpose_name,
            purpose_guid=purpose_guid,
            purpose_uuid=purpose_uuid,
        ),
        classification=_classification_view(dict(party.classification_snapshot)),
        documentary=_quantity_set(batch),
        confirmation=_confirmation_summary(confirmation) if confirmation is not None else None,
        queue=queue_label,
        examination_id=str(examination_id) if examination_id is not None else None,
        revision=party.rev,
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
