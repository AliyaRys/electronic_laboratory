"""Frozen receipt preview and durable queue command (W01)."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.arrivals.models import IncomingDocument, Party, Reconciliation
from backend.src.modules.identity.models import OutboxEntry
from backend.src.modules.integrations.vetis.contracts import (
    ReceiptIntent,
    ReceiptPreview,
    UserConfirmation,
)
from backend.src.modules.integrations.vetis.models import (
    VetisBinding,
    VetisContour,
    VetisOperation,
    VetisOperationKind,
    VetisOperationState,
    VetisSourceDocument,
)
from backend.src.modules.integrations.vetis.receipt_mapping import build_process_incoming_application

__all__ = ["build_receipt_preview", "queue_receipt", "write_enabled"]


def write_enabled() -> bool:
    return os.environ.get("VETIS_WRITE_ENABLED", "false").strip().lower() == "true"


def _problem(status: int, code: str, detail: str) -> ProblemError:
    return ProblemError(status=status, code=code, title=code.replace("_", " ").title(), detail=detail)


def _fingerprint(payload: dict[str, object]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _quantity(value: object) -> Decimal:
    parsed = Decimal(str(value))
    if not parsed.is_finite():
        raise _problem(422, "VALIDATION_ERROR", "Количество продукции недействительно.")
    return parsed


def _documentary_quantity(batch: dict[str, object]) -> Decimal | None:
    """The documentary places count from the source only — never the mass.

    ТЗ DR8 §13: mass and quantity are separate dimensions; a snapshot without
    a package quantity keeps it ABSENT (no fabricated ``0``, no mass fallback).
    """
    raw = batch.get("quantity")
    if raw is None or str(raw).strip() == "":
        return None
    return _quantity(raw)


def _dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _decision(value: str | None) -> Literal["ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"]:
    mapped = {"ACCEPT_ALL": "ACCEPT_ALL", "PARTIAL": "PARTIALLY", "RETURN_ALL": "RETURN_ALL"}.get(value or "")
    if mapped is None:
        raise _problem(422, "RECONCILIATION_INCOMPLETE", "Решение по сверке ещё не выбрано.")
    return mapped  # type: ignore[return-value]


async def build_receipt_preview(
    db: AsyncSession,
    *,
    party_id: uuid.UUID,
    source_revision: int,
    reconciliation_revision: int,
    vet_inspection: Literal["CORRESPONDS", "MISMATCH", "UNSUPERVISED"],
    delivery_date: datetime | None = None,
    return_date: datetime | None = None,
    issue_date: datetime | None = None,
    service_id: str = "mercury-vu.service:2.0",
    issuer_id: str = "preview-redacted",
) -> ReceiptPreview:
    """Build a non-persistent preview from locked source/reconciliation versions."""
    row = (
        await db.execute(
            select(Party, IncomingDocument, Reconciliation, VetisSourceDocument, VetisBinding)
            .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
            .join(Reconciliation, Reconciliation.party_id == Party.id)
            .join(
                VetisSourceDocument,
                (VetisSourceDocument.contour == IncomingDocument.contour)
                & (VetisSourceDocument.evsd_uuid == IncomingDocument.evsd_uuid),
            )
            .join(VetisBinding, VetisBinding.laboratory_id == Party.laboratory_id)
            .where(Party.id == party_id)
            .with_for_update()
        )
    ).first()
    if row is None:
        raise not_found("Поступление, сверка или исходный XML не найдены.")
    party, document, reconciliation, source, binding = row
    if reconciliation.state != "OPEN":
        raise _problem(409, "STATE_CONFLICT", "Гашение по этой сверке уже завершено.")
    if source.revision != source_revision or reconciliation.rev != reconciliation_revision:
        raise _problem(409, "REVISION_CONFLICT", "Источник или сверка изменились; сформируйте preview заново.")
    actual_checksum = hashlib.sha256(source.raw_xml.encode()).hexdigest()
    if actual_checksum != source.checksum:
        raise _problem(409, "SOURCE_CHECKSUM_MISMATCH", "Закреплённый исходный XML повреждён.")
    if document.external_status != "CONFIRMED":
        raise _problem(409, "STATE_CONFLICT", "Погасить можно только подтверждённый входящий эВСД.")
    payload = _dict(document.source_snapshot.get("vdDocument"))
    consignee = _dict(payload.get("consignee"))
    enterprise = _dict(consignee.get("enterprise"))
    receiver = str(enterprise.get("guid") or "")
    if not receiver or receiver != (binding.enterprise_id or ""):
        raise _problem(422, "INTEGRATION_SCOPE_MISSING", "Получатель эВСД не совпадает с зарегистрированной площадкой.")
    batch = _dict(payload.get("batch"))
    unit = _dict(batch.get("unit"))
    unit_id = str(unit.get("guid") or "")
    if not unit_id:
        # ТЗ DR8 R-DR8-1: without the source unit GUID the гашение is honestly
        # blocked — a fictitious unit must never be invented for the request.
        raise _problem(422, "VALIDATION_ERROR", "Исходный эВСД не содержит единицу измерения; гашение недоступно.")
    if (
        reconciliation.delivered_unit_id != unit_id
        or reconciliation.accepted_unit_id != unit_id
        or reconciliation.returned_unit_id != unit_id
    ):
        raise _problem(422, "VALIDATION_ERROR", "Единица сверки не совпадает с исходным эВСД.")

    discrepancies: list[dict[str, object]] = []
    for field_id, item in reconciliation.checks.items():
        if field_id == "CHK-F35" or not isinstance(item, dict) or item.get("matches") is not False:
            continue
        discrepancies.append(
            {"field_id": field_id, "reason": item.get("reason") or "MISMATCH", "actual": item.get("actual")}
        )
    reason = reconciliation.checks.get("CHK-F35", {})
    reason = reason if isinstance(reason, dict) else {}
    selected_delivery_date = delivery_date or datetime.now(UTC)
    if selected_delivery_date.tzinfo is None or selected_delivery_date > datetime.now(UTC):
        raise _problem(422, "VALIDATION_ERROR", "Дата поступления должна содержать часовой пояс и не быть в будущем.")
    # ТЗ DR8 §9: the returned delivery carries the ENTERED return date, never
    # the request date; PARTIAL/RETURN_ALL require it explicitly.
    selected_return_date = return_date
    if reconciliation.decision in ("PARTIAL", "RETURN_ALL"):
        if selected_return_date is None:
            raise _problem(422, "VALIDATION_ERROR", "Для частичного гашения и полного возврата нужна дата возврата.")
        if selected_return_date.tzinfo is None or selected_return_date > datetime.now(UTC):
            raise _problem(
                422, "VALIDATION_ERROR", "Дата возврата должна содержать часовой пояс и не быть в будущем."
            )
    # `issueDate` is the server time of the request formation; the frozen
    # timestamp may be echoed by the submit request so the fingerprint of the
    # re-built preview stays identical (one frozen intent).
    selected_issue_date = issue_date or datetime.now(UTC)
    if selected_issue_date.tzinfo is None or selected_issue_date > datetime.now(UTC):
        raise _problem(422, "VALIDATION_ERROR", "Дата формирования запроса некорректна.")
    operation_key = (
        f"vetis-receipt:{party.id}:{source.revision}:{reconciliation.rev}:"
        f"{vet_inspection}:{reconciliation.decision}"
    )
    operation_id = uuid.uuid5(uuid.NAMESPACE_URL, operation_key)
    raw: dict[str, object] = {
        "operation_id": operation_id,
        "party_id": party.id,
        "laboratory_id": party.laboratory_id,
        "contour": VetisContour(document.contour),
        "source_evsd_uuid": document.evsd_uuid,
        "source_checksum": source.checksum,
        "source_revision": source.revision,
        "receiver_enterprise_id": receiver,
        "business_member_id": binding.business_member_id or "",
        "initiator": binding.initiator or "",
        "delivery_date": selected_delivery_date,
        "return_date": selected_return_date,
        "issue_date": selected_issue_date,
        "reconciliation_revision": reconciliation.rev,
        "decision": _decision(reconciliation.decision),
        "doc_inspection": "MISMATCH" if discrepancies else "CORRESPONDS",
        "vet_inspection": vet_inspection,
        # ТЗ DR8 §5.2: both dimensions separately, from the frozen columns.
        "documentary_mass_kg": _quantity(batch.get("volume")),
        # ТЗ DR8 §13: the documentary quantity comes ONLY from the package
        # quantity source; the mass is never a fallback and an absent source
        # quantity stays absent (like queries._quantity_set).
        "documentary_quantity": _documentary_quantity(batch),
        "delivered_mass_kg": _quantity(reconciliation.delivered_mass_kg),
        "delivered_quantity": _quantity(reconciliation.delivered_quantity),
        "accepted_mass_kg": _quantity(reconciliation.accepted_mass_kg),
        "accepted_quantity": _quantity(reconciliation.accepted_quantity),
        "returned_mass_kg": _quantity(reconciliation.returned_mass_kg),
        "returned_quantity": _quantity(reconciliation.returned_quantity),
        "unit_id": unit_id,
        "discrepancy_items": discrepancies,
        "return_reason_code": reason.get("actual"),
        "return_reason_text": reason.get("reason"),
        "act_number": reconciliation.repeat_act_number,
        "local_transaction_id": str(operation_id),
    }
    fingerprint = _fingerprint(raw)
    intent = ReceiptIntent.model_validate({**raw, "fingerprint": fingerprint})
    xml = build_process_incoming_application(
        intent,
        source_xml=source.raw_xml,
        service_id=service_id,
        issuer_id=issuer_id,
    )
    return ReceiptPreview(intent=intent, application_xml=xml, fingerprint=fingerprint)


async def queue_receipt(
    db: AsyncSession,
    *,
    preview: ReceiptPreview,
    confirmation: UserConfirmation,
) -> VetisOperation:
    """Persist the exact preview and outbox atomically; never contacts VetIS."""
    if not write_enabled():
        raise _problem(503, "INTEGRATION_WRITE_DISABLED", "Гашение не включено оператором установки.")
    if confirmation.fingerprint != preview.fingerprint or preview.intent.fingerprint != preview.fingerprint:
        raise _problem(409, "PREVIEW_CHANGED", "Подтверждённый preview изменился; повторите подтверждение.")
    existing = (
        await db.execute(
            select(VetisOperation).where(
                VetisOperation.party_id == preview.intent.party_id,
                VetisOperation.kind == VetisOperationKind.RECEIPT,
                VetisOperation.state.not_in((VetisOperationState.CONFIRMED, VetisOperationState.REJECTED)),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.fingerprint == preview.fingerprint:
            return existing
        raise _problem(409, "STATE_CONFLICT", "Для поступления уже существует незавершённое гашение.")
    operation = VetisOperation(
        id=preview.intent.operation_id,
        kind=VetisOperationKind.RECEIPT,
        state=VetisOperationState.QUEUED,
        laboratory_id=preview.intent.laboratory_id,
        contour=preview.intent.contour,
        created_by=confirmation.actor_id,
        party_id=preview.intent.party_id,
        source_checksum=preview.intent.source_checksum,
        source_revision=preview.intent.source_revision,
        reconciliation_revision=preview.intent.reconciliation_revision,
        local_transaction_id=preview.intent.local_transaction_id,
        fingerprint=preview.fingerprint,
        intent=preview.intent.model_dump(mode="json"),
        confirmed_by=confirmation.actor_id,
        confirmed_at=confirmation.confirmed_at,
    )
    db.add(operation)
    await db.flush()
    db.add(
        OutboxEntry(
            operation_id=operation.id,
            event_type="vetis.receipt",
            payload={"operation_id": str(operation.id)},
        )
    )
    return operation
