"""The single conclusion-basis predicate (ТЗ DR55 §5.4) and its bulk read.

:func:`evaluate_conclusion_basis` is the ONE pure domain decision of
whether a veterinary conclusion may be produced for a party, and on which
basis (``LOCAL``/``PREVIOUS``). Both consumers reuse it verbatim:

- ``service.build_conclusion()`` — the per-request view-model (the blockers
  become the 422 problem texts);
- :func:`conclusion_flags` — the bulk read-model projector of the arrivals
  list/card page (a compact ``conclusion.available`` per row, computed in
  three set queries per page — no N+1, no per-row preview/PDF request).

The projection is a display convenience only: the preview and the PDF route
always re-derive the live basis and re-check the actor's rights.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation
from backend.src.modules.documents.schemas import ConclusionFlagView
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.models import Laboratory

__all__ = [
    "BasisOutcome",
    "BLOCKER_TEXTS",
    "evaluate_conclusion_basis",
    "conclusion_flags",
    "local_basis_fields",
    "owner_display_name",
    "unit_display_name",
]

# Typed blockers; every Russian user text lives in exactly one place.
NOT_CONFIRMED = "not_confirmed"
FULL_RETURN = "full_return"
NO_LOCAL_EXAMINATION = "no_local_examination"
WAITING = "waiting"
UNFIT = "unfit"

BLOCKER_TEXTS: dict[str, str] = {
    NOT_CONFIRMED: "приёмка не подтверждена",
    FULL_RETURN: "партия возвращена полностью: заключение о реализации недоступно",
    NO_LOCAL_EXAMINATION: "местная ВСЭ не найдена (удалена или не создана)",
    WAITING: "местная ВСЭ в состоянии ожидания: документ недоступен",
    UNFIT: "итог местной ВСЭ непригоден: заключение о реализации недоступно",
}


@dataclass(frozen=True, slots=True)
class BasisOutcome:
    """The pure result of the eligibility decision for one party."""

    basis_kind: str | None
    blockers: tuple[str, ...]
    missing: tuple[str, ...]

    @property
    def available(self) -> bool:
        return self.basis_kind is not None and not self.blockers and not self.missing


def unit_display_name(batch: Mapping[str, Any], accepted_unit_id: str | None) -> str | None:
    """The human-readable unit of the accepted quantity (ТЗ DR55 §5.8).

    A GUID/UUID is never printable: the name comes from the frozen confirmed
    snapshot when the source unit GUID is the same identity the confirmation
    carries. Legacy rows whose ``accepted_unit_id`` already holds the label
    itself keep working; a missing name stays missing — the document honestly
    reports ``DOCUMENT_BASIS_INCOMPLETE`` instead of printing a UUID.
    """
    if accepted_unit_id is None or accepted_unit_id.strip() == "":
        return None
    if not _looks_like_uuid(accepted_unit_id):
        return accepted_unit_id.strip()
    unit = batch.get("unit") if isinstance(batch, Mapping) else None
    if not isinstance(unit, Mapping):
        return None
    guid = str(unit.get("guid") or "")
    name = str(unit.get("name") or "").strip()
    if guid == accepted_unit_id and name != "":
        return name
    return None


def _looks_like_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError):
        return False
    return True


def owner_display_name(payload: object, form_snapshot: object) -> str | None:
    """The printable owner of the conclusion (ТЗ DR55 §5.8 fix-loop).

    Priority: the SAVED human-readable participant of the read model
    (``party.form_snapshot.participants.receiverOwner.name`` — the frozen
    create-page value the user saw and confirmed) → the raw ``consignee.name``
    of the VetIS snapshot. A GUID/UUID is never printed in either source: a
    missing name stays missing, and the document honestly reports
    ``DOCUMENT_BASIS_INCOMPLETE``. The builder and the bulk projector both
    use THIS one function — the same domain source, never two copies.
    """
    participants = form_snapshot.get("participants") if isinstance(form_snapshot, Mapping) else None
    entry = participants.get("receiverOwner") if isinstance(participants, Mapping) else None
    if isinstance(entry, Mapping):
        saved = _text(entry.get("name"))
        if saved is not None and not _looks_like_uuid(saved):
            return saved
    consignee = payload.get("consignee") if isinstance(payload, Mapping) else None
    raw = _text(consignee.get("name")) if isinstance(consignee, Mapping) else None
    return None if raw is not None and _looks_like_uuid(raw) else raw


def local_basis_fields(examination: Examination | None) -> tuple[dict[str, str | None], tuple[str, ...]]:
    """The LOCAL-basis eligibility inputs from the party's own examination.

    Returns the requisites and the typed blockers: a missing, waiting or
    unfit local ВСЭ is never substituted by the previous one.
    """
    if examination is None:
        return {}, (NO_LOCAL_EXAMINATION,)
    if examination.status != "COMPLETED" or examination.first_completed_at is None:
        return {}, (WAITING,)
    if examination.outcome != "FIT":
        return {}, (UNFIT,)
    from backend.src.core.clock import moscow_date

    date = moscow_date(examination.first_completed_at).isoformat()
    number = (examination.number or "").strip() or None
    stamp = (examination.stamp or "").strip() or None
    return (
        {
            "stamp": stamp,
            "date": date,
            "basis": f"Местная ВСЭ № {number} от {date}" if number is not None else None,
        },
        (),
    )


def previous_basis_fields(snapshot: Mapping[str, Any]) -> tuple[dict[str, str | None], tuple[str, ...]]:
    """The PREVIOUS-basis requisites from the CHK record; every gap is named."""
    # Imported lazily: the arrivals query module imports this module for the
    # bulk projection, so a top-level import would be circular.
    from backend.src.modules.arrivals.queries import previous_vse_fields

    source = previous_vse_fields(snapshot)
    fields: dict[str, str | None] = {
        "stamp": _text(source["previousStamp"]),
        "date": _text(source["previousPerformedOn"]),
    }
    number = _text(source["previousNumber"])
    fields["basis"] = (
        f"Прежняя ВСЭ № {number} от {fields['date']}" if number is not None and fields["date"] is not None else None
    )
    missing = tuple(
        name
        for name, value in {
            "stamp": source["previousStamp"],
            "date": source["previousPerformedOn"],
            "previousNumber": source["previousNumber"],
            "previousOrganization": source["previousOrganization"],
            "previousResult": source["previousResult"],
            "previousConclusion": source["previousConclusion"],
        }.items()
        if _text(value) is None
    )
    return fields, missing


def evaluate_conclusion_basis(
    *,
    confirmed: bool,
    accepted_quantity: Decimal,
    returned_quantity: Decimal,
    previous_sufficient: bool,
    laboratory: Mapping[str, Any] | None,
    document: Mapping[str, Any] | None,
    local: Mapping[str, Any] | None,
    local_blockers: tuple[str, ...] = (),
    previous: Mapping[str, Any] | None,
    unit_name: str | None,
) -> BasisOutcome:
    """The single eligibility decision of a conclusion (ТЗ DR55 §4.1).

    ``local``/``previous`` are the requisite dicts of the chosen basis (the
    other one stays ``None``); ``local_blockers`` carries the typed
    no-local-examination/waiting/unfit facts of the LOCAL route. The result
    is reused by the per-request builder and the bulk projector, so a row can
    never show a menu the live builder would refuse — and vice versa.
    """
    if not confirmed:
        return BasisOutcome(None, (NOT_CONFIRMED,), ())
    if accepted_quantity == 0 and returned_quantity > 0:
        return BasisOutcome(None, (FULL_RETURN,), ())
    kind, basis_fields = ("PREVIOUS", previous) if previous_sufficient else ("LOCAL", local)
    missing: list[str] = []
    fields: Mapping[str, Any] = basis_fields or {}
    for name in ("stamp", "date", "basis"):
        if not (str(fields.get(name) or "").strip()):
            missing.append(name)
    for name, value in (laboratory or {}).items():
        if not (str(value or "").strip()):
            missing.append(name)
    for name, value in (document or {}).items():
        if not (str(value or "").strip()):
            missing.append(name)
    if not (unit_name or "").strip():
        missing.append("unit")
    return BasisOutcome(kind, local_blockers, tuple(missing))


def _text(value: object) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def conclusion_view_of(outcome: BasisOutcome) -> ConclusionFlagView:
    """The compact flag: the basis kind is published only when usable."""
    return ConclusionFlagView(
        available=outcome.available,
        basis_kind=outcome.basis_kind if outcome.available else None,
    )


async def conclusion_flags(
    db: AsyncSession,
    parties: list[Party],
    documents: Mapping[uuid.UUID, IncomingDocument],
) -> dict[uuid.UUID, ConclusionFlagView]:
    """The compact ``conclusion`` projection of one PAGE in three set reads.

    Confirmations, examinations and laboratories are each loaded with one
    ``IN`` query for the whole page; the per-row decision is the same pure
    predicate the request-time builder uses. No preview/PDF request per row
    and no ProblemError catching in a loop (ТЗ DR55 §5.4).
    """
    if not parties:
        return {}
    party_ids = [party.id for party in parties]
    confirmations = {
        row.party_id: row
        for row in (
            await db.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id.in_(party_ids)))
        ).scalars()
    }
    examinations = {
        row.party_id: row
        for row in (await db.execute(select(Examination).where(Examination.party_id.in_(party_ids)))).scalars()
    }
    lab_ids = {party.laboratory_id for party in parties}
    laboratories = {
        row.id: row for row in (await db.execute(select(Laboratory).where(Laboratory.id.in_(lab_ids)))).scalars()
    }
    flags: dict[uuid.UUID, ConclusionFlagView] = {}
    for party in parties:
        document = documents[party.id]
        confirmation = confirmations.get(party.id)
        examination = examinations.get(party.id)
        laboratory = laboratories.get(party.laboratory_id)
        if confirmation is None:
            outcome = BasisOutcome(None, (NOT_CONFIRMED,), ())
        else:
            payload = document.source_snapshot.get("vdDocument")
            payload = payload if isinstance(payload, dict) else {}
            batch = payload.get("batch")
            batch = batch if isinstance(batch, dict) else {}
            product_item = batch.get("productItem") if isinstance(batch, dict) else None
            document_fields = {
                "evsd": str(document.evsd_uuid),
                # ТЗ DR55 §5.8 fix-loop: the SAVED read-model participant wins
                # over the raw consignee (same source as the builder).
                "owner": owner_display_name(payload, party.form_snapshot),
                "product": _text(product_item.get("name")) if isinstance(product_item, dict) else None,
            }
            if confirmation.previous_sufficient:
                previous_fields, previous_missing = previous_basis_fields(document.source_snapshot)
                local_fields, local_blockers = {}, ()
            else:
                previous_fields, previous_missing = {}, ()
                local_fields, local_blockers = local_basis_fields(examination)
            # The CHK requisites of the previous basis are checked as document
            # facts too: a gap blocks the document exactly like the builder.
            for key in previous_missing:
                if key not in document_fields:
                    document_fields[key] = None
            outcome = evaluate_conclusion_basis(
                confirmed=True,
                accepted_quantity=Decimal(str(confirmation.accepted_quantity or "0")),
                returned_quantity=Decimal(str(confirmation.returned_quantity or "0")),
                previous_sufficient=confirmation.previous_sufficient,
                laboratory={
                    "organization": laboratory.organization if laboratory is not None else None,
                    "laboratory": laboratory.name if laboratory is not None else None,
                },
                document=document_fields,
                local=local_fields,
                local_blockers=local_blockers,
                previous=previous_fields,
                unit_name=unit_display_name(batch, confirmation.accepted_unit_id),
            )
        flags[party.id] = conclusion_view_of(outcome)
    return flags
