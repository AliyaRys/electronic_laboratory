"""The create-page read model of one confirmed party (DR35 §4/§5/§6/§9/§14).

The ВСЭ creation reads ONE immutable local snapshot of the reconciliation step
and NEVER talks to VetIS: opening the form performs no lookup job and no GUID
re-resolution. The snapshot lives on ``parties.form_snapshot`` (migration 0020)
and is backfilled REPEATABLY from the pinned source revision and the local
participant-name cache; a non-empty frozen value is never overwritten (§4.2).

An unresolvable participant name keeps the honest diagnostic state
(``MISSING``/``ERROR``/``PENDING``) with ``name=None`` — the UI renders
«Название не получено», never a GUID and never a silent «—».
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.confirmation import ensure_confirmed
from backend.src.modules.arrivals.models import IncomingDocument, Party, Reconciliation
from backend.src.modules.catalog_pricing.mandatory import MANDATORY_INDICATOR_IDS, TRICHINELLA_INDICATOR_ID
from backend.src.modules.examinations.specialists import eligible_specialists
from backend.src.modules.examinations.validation import _requires_trichinelloscopy
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.reference_names import (
    NAME_FIELD_KEYS,
    participant_name_overrides,
    resolve_participants,
)

__all__ = ["PRODUCT_TYPE_LABELS", "product_type_label", "build_form_snapshot", "build_form_view"]

# ТЗ §6: the single typed presentation map of the Mercury product types.
PRODUCT_TYPE_LABELS: dict[int, str] = {
    1: "Мясо и мясопродукты",
    2: "Корма и кормовые добавки",
    3: "Живые животные",
    4: "Лекарственные средства",
    5: "Пищевые продукты",
    6: "Непищевые продукты и другое",
    7: "Рыба и морепродукты",
    8: "Продукция, не требующая разрешения",
}


def product_type_label(code: int | None) -> str | None:
    """The Russian label of a product type; ``None`` for unknown/absent codes
    (the UI renders the honest fallback, never a bare digit)."""
    if code is None:
        return None
    return PRODUCT_TYPE_LABELS.get(code)


def _classification_entry(item: object) -> dict[str, Any]:
    value = item if isinstance(item, dict) else {}
    identifier = value.get("id")
    return {"id": str(identifier) if identifier is not None else None, "name": value.get("name")}


def _participant_state(name_source: object) -> str:
    """The honest diagnostic state of one frozen name (no GUID fallback)."""
    text = str(name_source or "")
    if text in {"SOURCE_XML", "VETIS_LOOKUP"}:
        return text
    if text in {"PENDING", "ERROR", "MISSING"}:
        return text
    return "MISSING"


def _source_unit_name(document: IncomingDocument) -> str | None:
    """The optional display-only unit name of the pinned source revision."""
    payload = document.source_snapshot.get("vdDocument")
    payload = payload if isinstance(payload, dict) else {}
    batch = payload.get("batch")
    batch = batch if isinstance(batch, dict) else {}
    unit = batch.get("unit")
    if not isinstance(unit, dict):
        return None
    name = unit.get("name")
    text = str(name).strip() if name is not None else ""
    return text or None


def _product_type_of(party: Party) -> int | None:
    product = party.classification_snapshot.get("product")
    value = product.get("productType") if isinstance(product, dict) else None
    try:
        return int(value) if value is not None else None
    except TypeError, ValueError:
        return None


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == {}


async def build_form_snapshot(db: AsyncSession, party: Party, document: IncomingDocument) -> dict[str, Any]:
    """The frozen create-page snapshot of one party, backfilled repeatably.

    Every participant/product/accepted field is frozen the first time the form
    is opened (the read model may persist the backfill) and is then NEVER
    changed while a non-empty value exists: the reconciliation step is done and
    its confirmed facts are the single read source (§4.1).
    """
    confirmation = await ensure_confirmed(db, party.id)
    reconciliation = (
        await db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))
    ).scalar_one_or_none()

    participants_raw = await resolve_participants(db, VetisContour(document.contour), document.source_snapshot)
    overrides = participant_name_overrides(participants_raw)
    fresh: dict[str, Any] = {
        "participants": {
            key: {
                "name": overrides.get(key),
                "state": _participant_state(overrides.get(f"{key}NameSource")),
            }
            for key in sorted(NAME_FIELD_KEYS.values())
        },
        "productType": _product_type_of(party),
        "acceptedMassKg": str(confirmation.accepted_mass_kg),
        "acceptedQuantity": str(confirmation.accepted_quantity),
        "acceptedUnitId": confirmation.accepted_unit_id,
        "acceptedUnitName": _source_unit_name(document),
        "sourceRevision": str(document.evsd_uuid),
        "reconciliationRevision": (
            int(reconciliation.rev) if reconciliation is not None and reconciliation.rev else None
        ),
    }

    frozen = dict(party.form_snapshot) if party.form_snapshot else {}
    merged = _merge_frozen(frozen, fresh)
    if merged is not None:
        party.form_snapshot = merged
        await db.flush()
        return merged
    return frozen


def _merge_frozen(frozen: dict[str, Any], fresh: dict[str, Any]) -> dict[str, Any] | None:
    """Apply the repeatable backfill: a non-empty frozen value always wins.

    Returns ``None`` when nothing changed (no write), else the merged snapshot.
    """
    merged = dict(frozen)
    changed = False
    for key, value in fresh.items():
        if isinstance(value, dict):
            inner_frozen = dict(frozen.get(key)) if isinstance(frozen.get(key), dict) else {}
            inner_merged = dict(inner_frozen)
            for inner_key, inner_value in value.items():
                if _is_empty(inner_frozen.get(inner_key)) and not _is_empty(inner_value):
                    inner_merged[inner_key] = inner_value
                    changed = True
            merged[key] = inner_merged
        elif _is_empty(frozen.get(key)) and not _is_empty(value):
            merged[key] = value
            changed = True
    return merged if changed else None


async def build_form_view(db: AsyncSession, party: Party, document: IncomingDocument, revision: int) -> dict[str, Any]:
    """The complete read-model payload of the create form (§4.1 minimum set)."""
    snapshot = await build_form_snapshot(db, party, document)

    participants = {
        key: {"name": value.get("name"), "state": str(value.get("state") or "MISSING")}
        for key, value in snapshot.get("participants", {}).items()
        if isinstance(value, dict)
    }
    for key in sorted(NAME_FIELD_KEYS.values()):
        participants.setdefault(key, {"name": None, "state": "MISSING"})

    raw_type = snapshot.get("productType")
    try:
        product_type_code = int(raw_type) if raw_type is not None else None
    except TypeError, ValueError:
        product_type_code = None

    classification = party.classification_snapshot
    product = _classification_entry(classification.get("product"))
    product_id = product.get("id")
    required = sorted({str(indicator) for indicator in MANDATORY_INDICATOR_IDS})
    if await _requires_trichinelloscopy(db, party):
        required.append(str(TRICHINELLA_INDICATOR_ID))

    specialists = await eligible_specialists(
        db, party.laboratory_id, uuid.UUID(str(product_id)) if product_id else None
    )
    unit_name = snapshot.get("acceptedUnitName")

    return {
        "party_id": str(party.id),
        "laboratory_id": str(party.laboratory_id),
        "participants": participants,
        "product_type": product_type_code,
        "product_type_label": product_type_label(product_type_code),
        "product": product,
        "sub_product": _classification_entry(classification.get("subProduct")),
        "product_item": _classification_entry(classification.get("productItem")),
        "unit": _classification_entry(classification.get("unit")),
        "accepted": {
            "mass_kg": str(snapshot.get("acceptedMassKg") or ""),
            "quantity": str(snapshot.get("acceptedQuantity") or ""),
            "unit_id": str(snapshot.get("acceptedUnitId") or ""),
            "unit_name": unit_name if isinstance(unit_name, str) and unit_name.strip() != "" else None,
        },
        "required_research_ids": required,
        "eligible_specialists": [{"id": str(item.id), "full_name": item.full_name} for item in specialists],
        "source_revision": str(snapshot.get("sourceRevision") or ""),
        "reconciliation_revision": snapshot.get("reconciliationRevision"),
        "revision": revision,
    }
