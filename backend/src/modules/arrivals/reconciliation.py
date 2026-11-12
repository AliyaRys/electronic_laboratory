"""The saved-reconciliation command (API-04 / DATA-02 / ADR-017).

``save_reconciliation`` is the single coordinator of the started
reconciliation: it locks the party, enforces the ETag sequence (the party
revision for the first save, the reconciliation revision afterwards), claims
the idempotency record, refuses a decision the current grounds forbid, and
persists the doctor's facts as one ``OPEN`` row.

The state machine moves to CONFIRMED/RETURNED only through the external
receipt confirmation (ТЗ-11/A03), so a started reconciliation may be
incomplete and is saved separately (O-09, FT-ARR-02); completion requires the
full validation that the receipt command runs before any intent. The CHK
inputs without dedicated DATA-02 columns (inspection F13/F14, return reason
F35) are stored inside the ``checks`` JSONB under their CHK IDs, so the
migration stays the contract source.
"""

from __future__ import annotations

from typing import Literal, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import IdempotencyRecorder, UnitOfWork, canonical_request_hash, ensure_revision
from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError, not_found, validation_error
from backend.src.modules.arrivals.models import IncomingDocument as IncomingDocumentRow
from backend.src.modules.arrivals.models import Party, Reconciliation
from backend.src.modules.arrivals.queries import previous_vse_fields
from backend.src.modules.arrivals.schemas import (
    ActPreview,
    ClassificationView,
    Comparison,
    Inspection,
    QuantitySet,
    ReconciliationView,
    ReconciliationWrite,
    Repeat,
    ReturnReason,
    ServiceItem,
    SourceSnapshot,
    Transaction,
)
from backend.src.modules.arrivals.validation import (
    FIELD_REGISTRY,
    IncomingDocument,
    ReceiptCapabilities,
    normalize_payload,
    validate_receipt,
)
from backend.src.modules.catalog_pricing.schemas import PricingRequest, PricingSnapshot
from backend.src.modules.catalog_pricing.service import configuration_missing, evaluate_and_price
from backend.src.modules.integrations.vetis.status import status_label

__all__ = ["save_reconciliation", "build_reconciliation_view", "load_reconciliation", "source_projection"]

CAPABILITIES = ReceiptCapabilities()

# CHK IDs persisted inside the checks JSONB without a dedicated DATA-02 column.
_INSPECTION_KEYS = ("CHK-F13", "CHK-F14")
_REASON_KEY = "CHK-F35"

# ТЗ DR11 §4.1: the exact codes of the two paid reconciliation services;
# no Russian-name duplicates and no VSE research tariffs ever enter here.
CHECK_SERVICE_CODES = ("PRODUCT_IDENTIFICATION", "TRANSPORT_INSPECTION")


def _ref_name(entry: object) -> str | None:
    if not isinstance(entry, dict):
        return None
    name = entry.get("name")
    return str(name) if name else None


def _entry_actual(entry: object) -> str | None:
    if not isinstance(entry, dict):
        return None
    actual = entry.get("actual")
    return None if actual is None else str(actual)


