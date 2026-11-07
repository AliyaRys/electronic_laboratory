"""``confirm_receipt`` (DATA-06): the immutable verified receipt boundary.

This is the only writer of ``receipt_confirmations``. It is a service command
for the worker/composition root (ТЗ-11): the evidence arrives through the
``ReceiptEvidenceReader`` port, never through an HTTP body, so no client can
fabricate a confirmation. There is no SOAP and no network call here — the
command freezes an already-read external fact.

The command validates the evidence gate (source/receiver/composition,
FT-ARR-14), deduplicates by operation/fingerprint, and then writes — in ONE
transaction with the caller — the confirmation row, the frozen accepted
composition and the reconciliation completion (CONFIRMED/RETURNED). The queue
label stays a query-time read model (DATA-02): the confirmation row plus the
frozen reconciliation state are what the queue reads.

An immutable fact is never overwritten: a second, incompatible confirmation is
rejected with 409 ``STATE_CONFLICT``; a repeat of the same operation/fingerprint
is an idempotent replay of the same fact.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import (
    IncomingDocument,
    Party,
    ReceiptConfirmation,
    Reconciliation,
)
from backend.src.modules.arrivals.ports import CONFIRMED_EVIDENCE_STATUSES, ReceiptEvidence
from backend.src.modules.arrivals.queries import previous_vse_fields

__all__ = ["confirm_receipt", "downstream_route", "ensure_confirmed", "evidence_fingerprint"]

_DECISION_TO_STATE: dict[str, str] = {"ACCEPT_ALL": "CONFIRMED", "PARTIALLY": "CONFIRMED", "RETURN_ALL": "RETURNED"}


def _refuse(detail: str) -> ProblemError:
    """422 INTEGRATION_EVIDENCE_INCOMPLETE: the fact does not prove the receipt."""
    return ProblemError(
        status=422,
        code="INTEGRATION_EVIDENCE_INCOMPLETE",
        title="Integration evidence incomplete",
        detail=detail,
    )


def _incompatible() -> ProblemError:
    """409 STATE_CONFLICT: a frozen fact is never overwritten by another one."""
    return ProblemError(
        status=409,
        code="STATE_CONFLICT",
        title="State conflict",
        detail="Поступление уже подтверждено другим внешним результатом; перезапись подтверждения недопустима.",
    )


def _foreign_operation() -> ProblemError:
    """409 STATE_CONFLICT: one external operation proves one receipt (DATA-06)."""
    return ProblemError(
        status=409,
        code="STATE_CONFLICT",
        title="State conflict",
        detail=(
            "Эта внешняя операция гашения уже подтверждена для другого поступления; "
            "повторное использование недопустимо."
        ),
    )


def not_confirmed() -> ProblemError:
    """422 RECEIPT_NOT_CONFIRMED: the explicit blocker for dependent commands."""
    return ProblemError(
        status=422,
        code="RECEIPT_NOT_CONFIRMED",
        title="Receipt not confirmed",
        detail=(
            "Поступление не подтверждено внешним гашением: создание ВСЭ и заключения "
            "недоступны до подтверждения приёмки реальными доказательствами."
        ),
    )


def evidence_fingerprint(evidence: ReceiptEvidence) -> str:
    """SHA-256 over the canonical immutable evidence (DATA-06 fingerprint)."""
    canonical = json.dumps(
        evidence.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _decimal(value: object) -> Decimal | None:
    """A finite decimal or ``None``; ``InvalidOperation`` is an ``ArithmeticError``."""
    try:
        parsed = Decimal(str(value)) if value is not None else None
    except ArithmeticError:
        return None
    return parsed if parsed is None or parsed.is_finite() else None


def _composition_problem(decision: str) -> str:
    if decision == "PARTIALLY":
        return (
            "Состав частичного гашения неполон: нужны положительные принятая и "
            "возвращаемая части, в сумме равные доставленному."
        )
    if decision == "RETURN_ALL":
        return "Состав полного возврата неполон: принятое равно нулю, возвращается вся партия."
    return "Состав полного принятия неполон: принимается всё доставленное, без возврата."


def _validate_composition(evidence: ReceiptEvidence, document: IncomingDocument) -> None:
    """The composition arithmetic of one decision against the document (DATA-02)."""
    batch_raw = document.source_snapshot.get("vdDocument")
    payload = batch_raw if isinstance(batch_raw, dict) else {}
    batch = payload.get("batch") if isinstance(payload.get("batch"), dict) else {}
    if not batch:
        raise _refuse("Снимок эВСД не содержит состава партии: подтверждение невозможно.")
    delivered_mass = _decimal(batch.get("volume"))
    delivered_quantity = _decimal(batch.get("quantity") or batch.get("volume"))
    if delivered_mass is None or delivered_quantity is None:
        raise _refuse("Снимок эВСД не содержит доставленных величин: подтверждение невозможно.")

    accepted_mass, accepted_quantity = _decimal(evidence.accepted_mass_kg), _decimal(evidence.accepted_quantity)
    returned_mass, returned_quantity = _decimal(evidence.returned_mass_kg), _decimal(evidence.returned_quantity)
    unit = batch.get("unit")
    document_unit = str(unit.get("guid")) if isinstance(unit, dict) and unit.get("guid") is not None else None
    if evidence.unit_id is None:
        raise _refuse("Внешний результат не содержит единицы измерения: подтверждение невозможно.")
    if document_unit is not None and document_unit != evidence.unit_id:
        raise _refuse("Единица измерения внешнего результата не совпадает с единицей эВСД.")

    if evidence.decision == "ACCEPT_ALL":
        ok = (
            accepted_mass == delivered_mass
            and accepted_quantity == delivered_quantity
            and (returned_mass is None or returned_mass == 0)
            and (returned_quantity is None or returned_quantity == 0)
        )
    elif evidence.decision == "PARTIALLY":
        ok = (
            accepted_mass is not None
            and accepted_quantity is not None
            and returned_mass is not None
            and returned_quantity is not None
            and accepted_mass > 0
            and accepted_quantity > 0
            and returned_mass > 0
            and returned_quantity > 0
            and accepted_mass + returned_mass == delivered_mass
            and accepted_quantity + returned_quantity == delivered_quantity
        )
    else:  # RETURN_ALL
        ok = (
            (accepted_mass is None or accepted_mass == 0)
            and (accepted_quantity is None or accepted_quantity == 0)
            and returned_mass == delivered_mass
            and returned_quantity == delivered_quantity
        )
    if not ok:
        raise _refuse(_composition_problem(evidence.decision))


async def _resolve_party(uow: AsyncSession, evidence: ReceiptEvidence) -> tuple[Party, IncomingDocument] | None:
    row = (
        await uow.execute(
            select(Party, IncomingDocument)
            .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
            .where(IncomingDocument.contour == str(evidence.contour), IncomingDocument.evsd_uuid == evidence.evsd_uuid)
            .with_for_update()
        )
    ).first()
    return (row[0], row[1]) if row is not None else None


def _validated_receiver(evidence: ReceiptEvidence, document: IncomingDocument) -> None:
    """The external result must name the receiver of the eVSD itself (DATA-06)."""
    payload = document.source_snapshot.get("vdDocument")
    payload = payload if isinstance(payload, dict) else {}
    consignee = payload.get("consignee")
    enterprise = consignee.get("enterprise") if isinstance(consignee, dict) else None
    guid = enterprise.get("guid") if isinstance(enterprise, dict) else None
    if guid is None or str(guid) != evidence.receiver_enterprise_id:
        raise _refuse("Получатель внешнего результата не совпадает с получателем эВСД: подтверждение невозможно.")


async def confirm_receipt(uow: AsyncSession, evidence: ReceiptEvidence | None) -> ReceiptConfirmation | None:
    """Freeze one verified receipt fact (DATA-06); the caller owns the commit.

    ``None`` evidence (absent/UNKNOWN) never confirms anything and never
    touches the database. Every refusal leaves no row behind.
    """
    if evidence is None:
        return None

    if evidence.external_status not in CONFIRMED_EVIDENCE_STATUSES:
        raise _refuse("Внешний статус результата не подтверждает гашение (UNKNOWN/UTILIZED не подтверждают приёмку).")

    resolved = await _resolve_party(uow, evidence)
    if resolved is None:
        raise _refuse("Для этой эВСД нет локальной партии: подтверждение внешнего результата невозможно.")
    party, document = resolved
    _validated_receiver(evidence, document)
    _validate_composition(evidence, document)

    if evidence.operation_id is None:
        raise _refuse("Внешний результат не содержит идентификатора операции: подтверждение невозможно.")
    try:
        operation_uuid = UUID(evidence.operation_id)
    except ValueError as exc:
        raise _refuse("Идентификатор операции внешнего результата непригоден: подтверждение невозможно.") from exc

    fingerprint = evidence_fingerprint(evidence)
    existing = (
        await uow.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party.id).with_for_update())
    ).scalar_one_or_none()
    if existing is not None:
        if existing.fingerprint == fingerprint:
            return existing  # idempotent replay: the same fact, nothing written
        raise _incompatible()

    # Cross-party dedup (DATA-06 operation identity): one external operation
    # proves one receipt. An operation_id already frozen for ANOTHER party is
    # refused with an honest problem before any insert — the DB UNIQUE
    # constraint stays the race backstop, never the user-visible answer.
    same_operation = (
        await uow.execute(
            select(ReceiptConfirmation).where(ReceiptConfirmation.operation_id == operation_uuid).with_for_update()
        )
    ).scalar_one_or_none()
    if same_operation is not None and same_operation.party_id != party.id:
        raise _foreign_operation()

    # The reconciliation is loaded under lock BEFORE any insert: its saved
    # decision must match the external fact, and its repeat choice is frozen
    # into the confirmation (FT-ARR-12), so the route survives row deletion.
    reconciliation = (
        await uow.execute(select(Reconciliation).where(Reconciliation.party_id == party.id).with_for_update())
    ).scalar_one_or_none()
    if reconciliation is not None:
        mapped_decision = {"ACCEPT_ALL": "ACCEPT_ALL", "PARTIALLY": "PARTIAL", "RETURN_ALL": "RETURN_ALL"}[
            evidence.decision
        ]
        if reconciliation.decision is not None and reconciliation.decision != mapped_decision:
            raise _incompatible()
    previous = any(value is not None for value in previous_vse_fields(document.source_snapshot).values())
    previous_sufficient = previous and reconciliation is not None and reconciliation.repeated_required is False

    accepted_mass = evidence.accepted_mass_kg if evidence.accepted_mass_kg is not None else Decimal("0")
    accepted_quantity = evidence.accepted_quantity if evidence.accepted_quantity is not None else Decimal("0")
    returned_mass = evidence.returned_mass_kg if evidence.returned_mass_kg is not None else Decimal("0")
    returned_quantity = evidence.returned_quantity if evidence.returned_quantity is not None else Decimal("0")
    confirmation = ReceiptConfirmation(
        party_id=party.id,
        operation_id=operation_uuid,
        source_evsd_uuid=evidence.evsd_uuid,
        fingerprint=fingerprint,
        evidence=evidence.model_dump(mode="json"),
        accepted_mass_kg=accepted_mass,
        accepted_quantity=accepted_quantity,
        accepted_unit_id=evidence.unit_id or "",
        returned_mass_kg=returned_mass,
        returned_quantity=returned_quantity,
        returned_unit_id=evidence.unit_id,
        classification_snapshot=dict(party.classification_snapshot),
        previous_sufficient=previous_sufficient,
    )
    uow.add(confirmation)

    # Freeze the reconciliation atomically with the confirmation (FT-ARR-15):
    # the external fact owns the completed state and the accepted composition.
    if reconciliation is not None:
        reconciliation.state = _DECISION_TO_STATE[evidence.decision]
        reconciliation.completed_at = datetime.now(UTC)
        reconciliation.accepted_mass_kg = float(accepted_mass)
        reconciliation.accepted_quantity = float(accepted_quantity)
        reconciliation.accepted_unit_id = evidence.unit_id
        reconciliation.returned_mass_kg = float(returned_mass)
        reconciliation.returned_quantity = float(returned_quantity)
        reconciliation.returned_unit_id = evidence.unit_id
        reconciliation.rev = (reconciliation.rev or 1) + 1

    # The party view now carries the confirmation — its ETag must move.
    party.rev = (party.rev or 1) + 1
    try:
        await uow.flush()
    except IntegrityError as exc:
        # A lost race against the UNIQUE constraints surfaces honestly, never
        # as a raw 500 (the caller rolls back the aborted transaction).
        raise _incompatible() from exc
    return confirmation


async def ensure_confirmed(db: AsyncSession, party_id: UUID) -> ReceiptConfirmation:
    """The frozen fact of one party, or the explicit blocker for dependents.

    Dependent commands (creating a ВСЭ, printing a conclusion — ТЗ-05/07) call
    this before any work: missing real evidence is an explicit 422
    ``RECEIPT_NOT_CONFIRMED``, never a silent success.
    """
    confirmation = (
        await db.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party_id))
    ).scalar_one_or_none()
    if confirmation is None:
        raise not_confirmed()
    return confirmation


async def downstream_route(db: AsyncSession, party_id: UUID) -> Literal["EXAMINATION", "CONCLUSION", "NONE"]:
    """The downstream route after a confirmed receipt, read from the frozen fact.

    FT-ARR-12: a positive confirmation opens the local ВСЭ when it is required;
    with a sufficient previous ВСЭ (repeat explicitly not required) the saved
    reconciliation and the conclusion are available; a full return never
    creates a ВСЭ. The route-relevant decision is frozen into the confirmation
    at confirm time, so deleting the reconciliation row (or a ВСЭ) never
    degrades the route of a live party.
    """
    confirmation = await ensure_confirmed(db, party_id)
    if Decimal(confirmation.accepted_quantity) == 0 and Decimal(confirmation.returned_quantity) > 0:
        return "NONE"
    if confirmation.previous_sufficient:
        return "CONCLUSION"
    return "EXAMINATION"
