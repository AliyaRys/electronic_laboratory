"""The read-only cargo-purpose dictionary sync (ТЗ DR5 §9.4).

The full ``GetPurposeList`` pass runs ONLY from the worker tick — never per
page view and never per document. Rules proven by
``backend/tests/vetis/test_purpose_sync.py``:

- page ``count=160`` with offset pagination until the whole ``total`` is read;
- the checkpoint (``mercury_purpose_sync_state.last_success``) moves ONLY
  after a complete pass was applied atomically — a partial or failed response
  never corrupts the previously stored dictionary;
- records that disappeared from a full actual list stay in the table but are
  marked ``active=false``/``is_last=false`` (no physical deletion);
- overlap protection: one sync per contour at a time (transaction advisory
  lock);
- ≥14 days between full passes; fresh checkpoint never triggers the network;
- logs carry only counters/contour/problem code — no credentials, no SOAP XML.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Protocol

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.database import get_session_factory
from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.manifest import VetisManifest, integration_not_configured
from backend.src.modules.integrations.vetis.models import MercuryPurposeGuid, MercuryPurposeSyncState
from backend.src.modules.integrations.vetis.transport import PURPOSE_LIST_PAGE, parse_purpose_list

__all__ = [
    "PURPOSE_SYNC_INTERVAL",
    "PurposePageSource",
    "purpose_due",
    "run_purpose_sync",
    "run_due_purpose_sync",
    "compose_purpose_transport",
]

PURPOSE_SYNC_INTERVAL = timedelta(days=14)

_PURPOSE_LOG = logging.getLogger("vetis.purpose.sync")


class PurposePageSource(Protocol):
    """One page of the pinned read-only DictionaryService boundary."""

    async def get_purpose_list_page(self, *, offset: int, count: int) -> str: ...


def _lock_key(contour: str) -> int:
    """A stable signed-int64 advisory-lock key per contour (never a credential)."""
    digest = hashlib.sha256(f"mercury_purpose_sync:{contour}".encode()).digest()[:8]
    return int.from_bytes(digest, "big", signed=True)


def purpose_due(state: MercuryPurposeSyncState | None, *, now: datetime) -> bool:
    """Fresh checkpoint → not due before 14 days; empty/absent → due."""
    if state is None or state.last_success is None:
        return True
    return now - state.last_success >= PURPOSE_SYNC_INTERVAL


async def _acquire_lock(db: AsyncSession, contour: str) -> bool:
    """True when THIS run owns the contour (overlap protection)."""
    row = (
        await db.execute(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": _lock_key(contour)})
    ).scalar()
    return bool(row)


async def run_purpose_sync(
    contour: str,
    *,
    transport: PurposePageSource,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    now: datetime | None = None,
    page_count: int = PURPOSE_LIST_PAGE,
    force: bool = False,
    state_lock: object | None = None,
) -> dict[str, object]:
    """One full read-only pass; returns honest counters, never fabricates.

    ``force`` runs the pass even with a fresh checkpoint (an explicit operator
    command or a test); the scheduled tick never sets it.
    ``state_lock`` is a testing seam for the overlap probe (a locked fake).
    """
    del state_lock  # the advisory lock below is the production overlap guard
    factory = session_factory or get_session_factory()
    current = now or datetime.now(UTC)

    # --- due + overlap gate -----------------------------------------------------
    async with factory() as db:
        if not await _acquire_lock(db, contour):
            _PURPOSE_LOG.info("purpose_sync_skipped_overlap", extra={"contour": contour})
            return {"result": "SKIPPED_OVERLAP"}
        state = (
            await db.execute(
                select(MercuryPurposeSyncState)
                .where(MercuryPurposeSyncState.contour == contour)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not purpose_due(state, now=current) and not force:
            return {"result": "NOT_DUE", "last_success": state.last_success.isoformat() if state else None}
        if state is None:
            db.add(MercuryPurposeSyncState(contour=contour, last_attempt=current))
        else:
            state.last_attempt = current
            state.updated_at = current
        await db.commit()

    # --- the full paginated pass (failures leave the checkpoint untouched) ------
    collected: dict[str, dict[str, object]] = {}
    total = 0
    pages = 0
    offset = 0
    try:
        while True:
            response_xml = await transport.get_purpose_list_page(offset=offset, count=page_count)
            records, page_total = parse_purpose_list(response_xml)
            total = max(total, page_total)
            pages += 1
            for record in records:
                collected[str(record["guid"])] = record
            offset += len(records)
            if not records or offset >= total:
                break
        if pages > 1 and offset < total:
            raise ProblemError(
                status=502,
                code="VETIS_PURPOSE_LIST_INCOMPLETE",
                title="VetIS purpose list incomplete",
                detail="Полный проход списка назначений не завершён; контрольная точка не изменена.",
            )
    except ProblemError as problem:
        await _record_failure(factory, contour, problem.code, current)
        raise
    except Exception as exc:  # noqa: BLE001 - any failure is an honest FAILED attempt
        code = "VETIS_PURPOSE_SYNC_FAILED"
        await _record_failure(factory, contour, code, current)
        raise ProblemError(status=502, code=code, title="VetIS purpose sync failed", detail=str(exc)) from exc

    # --- atomic apply + checkpoint ----------------------------------------------
    async with factory() as db:
        if not await _acquire_lock(db, contour):
            return {"result": "SKIPPED_OVERLAP"}
        applied = await _apply_pass(db, contour, collected, source="GetPurposeList")
        state = (
            await db.execute(
                select(MercuryPurposeSyncState)
                .where(MercuryPurposeSyncState.contour == contour)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if state is None:
            state = MercuryPurposeSyncState(contour=contour)
            db.add(state)
        state.last_success = current
        state.last_attempt = current
        state.failures = 0
        state.problem_code = None
        state.records = len(collected)
        state.pages = pages
        state.updated_at = current
        await db.commit()
    _PURPOSE_LOG.info(
        "purpose_sync_completed",
        extra={"contour": contour, "records": len(collected), "pages": pages, "duration_hint": None},
    )
    return {
        "result": "SUCCESS",
        "contour": contour,
        "records": len(collected),
        "pages": pages,
        "total": total,
        "upserted": applied["upserted"],
        "deactivated": applied["deactivated"],
        "unchanged": applied["unchanged"],
    }


async def _record_failure(
    factory: async_sessionmaker[AsyncSession], contour: str, code: str, now: datetime
) -> None:
    """The failed attempt is recorded WITHOUT moving the checkpoint."""
    async with factory() as db:
        state = (
            await db.execute(
                select(MercuryPurposeSyncState)
                .where(MercuryPurposeSyncState.contour == contour)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if state is None:
            state = MercuryPurposeSyncState(contour=contour)
            db.add(state)
        state.last_attempt = now
        state.failures = state.failures + 1
        state.problem_code = code
        state.updated_at = now
        await db.commit()
    _PURPOSE_LOG.warning("purpose_sync_failed", extra={"contour": contour, "problem": code})


async def _apply_pass(
    db: AsyncSession, contour: str, collected: dict[str, dict[str, object]], *, source: str
) -> dict[str, int]:
    """Upsert the full actual list; missing rows become inactive (never deleted)."""
    upserted = 0
    unchanged = 0
    from sqlalchemy import select

    existing = {
        str(row.guid): row
        for row in (
            await db.execute(select(MercuryPurposeGuid).where(MercuryPurposeGuid.contour == contour))
        ).scalars()
    }
    for guid_text, record in collected.items():
        guid = uuid.UUID(guid_text)
        row = existing.get(guid_text)
        created_at = record.get("created_at")
        updated_at = record.get("updated_at")
        previous = record.get("previous")
        values = {
            "current_uuid": uuid.UUID(str(record["uuid"])) if record.get("uuid") else guid,
            "name": str(record["name"]),
            "active": bool(record.get("active")),
            "is_last": bool(record.get("last")),
            "external_status": int(record.get("status") or 0),
            "source_created_at": datetime.fromisoformat(str(created_at)) if created_at else None,
            "source_updated_at": datetime.fromisoformat(str(updated_at)) if updated_at else None,
            "previous_uuid": uuid.UUID(str(previous)) if previous else None,
            "source": source,
            "synchronized_at": datetime.now(UTC),
        }
        if row is None:
            db.add(MercuryPurposeGuid(contour=contour, guid=guid, **values))
            upserted += 1
        elif (
            row.name != values["name"]
            or row.current_uuid != values["current_uuid"]
            or row.active != values["active"]
            or row.is_last != values["is_last"]
            or row.external_status != values["external_status"]
        ):
            for key, value in values.items():
                setattr(row, key, value)
            upserted += 1
        else:
            row.synchronized_at = values["synchronized_at"]
            unchanged += 1
    deactivated = 0
    for guid_text, row in existing.items():
        if guid_text not in collected and (row.active or row.is_last):
            row.active = False
            row.is_last = False
            row.synchronized_at = datetime.now(UTC)
            deactivated += 1
    return {"upserted": upserted, "deactivated": deactivated, "unchanged": unchanged}


async def run_due_purpose_sync(
    *,
    transport: PurposePageSource,
    manifest: VetisManifest,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    """The worker-tick entry: syncs the manifest contour only when due."""
    if not manifest.dictionary_endpoint:
        return {"result": "NOT_CONFIGURED"}
    contour = manifest.contour
    factory = session_factory or get_session_factory()
    async with factory() as db:
        state = (
            await db.execute(
                select(MercuryPurposeSyncState).where(MercuryPurposeSyncState.contour == contour)
            )
        ).scalar_one_or_none()
    if not purpose_due(state, now=now or datetime.now(UTC)):
        return {"result": "NOT_DUE"}
    return await run_purpose_sync(contour, transport=transport, session_factory=session_factory, now=now)


def compose_purpose_transport(manifest: VetisManifest) -> tuple[PurposePageSource, str]:
    """Build the pinned dictionary transport from the server-side profile.

    Returns (transport, contour). Missing pins → honest 503 before network.
    """
    from backend.src.modules.integrations.vetis.manifest import load_secret_profile, secret_profile_path
    from backend.src.modules.integrations.vetis.transport import (
        ZeepDictionaryTransport,
        dictionary_allowlist,
    )

    if manifest.schema_pins.status != "PINNED":
        raise integration_not_configured()
    endpoint = manifest.dictionary_endpoint
    if not endpoint:
        raise integration_not_configured()
    gateway_user = gateway_password = None
    profile_path = secret_profile_path()
    if profile_path:
        profile = load_secret_profile(profile_path)
        gateway_user = profile.gateway_user
        gateway_password = profile.gateway_password
    transport = ZeepDictionaryTransport(
        endpoint=endpoint,
        soap_action=manifest.soap_actions.get("purpose_list", "getPurposeListRequest"),
        connect_timeout_s=manifest.constraints.connect_timeout_s,
        read_timeout_s=manifest.constraints.read_timeout_s,
        allowed_urls=dictionary_allowlist(manifest),
        gateway_user=gateway_user,
        gateway_password=gateway_password,
    )
    return transport, manifest.contour
