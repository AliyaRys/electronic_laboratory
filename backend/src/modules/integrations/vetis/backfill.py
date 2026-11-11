"""Idempotent re-normalization of already saved incoming eVSDs (ТЗ DR5 §11).

One backfill run:

1. reads the LAST saved ``vetis_source_documents.raw_xml`` of every document;
2. re-parses it with the FIXED normalizer (package quantity by the maximal
   package level, separate mass, purpose identifiers);
3. updates ``incoming_documents.source_snapshot`` and the derived content
   hash ONLY when they really change — the raw XML and its checksum are never
   touched and no confirmed local fact (receipt/examination/report) is
   rewritten;
4. a content change bumps the document and party revisions (the existing
   invalidation of an unfinished reconciliation) and drops the hide decision
   of the outdated content version, exactly like a substantive re-import;
5. prints the counters: viewed / fixed / unchanged / error.

A document without saved raw XML is never repaired by guessing: it is counted
as an error diagnostic and waits for the next read sync. A second run makes
zero changes (idempotence is proven by ``test_backfill_idempotent``).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import get_session_factory
from backend.src.modules.arrivals.commands import content_hash
from backend.src.modules.arrivals.models import HiddenIncoming, IncomingDocument, Party
from backend.src.modules.integrations.vetis.models import VetisSourceDocument
from backend.src.modules.integrations.vetis.normalizer import normalize_snapshot, parse_vet_document_list

__all__ = ["run_backfill", "BackfillCounters"]

_LOG = logging.getLogger("vetis.backfill")


class BackfillCounters:
    """The honest run counters (ТЗ DR5 §11 item 8)."""

    def __init__(self) -> None:
        self.viewed = 0
        self.fixed = 0
        self.unchanged = 0
        self.error = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "viewed": self.viewed,
            "fixed": self.fixed,
            "unchanged": self.unchanged,
            "error": self.error,
        }


async def run_backfill(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> dict[str, int]:
    """Re-normalize every saved raw XML once; returns the run counters."""
    factory = session_factory or get_session_factory()
    counters = BackfillCounters()
    async with factory() as db:
        pairs = (
            await db.execute(
                select(IncomingDocument.contour, IncomingDocument.evsd_uuid).order_by(
                    IncomingDocument.created_at
                )
            )
        ).all()
        for contour, evsd_uuid in pairs:
            counters.viewed += 1
            await _backfill_one(db, str(contour), evsd_uuid, counters)
            await db.commit()
    _LOG.info("backfill_completed", extra=counters.as_dict())
    return counters.as_dict()


async def _backfill_one(
    db: AsyncSession, contour: str, evsd_uuid: uuid.UUID, counters: BackfillCounters
) -> None:
    document = (
        await db.execute(
            select(IncomingDocument)
            .where(IncomingDocument.contour == contour, IncomingDocument.evsd_uuid == evsd_uuid)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if document is None:
        counters.error += 1
        return
    raw = (
        await db.execute(
            select(VetisSourceDocument.raw_xml)
            .where(VetisSourceDocument.contour == contour, VetisSourceDocument.evsd_uuid == evsd_uuid)
            .order_by(VetisSourceDocument.revision.desc(), VetisSourceDocument.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if raw is None:
        # Never repaired by guessing: waits for the next read sync (§11).
        counters.error += 1
        _LOG.warning(
            "backfill_missing_raw_xml",
            extra={"contour": contour, "evsd_uuid": str(evsd_uuid)},
        )
        return
    try:
        entries = parse_vet_document_list(raw)
        if not entries:
            # The stored raw can be a bare vetDocument element; nest it under a
            # synthetic parent so the same namespace-aware parser applies.
            from xml.etree import ElementTree as ET

            root = ET.fromstring(raw)
            if not root.tag.endswith("}vetDocument"):
                raise ValueError("сырой XML не является vetDocument")
            parent = ET.Element("vetDocumentList")
            parent.append(root)
            entries = parse_vet_document_list(ET.tostring(parent, encoding="unicode"))
        if len(entries) != 1:
            raise ValueError(f"ожидался один vetDocument, получено {len(entries)}")
        entry = entries[0]
        new_snapshot = normalize_snapshot(entry).model_dump(mode="json", by_alias=True)
    except Exception as exc:  # noqa: BLE001 - a controlled per-document diagnostic
        counters.error += 1
        _LOG.warning(
            "backfill_parse_error",
            extra={"contour": contour, "evsd_uuid": str(evsd_uuid), "detail": type(exc).__name__},
        )
        return

    new_hash = content_hash(new_snapshot)
    if document.content_hash == new_hash:
        counters.unchanged += 1
        return
    await db.execute(
        update(IncomingDocument)
        .where(IncomingDocument.id == document.id)
        .values(
            source_snapshot=new_snapshot,
            external_status=entry.document_status,
            content_hash=new_hash,
            rev=document.rev + 1,
        )
    )
    await db.execute(
        update(Party)
        .where(Party.incoming_document_id == document.id)
        .values(rev=Party.rev + 1)
    )
    await db.execute(
        delete(HiddenIncoming).where(
            HiddenIncoming.contour == contour, HiddenIncoming.evsd_uuid == evsd_uuid
        )
    )
    counters.fixed += 1


if __name__ == "__main__":  # pragma: no cover - the operator entry point
    import asyncio

    asyncio.run(run_backfill())
