"""Arrival commands (API-04 / DATA-02): stable identity, hiding, guards.

``upsert_incoming`` never commits — the caller's coordinator owns the
transaction. Identity is stable per ``(contour, evsd_uuid)``: a second import
of the same UUID refreshes the snapshot, a new UUID is a new document and a
new party even when the human-readable document number is the same.

The content hash covers the snapshot only; ``fetched_at`` is never part of it,
so an unchanged re-import cannot resurrect a hidden document (AT-23).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import UUID as SqlUUID
from sqlalchemy import Column, MetaData, String, delete, func, select, update
from sqlalchemy import Table as sqlalchemy_table
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import ensure_revision
from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.arrivals.models import (
    HiddenIncoming,
    IncomingDocument,
    Party,
    ReceiptConfirmation,
    Reconciliation,
)
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentInput
from backend.src.modules.integrations.vetis.queries import find_product_lvl2

__all__ = ["upsert_incoming", "hide_incoming", "content_hash", "resolve_binding_or_fail"]

_UNRESOLVED_OPERATION_STATES = ("CONFIRMED", "REJECTED")

# Core projection of the ТЗ-10 technical table; the ORM model arrives with it.
VETIS_OPERATIONS = sqlalchemy_table(
    "vetis_operations",
    MetaData(),
    Column("party_id", SqlUUID(as_uuid=True)),
    Column("kind", String(20)),
    Column("state", String(20)),
)


def _dictionary_miss_problem() -> ProblemError:
    """The stable 422 problem for a level-2 dictionary miss (no raw GUID inside)."""
    return ProblemError(
        status=422,
        code="MERCURY_PRODUCT_DICTIONARY_MISS",
        title="Mercury product dictionary miss",
        detail=(
            "Для продукции второго уровня нет локального названия. Обновите справочник Меркурия и повторите операцию."
        ),
    )


def _binding_problem() -> ProblemError:
    """422 INTEGRATION_SCOPE_MISSING: no unambiguous enterprise→laboratory binding."""
    return ProblemError(
        status=422,
        code="INTEGRATION_SCOPE_MISSING",
        title="Enterprise binding missing",
        detail=(
            "Поступление не привязано однозначно к лаборатории: связь площадки "
            "с хозяйствующим субъектом не зарегистрирована. Партия не создана."
        ),
    )


def resolve_binding_or_fail(document: IncomingDocumentInput) -> None:
    """An ambiguous/missing enterprise binding never creates a party."""
    if document.laboratory_id is None:
        raise _binding_problem()


def content_hash(snapshot: dict[str, Any]) -> str:
    """SHA-256 over the canonical snapshot (``fetched_at`` is not inside)."""
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _entry(ref: object) -> dict[str, str | None]:
    ident = getattr(ref, "guid", None) or getattr(ref, "external_uuid", None)
    return {"id": str(ident) if ident is not None else None, "name": getattr(ref, "name", None)}


async def _classification_snapshot(db: AsyncSession, document: IncomingDocumentInput) -> dict[str, object]:
    """Resolve the four classification levels (API-04 / Global Constraints).

    A level-2 GUID that the shared local dictionary does not know does NOT
    block the import while the source snapshot carries a non-empty product
    name (ТЗ-10 contract): the source name is stored as-is and NO dictionary
    binding is fabricated (``productType`` stays unset). A dictionary miss
    WITHOUT a source name still raises the stable 422.
    """
    batch = document.snapshot.vd_document.batch
    product_key = batch.product.guid or batch.product.external_uuid
    product = None if product_key is None else await find_product_lvl2(db, document.contour, product_key)
    if product is None:
        if not (batch.product.name or "").strip():
            raise _dictionary_miss_problem()
        return {
            "product": {"id": str(product_key) if product_key else None, "name": batch.product.name},
            "subProduct": _entry(batch.sub_product) if batch.sub_product is not None else None,
            "productItem": _entry(batch.product_item) if batch.product_item is not None else None,
            "unit": _entry(batch.unit) if batch.unit is not None else None,
            "productType": None,
        }
    return {
        "product": {"id": str(product.guid), "name": product.name},
        "subProduct": _entry(batch.sub_product) if batch.sub_product is not None else None,
        "productItem": _entry(batch.product_item) if batch.product_item is not None else None,
        "unit": _entry(batch.unit) if batch.unit is not None else None,
        "productType": product.product_type,
    }


async def upsert_incoming(uow: AsyncSession, document: IncomingDocumentInput) -> Party:
    """Create or refresh one external document; return its party (no commit)."""
    resolve_binding_or_fail(document)
    if document.laboratory_id is None:  # pragma: no cover - resolve_binding guarantees
        raise _binding_problem()

    snapshot_dict: dict[str, Any] = document.snapshot.model_dump(mode="json", by_alias=True)
    hash_value = content_hash(snapshot_dict)

    existing = (
        await uow.execute(
            select(IncomingDocument)
            .where(
                IncomingDocument.contour == str(document.contour),
                IncomingDocument.evsd_uuid == document.evsd_uuid,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()

    if existing is None:
        classification = await _classification_snapshot(uow, document)
        row = IncomingDocument(
            contour=str(document.contour),
            evsd_uuid=document.evsd_uuid,
            laboratory_id=document.laboratory_id,
            external_status=document.external_status,
            source_snapshot=snapshot_dict,
            content_hash=hash_value,
            fetched_at=document.fetched_at,
        )
        uow.add(row)
        await uow.flush()
        party = Party(
            incoming_document_id=row.id,
            laboratory_id=document.laboratory_id,
            classification_snapshot=classification,
        )
        uow.add(party)
        await uow.flush()
        return party

    if existing.content_hash != hash_value:
        # A substantive change: re-resolve the classification FIRST (a new
        # unknown GUID fails the whole update exactly like a first import),
        # then refresh the document, the party's classification snapshot and
        # drop the user's hide decision for the old content (AT-23). Local
        # facts (reconciliation actual/marks) are never touched.
        classification = await _classification_snapshot(uow, document)
        await uow.execute(
            update(IncomingDocument)
            .where(IncomingDocument.id == existing.id)
            .values(
                source_snapshot=snapshot_dict,
                external_status=document.external_status,
                content_hash=hash_value,
                fetched_at=document.fetched_at,
                rev=existing.rev + 1,
            )
        )
        await uow.execute(
            update(Party)
            .where(Party.incoming_document_id == existing.id)
            .values(classification_snapshot=classification, rev=Party.rev + 1)
        )
        await uow.execute(
            delete(HiddenIncoming).where(
                HiddenIncoming.contour == str(document.contour),
                HiddenIncoming.evsd_uuid == document.evsd_uuid,
            )
        )
    else:
        await uow.execute(
            update(IncomingDocument)
            .where(IncomingDocument.id == existing.id)
            .values(fetched_at=document.fetched_at, rev=existing.rev + 1)
        )
    return (await uow.execute(select(Party).where(Party.incoming_document_id == existing.id))).scalar_one()


async def hide_incoming(
    uow: AsyncSession,
    actor_id: uuid.UUID,
    party_id: uuid.UUID,
    expected_revision: int | None,
) -> None:
    """Hide an expected arrival; started work/confirmation/intent block it.

    ``expected_revision`` is the parsed ``If-Match`` of the shown party
    revision (SPEC-04): absent → 422 ``REVISION_REQUIRED``, mismatched → 409
    ``REVISION_CONFLICT``, checked under the party row lock.
    """
    party = (await uow.execute(select(Party).where(Party.id == party_id).with_for_update())).scalar_one_or_none()
    if party is None:
        raise not_found()
    ensure_revision(expected_revision, party.rev)
    document = (
        await uow.execute(select(IncomingDocument).where(IncomingDocument.id == party.incoming_document_id))
    ).scalar_one()
    if await _started_work(uow, party.id):
        raise ProblemError(
            status=409,
            code="STATE_CONFLICT",
            title="State conflict",
            detail="Скрывать можно только ожидаемое поступление без начатой сверки, ВСЭ или внешнего намерения.",
        )
    await uow.execute(
        pg_insert(HiddenIncoming)
        .values(
            contour=document.contour,
            evsd_uuid=document.evsd_uuid,
            content_hash=document.content_hash,
            actor_id=actor_id,
        )
        .on_conflict_do_nothing()
    )
    await uow.flush()


async def _scalar_exists(db: AsyncSession, statement: Any) -> bool:
    result = await db.execute(statement)
    return bool(result.scalar())


async def _started_work(uow: AsyncSession, party_id: uuid.UUID) -> bool:
    reconciliation = await _scalar_exists(
        uow, select(func.count()).select_from(Reconciliation).where(Reconciliation.party_id == party_id)
    )
    confirmation = await _scalar_exists(
        uow, select(func.count()).select_from(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party_id)
    )
    return bool(reconciliation or confirmation or await _has_external_intent(uow, party_id))


async def _has_external_intent(uow: AsyncSession, party_id: uuid.UUID) -> bool:
    """Unresolved external receipt intent (``vetis_operations``, ТЗ-10).

    The table ships with ТЗ-10; until then the probe answers ``False`` and the
    guard still blocks started reconciliation/confirmation work.
    """
    probe = await uow.execute(select(func.to_regclass("vetis_operations")))
    if probe.scalar() is None:
        return False
    unresolved = await uow.execute(
        select(VETIS_OPERATIONS.c.party_id)
        .where(
            VETIS_OPERATIONS.c.party_id == party_id,
            VETIS_OPERATIONS.c.kind == "RECEIPT",
            VETIS_OPERATIONS.c.state.not_in(_UNRESOLVED_OPERATION_STATES),
        )
        .limit(1)
    )
    return unresolved.scalar() is not None