def _as_dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def source_projection(row: IncomingDocumentRow, party: Party) -> IncomingDocument:
    """The CHK source projection from the stored snapshot + classification.

    A value the snapshot does not carry stays absent: informational absence
    never demands a fictitious mark (FT-ARR-03). The fourth-level
    ``productItem.name`` is the CHK-F18 «Название продукции», never the
    second-level product name.
    """
    snapshot: dict[str, object] = _as_dict(row.source_snapshot)
    payload = _as_dict(snapshot.get("vdDocument"))
    consignor = _as_dict(payload.get("consignor"))
    consignee = _as_dict(payload.get("consignee"))
    batch = _as_dict(payload.get("batch"))
    unit = _as_dict(batch.get("unit"))
    classification = ClassificationView.model_validate(dict(party.classification_snapshot), by_alias=True)

    def enterprise_name(holder: dict[str, object]) -> str | None:
        return _ref_name(holder.get("enterprise")) or (str(holder.get("name") or "") or None)

    def text_of(value: object) -> str | None:
        return None if value is None else str(value)

    fields: dict[str, str | int | None] = {
        "documentNumber": str(payload.get("issueNumber") or ""),
        "documentUuid": str(row.evsd_uuid),
        "issuedOn": text_of(payload.get("issueDate")),
        "status": text_of(payload.get("status")),
        # Russian label projection; the RAW code above keeps driving rules.
        "statusLabel": status_label(row.external_status),
        "purpose": None,
        "senderEnterprise": enterprise_name(consignor),
        "senderOwner": _ref_name(consignor.get("businessEntity")),
        "receiverEnterprise": enterprise_name(consignee),
        "receiverOwner": _ref_name(consignee.get("businessEntity")),
        "transportKind": None,
        "vehicleNumber": text_of(payload.get("transportNumber")),
        "trailerNumber": None,
        "storage": None,
        "productType": classification.product_type,
        "product": classification.product.name,
        "species": classification.sub_product.name if classification.sub_product is not None else None,
        "name": classification.product_item.name if classification.product_item is not None else None,
        "manufacturer": None,
        "quantity": text_of(batch.get("quantity")),
        "massKg": text_of(batch.get("volume")),
        # ТЗ DR8 R-DR8-1: the unit GUID is the identity published to the
        # validator (CHK-F20), the NAME is the read-only UI label only.
        "unitId": text_of(unit.get("guid")) if isinstance(unit, dict) else None,
        "unitName": _ref_name(unit),
        "producedOn": None,
        "expiresOn": None,
        "transportDocumentType": None,
        "transportDocumentNumber": None,
        "transportDocumentIssuedOn": None,
        **previous_vse_fields(row.source_snapshot),
    }
    return IncomingDocument(
        snapshot=SourceSnapshot.model_validate(row.source_snapshot),
        classification=classification,
        fields=fields,
    )


def _quantities(row: Reconciliation, source_unit_id: str = "") -> tuple[QuantitySet, QuantitySet, QuantitySet]:
    """ТЗ DR10 §5: the view of a saved row shows the source GUID whenever the
    snapshot carries one (the same normalization the save path persists); a
    mismatching saved GUID never survives into the visible state."""
    unit_id_of = lambda saved: source_unit_id or saved  # noqa: E731
    return (
        QuantitySet(
            mass_kg=str(row.delivered_mass_kg),
            quantity=str(row.delivered_quantity),
            unit_id=unit_id_of(row.delivered_unit_id or ""),
        ),
        QuantitySet(
            mass_kg=str(row.accepted_mass_kg),
            quantity=str(row.accepted_quantity),
            unit_id=unit_id_of(row.accepted_unit_id or ""),
        ),
        QuantitySet(
            mass_kg=str(row.returned_mass_kg),
            quantity=str(row.returned_quantity),
            unit_id=unit_id_of(row.returned_unit_id or ""),
        ),
    )


def row_to_payload(row: Reconciliation) -> ReconciliationWrite:
    """The saved facts as a write payload (marks only; the CHK inputs come
    back from their JSONB entries), used to re-run the validator on read."""
    row_type = cast('Literal["INTERNAL", "EXTERNAL"] | None', row.transaction_type)
    stored = dict(row.checks or {})
    marks = {
        key: Comparison.model_validate(value)
        for key, value in stored.items()
        if key in FIELD_REGISTRY and FIELD_REGISTRY[key].ground in ("act", "inadmissible")
    }
    compartment = _entry_actual(stored.get("CHK-F13"))
    joint = _entry_actual(stored.get("CHK-F14"))
    reason_entry = stored.get(_REASON_KEY)
    delivered, accepted, returned = _quantities(row)
    return ReconciliationWrite(
        checks=marks,
        inspection=Inspection(
            compartment=cast('Literal["COMPLIANT", "DIRTY_OR_DAMAGED"] | None', compartment),
            joint_carriage=cast('Literal["NONE", "SEPARATED", "NOT_SEPARATED"] | None', joint),
        ),
        delivered=delivered,
        accepted=accepted,
        returned=returned,
        decision=row.decision,  # type: ignore[arg-type]
        return_reason=(
            ReturnReason(code=str(reason_entry.get("actual") or ""), text=reason_entry.get("reason"))
            if isinstance(reason_entry, dict) and reason_entry.get("actual")
            else None
        ),
        repeat=(
            Repeat(required=bool(row.repeated_required), reason=row.repeat_reason, act_number=row.repeat_act_number)
            if row.repeated_required is not None
            else None
        ),
        transaction=Transaction(planned=row.transaction_planned, type=row_type),
        fair=row.fair,
        services=[ServiceItem.model_validate(item) for item in row.services],
    )


def _reason_view(row: Reconciliation) -> ReturnReason | None:
    entry = dict(row.checks or {}).get(_REASON_KEY)
    if isinstance(entry, dict) and entry.get("actual"):
        return ReturnReason(code=str(entry.get("actual") or ""), text=entry.get("reason"))
    return None


def _source_unit_id(document_row: IncomingDocumentRow) -> str:
    """ТЗ DR8 R-DR8-1: the source unit GUID of the normalized snapshot."""
    payload = document_row.source_snapshot.get("vdDocument")
    payload = payload if isinstance(payload, dict) else {}
    batch = payload.get("batch")
    batch = batch if isinstance(batch, dict) else {}
    unit = batch.get("unit")
    return str(unit.get("guid") or "") if isinstance(unit, dict) else ""


def build_reconciliation_view(
    row: Reconciliation | None,
    party: Party,
    document_row: IncomingDocumentRow,
) -> ReconciliationView:
    """The API-04 ``ReconciliationView``; a not-yet-created reconciliation is
    an empty ``OPEN`` view whose revision carries the parent (party) ETag."""
    if row is None:
        # ТЗ DR8 R-DR8-1: a NEW reconciliation inherits the source unit GUID
        # into all three QuantitySets; the user never types a unit.
        unit_id = _source_unit_id(document_row)
        return ReconciliationView(
            id="",
            party_id=str(party.id),
            revision=party.rev,
            state="OPEN",
            checks={},
            inspection=Inspection(),
            delivered=QuantitySet(mass_kg="0", quantity="0", unit_id=unit_id),
            accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=unit_id),
            returned=QuantitySet(mass_kg="0", quantity="0", unit_id=unit_id),
            decision=None,
            return_reason=None,
            repeat=None,
            transaction=Transaction(),
            fair=False,
            services=[],
            actor_id="",
            saved_at=party.created_at,
            completed_at=None,
            allowed_decisions=[],
            act=ActPreview(required=False, items=[]),
            route=None,
            errors=[],
            complete=False,
        )
    payload = row_to_payload(row)
    validation = validate_receipt(payload, source_projection(document_row, party), CAPABILITIES)
    delivered, accepted, returned = _quantities(row, _source_unit_id(document_row))
    return ReconciliationView(
        id=str(row.id),
        party_id=str(row.party_id),
        revision=row.rev,
        state=row.state,  # type: ignore[arg-type]
        checks=dict(payload.checks),
        inspection=payload.inspection,
        delivered=delivered,
        accepted=accepted,
        returned=returned,
        decision=row.decision,  # type: ignore[arg-type]
        return_reason=_reason_view(row),
        repeat=(
            Repeat(required=bool(row.repeated_required), reason=row.repeat_reason, act_number=row.repeat_act_number)
            if row.repeated_required is not None
            else None
        ),
        transaction=Transaction(
            planned=row.transaction_planned,
            type=cast('Literal["INTERNAL", "EXTERNAL"] | None', row.transaction_type),
        ),
        fair=row.fair,
        services=[ServiceItem.model_validate(item) for item in row.services],
        pricing=(
            PricingSnapshot.model_validate(row.pricing_snapshot) if row.pricing_snapshot is not None else None
        ),
        actor_id=str(row.actor_id),
        saved_at=row.saved_at,
        completed_at=row.completed_at,
        allowed_decisions=validation.allowed_decisions,  # type: ignore[arg-type]
        act=validation.act,
        route=validation.route,  # type: ignore[arg-type]
        errors=validation.all_errors(),
        complete=validation.complete,
    )


def _party_species_id(party: Party) -> UUID:
    """ТЗ DR11 §4.2: the exact species scope of the party's tariffs.

    The identity is the level-2 ``product.id`` of the stored classification
    snapshot — the SAME species scope the working screens authorize with
    (``_product_scope`` in examinations/documents) and the tariff catalog is
    scoped by. A snapshot without a usable GUID cannot be priced honestly:
    CONFIGURATION_MISSING, never a foreign-scope tariff and never a silent
    zero.
    """
    snapshot = party.classification_snapshot if isinstance(party.classification_snapshot, dict) else {}
    product = snapshot.get("product")
    raw = product.get("id") if isinstance(product, dict) else None
    try:
        return UUID(str(raw))
    except (ValueError, TypeError):
        raise configuration_missing(
            "Расчёт услуг сверки требует вид продукции партии; классификация эВСД не определила его.",
            path="product_species_id",
            field_id="CHECK",
        ) from None


async def _price_check_services(
    work: UnitOfWork, party: Party, saved: ReconciliationWrite
) -> PricingSnapshot:
    """ТЗ DR11 §5: the server-side pricing of the two CHECK services.

    Runs after the reconciliation validation, before any commit; the result is
    stored atomically with the facts and returned in the view. The client
    never supplies a tariff, an amount or a total (R-DR11-3).
    """
    request = PricingRequest(
        party_id=party.id,
        laboratory_id=party.laboratory_id,
        context="CHECK",
        performed=list(CHECK_SERVICE_CODES),
        fair=saved.fair,
        product_species_id=_party_species_id(party),
        accepted_quantity=saved.accepted.quantity,
        accepted_unit_id=saved.accepted.unit_id,
        delivered_quantity=saved.delivered.quantity,
        delivered_unit_id=saved.delivered.unit_id,
        decision=saved.decision,
    )
    return await evaluate_and_price(work, request, None)


def _checks_storage(payload: ReconciliationWrite) -> dict[str, dict[str, object]]:
    """The ``checks`` JSONB: doctor's marks + the input CHK entries (F13/14/35)."""
    storage: dict[str, dict[str, object]] = {
        key: comparison.model_dump(mode="json") for key, comparison in payload.checks.items()
    }
    if payload.inspection.compartment is not None:
        storage["CHK-F13"] = {"matches": True, "actual": payload.inspection.compartment}
    if payload.inspection.joint_carriage is not None:
        storage["CHK-F14"] = {"matches": True, "actual": payload.inspection.joint_carriage}
    if payload.return_reason is not None:
        storage[_REASON_KEY] = {
            "matches": True,
            "actual": payload.return_reason.code,
            "reason": payload.return_reason.text,
        }
    return storage


def _quantities_of(payload: ReconciliationWrite) -> dict[str, str]:
    return {
        "delivered_mass_kg": payload.delivered.mass_kg,
        "delivered_quantity": payload.delivered.quantity,
        "delivered_unit_id": payload.delivered.unit_id,
        "accepted_mass_kg": payload.accepted.mass_kg,
        "accepted_quantity": payload.accepted.quantity,
        "accepted_unit_id": payload.accepted.unit_id,
        "returned_mass_kg": payload.returned.mass_kg,
        "returned_quantity": payload.returned.quantity,
        "returned_unit_id": payload.returned.unit_id,
    }


async def save_reconciliation(
    ctx: CommandContext,
    party_id: UUID,
    payload: ReconciliationWrite,
    *,
    uow: UnitOfWork | AsyncSession,
) -> ReconciliationView:
    """Save one started reconciliation (SPEC-04: lock → ETag → idempotency → facts)."""
    db = uow.session if isinstance(uow, UnitOfWork) else uow
    work = uow if isinstance(uow, UnitOfWork) else UnitOfWork(db)
    party = (await db.execute(select(Party).where(Party.id == party_id).with_for_update())).scalar_one_or_none()
    if party is None:
        raise not_found("Поступление не найдено.")
    row = (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party_id).with_for_update())
    ).scalar_one_or_none()
    # If-Match is checked before the frozen-state guard: a stale client learns
    # that the revision moved (409 REVISION_CONFLICT); a client holding the
    # current revision learns the state is frozen (409 STATE_CONFLICT,
    # FT-ARR-15). The reconciliation revision moves when the external receipt
    # confirmation (confirmation.py) freezes the row.
    ensure_revision(ctx.expected_revision, party.rev if row is None else row.rev)
    if row is not None and row.state != "OPEN":
        # FT-ARR-15: an already confirmed decision is never overwritten by an
        # old open form; the frozen snapshot owns the downstream work.
        raise ProblemError(
            status=409,
            code="STATE_CONFLICT",
            title="State conflict",
            detail="Сверка уже подтверждена внешним результатом и не меняется обычным сохранением.",
        )

    recorder = IdempotencyRecorder()
    request_hash = canonical_request_hash(payload.model_dump(mode="json", by_alias=True), ctx.expected_revision)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="reconciliation:save",
        context_id=party_id,
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    if record.status == "SUCCESS":
        # API-01 replay: the same key and hash answer the saved state.
        document_row = (
            await db.execute(select(IncomingDocumentRow).where(IncomingDocumentRow.id == party.incoming_document_id))
        ).scalar_one()
        return build_reconciliation_view(row, party, document_row)

    document_row = (
        await db.execute(select(IncomingDocumentRow).where(IncomingDocumentRow.id == party.incoming_document_id))
    ).scalar_one()
    # ТЗ DR8 R-DR8-1 / ТЗ DR10 §5: the source unit GUID is the canonical unit
    # identity — a NEW reconciliation inherits it into all three QuantitySets
    # (the client unit never overrides it) and an EXISTING one is normalized
    # from the immutable source snapshot before validation.
    saved = normalize_payload(payload)
    source_unit_id = _source_unit_id(document_row)
    if source_unit_id:
        # ТЗ DR10 §5/R-DR10-3 (fix round 1): the immutable source snapshot is
        # the single unit authority — an EMPTY, STALE or MISMATCHING unit in
        # any part is safely normalized to the source GUID (never a conflict
        # the user must guess); a save can never persist a unit that differs
        # from the source, so an XML with an empty/wrong unit is impossible.
        saved = saved.model_copy(
            update={
                "delivered": saved.delivered.model_copy(update={"unit_id": source_unit_id}),
                "accepted": saved.accepted.model_copy(update={"unit_id": source_unit_id}),
                "returned": saved.returned.model_copy(update={"unit_id": source_unit_id}),
            }
        )
    validation = validate_receipt(saved, source_projection(document_row, party), CAPABILITIES)
    if validation.blocking:
        raise validation_error(validation.blocking)

    # ТЗ DR11 §5/R-DR11-3: a FULL valid reconciliation MUST be priced on the
    # server before the commit; an incomplete started save stays without a
    # snapshot (O-09). A missing rule/tariff raises CONFIGURATION_MISSING —
    # the transaction aborts, nothing fake or zero is ever stored.
    snapshot = await _price_check_services(work, party, saved) if validation.complete else None

    if row is None:
        row = Reconciliation(party_id=party.id, checks={}, services=[], actor_id=ctx.actor_id, state="OPEN")
        db.add(row)
    row.checks = _checks_storage(saved)  # type: ignore[assignment]
    for column, value in _quantities_of(saved).items():
        setattr(row, column, value)
    row.decision = saved.decision
    row.transaction_planned = saved.transaction.planned
    row.transaction_type = None if saved.transaction.planned is not True else saved.transaction.type
    row.fair = saved.fair
    row.services = [item.model_dump(mode="json") for item in saved.services]  # type: ignore[assignment]
    row.repeated_required = None if saved.repeat is None else saved.repeat.required
    row.repeat_reason = None if saved.repeat is None or not saved.repeat.required else saved.repeat.reason
    row.repeat_act_number = None if saved.repeat is None or not saved.repeat.required else saved.repeat.act_number
    # CHK-F33: the first authorship is preserved across later saves; the row is
    # new → the current actor is the author.
    row.rev = (row.rev or 0) + 1
    if snapshot is not None:
        # Frozen with the facts (ADR-020): a later tariff change never
        # recalculates this stored snapshot; an incomplete re-save keeps the
        # previously frozen value untouched.
        row.pricing_snapshot = snapshot.model_dump(mode="json")  # type: ignore[assignment]
    await db.flush()
    await recorder.complete(work, record, row.id)
    return build_reconciliation_view(row, party, document_row)


async def load_reconciliation(db: AsyncSession, party_id: UUID) -> Reconciliation | None:
    """The saved reconciliation of one party (read path)."""
    return (await db.execute(select(Reconciliation).where(Reconciliation.party_id == party_id))).scalar_one_or_none()
