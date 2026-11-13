"""The contour-scoped name cache of external participant objects (ТЗ DR18).

Import time (§7): each incoming document upserts its
``businessEntity``/``enterprise`` objects into ``vetis_reference_names`` — a
source name lands as ``SOURCE_XML``, a GUID-only object becomes a ``PENDING``
queue entry. The import is NEVER delayed or rejected by a missing name: the
upsert runs inside a savepoint and any failure only logs.

Worker (§8): due PENDING entries (and used RESOLVED entries older than 24 h)
are resolved through the pinned read-only EnterpriseService methods
``GetEnterpriseByGuid v2`` / ``GetBusinessEntityByGUID``. The endpoint,
namespaces and SOAP actions come from the pinned manifest — never from the
ВСД XML. Errors are retryable with exponential backoff (upper bound 24 h);
at most one job per ``(contour, entity_kind, guid)`` exists, because the
queue state lives in the row itself. No write method is ever reachable here
and no request is ever made per page view.

Read model (§6): XML name of the current revision → cache ``SOURCE_XML``
(the previous revision of the same document) → cache ``VETIS_LOOKUP`` →
honest ``Название не получено``. The enrichment never touches the raw XML,
checksum, revision or reconciliation facts; GUID/UUID are never shown to the
user instead of a name.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.integrations.vetis.models import (
    VetisContour,
    VetisEntityKind,
    VetisReferenceName,
)
from backend.src.modules.integrations.vetis.transport import (
    parse_business_entity_by_guid,
    parse_enterprise_by_guid,
)

__all__ = [
    "NAME_REFRESH_INTERVAL",
    "MAX_BACKOFF",
    "BACKOFF_BASE",
    "NAME_MISSING_TEXT",
    "NAME_PENDING_TEXT",
    "NAME_ERROR_TEXT",
    "ParticipantRef",
    "ResolvedName",
    "extract_participants",
    "upsert_reference_names",
    "resolve_participants",
    "resolve_due_reference_names",
    "backfill_reference_names",
    "participant_name_overrides",
]

_LOG = logging.getLogger("vetis.reference_names")

# The used-entry refresh cadence (§8): at most once per 24 hours, only from
# the worker tick — never per page view.
NAME_REFRESH_INTERVAL = timedelta(hours=24)
MAX_BACKOFF = timedelta(hours=24)
BACKOFF_BASE = timedelta(minutes=1)

# Honest UI fallbacks (§10); the raw GUID/UUID never replaces a name.
NAME_MISSING_TEXT = "Название не получено"
NAME_PENDING_TEXT = "Уточняем названия организаций…"
NAME_ERROR_TEXT = "Название временно недоступно"


@dataclass(frozen=True)
class ParticipantRef:
    """One participant object extracted from the CURRENT source revision."""

    kind: VetisEntityKind
    guid: uuid.UUID | None
    ref_uuid: uuid.UUID | None
    name: str | None


@dataclass(frozen=True)
class ResolvedName:
    """The resolved display name of one participant object (§6)."""

    name: str | None
    name_source: str  # SOURCE_XML | VETIS_LOOKUP | PENDING | ERROR | MISSING
    resolved_at: str | None
    guid: str | None
    ref_uuid: str | None


def _parse_uuid(value: object) -> uuid.UUID | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _ref_payload(holder: object, key: str) -> dict[str, object]:
    if not isinstance(holder, dict):
        return {}
    raw = holder.get(key)
    return raw if isinstance(raw, dict) else {}


def extract_participants(snapshot: object) -> dict[str, dict[str, ParticipantRef]]:
    """Extract the businessEntity/enterprise refs of the CURRENT revision.

    ``snapshot`` is the ``source_snapshot`` JSON (``vdDocument`` level is
    resolved inside). Each object keeps its OWN level: the businessEntity and
    the enterprise of one side are separate identities (ТЗ DR18 §5).
    """
    root = snapshot if isinstance(snapshot, dict) else {}
    payload = root.get("vdDocument") if isinstance(root.get("vdDocument"), dict) else root
    participants: dict[str, dict[str, ParticipantRef]] = {}
    for side, key in (("sender", "consignor"), ("receiver", "consignee")):
        holder = payload.get(key) if isinstance(payload, dict) else None
        entity = _ref_payload(holder, "businessEntity")
        enterprise = _ref_payload(holder, "enterprise")
        top_name = holder.get("name") if isinstance(holder, dict) else None
        top_name = str(top_name) if isinstance(top_name, str) and top_name.strip() else None
        entity_name = entity.get("name")
        participants[side] = {
            VetisEntityKind.BUSINESS_ENTITY.value: ParticipantRef(
                kind=VetisEntityKind.BUSINESS_ENTITY,
                guid=_parse_uuid(entity.get("guid")),
                ref_uuid=_parse_uuid(entity.get("uuid")),
                name=str(entity_name) if isinstance(entity_name, str) and entity_name.strip() else None,
            ),
            VetisEntityKind.ENTERPRISE.value: ParticipantRef(
                kind=VetisEntityKind.ENTERPRISE,
                guid=_parse_uuid(enterprise.get("guid")),
                ref_uuid=_parse_uuid(enterprise.get("uuid")),
                name=str(enterprise.get("name") or top_name)
                if (enterprise.get("name") or top_name)
                else None,
            ),
        }
    return participants


async def _upsert_one(
    db: AsyncSession,
    contour: str,
    ref: ParticipantRef,
    *,
    now: datetime,
) -> bool:
    """Upsert ONE object; returns True when a row was created (queue entry)."""
    if ref.guid is None:
        return False
    row = (
        await db.execute(
            select(VetisReferenceName).where(
                VetisReferenceName.contour == contour,
                VetisReferenceName.entity_kind == ref.kind.value,
                VetisReferenceName.guid == ref.guid,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(
            VetisReferenceName(
                contour=contour,
                entity_kind=ref.kind.value,
                guid=ref.guid,
                uuid=ref.ref_uuid,
                name=ref.name,
                source="SOURCE_XML" if ref.name else None,
                status="RESOLVED" if ref.name else "PENDING",
                # A fresh PENDING entry is due immediately; a named one is
                # refreshed at most once per 24 h (§8).
                next_check_at=(now + NAME_REFRESH_INTERVAL) if ref.name else now,
                updated_at=now,
            )
        )
        return True
    if ref.name and (row.name is None or row.source != "VETIS_LOOKUP"):
        # A changed source name updates the displayed name (§7); a good
        # VETIS_LOOKUP name is never overwritten by an empty observation.
        row.name = ref.name
        row.source = "SOURCE_XML"
        row.status = "RESOLVED"
        row.last_problem_code = None
        row.failure_count = 0
        row.updated_at = now
    if row.uuid is None and ref.ref_uuid is not None:
        row.uuid = ref.ref_uuid
        row.updated_at = now
    return False


async def upsert_reference_names(
    db: AsyncSession,
    contour: VetisContour | str,
    snapshot: object,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    """Upsert every participant object of one imported document (§7)."""
    current = now or datetime.now(UTC)
    contour_text = str(contour)
    participants = extract_participants(snapshot)
    created = 0
    seen = 0
    for refs in participants.values():
        for ref in refs.values():
            if ref.guid is None:
                continue
            seen += 1
            if await _upsert_one(db, contour_text, ref, now=current):
                created += 1
    return {"seen": seen, "created": created}


async def _load_rows(
    db: AsyncSession, contour: str, keys: set[tuple[uuid.UUID, str]]
) -> dict[tuple[uuid.UUID, str], VetisReferenceName]:
    """Load the cache rows of the requested (guid, kind) keys ONLY.

    The key pair is the §5 identity: the same GUID value as a
    ``BUSINESS_ENTITY`` and as an ``ENTERPRISE`` are two different rows and
    are never merged on the read path either.
    """
    if not keys:
        return {}
    guids = sorted({guid for guid, _kind in keys})
    kinds = sorted({kind for _guid, kind in keys})
    rows = (
        await db.execute(
            select(VetisReferenceName).where(
                VetisReferenceName.contour == contour,
                VetisReferenceName.guid.in_(guids),
                VetisReferenceName.entity_kind.in_(kinds),
            )
        )
    ).scalars()
    # Only the REQUESTED (guid, kind) pairs are consumed — a same-GUID row of
    # the other kind can never leak across.
    return {(row.guid, row.entity_kind): row for row in rows if (row.guid, row.entity_kind) in keys}


async def resolve_participants(
    db: AsyncSession, contour: VetisContour | str, snapshot: object
) -> dict[str, dict[str, ResolvedName]]:
    """The §6 read model of the participant names (NO VetIS request here).

    Priority per object: the XML name of the current revision → the cached
    ``SOURCE_XML`` name (the previous revision of the same document) → the
    cached ``VETIS_LOOKUP`` name → honest fallback with an honest state.
    """
    contour_text = str(contour)
    participants = extract_participants(snapshot)
    keys: set[tuple[uuid.UUID, str]] = set()
    for refs in participants.values():
        for ref in refs.values():
            if ref.guid is not None:
                keys.add((ref.guid, ref.kind.value))
    rows = await _load_rows(db, contour_text, keys)
    result: dict[str, dict[str, ResolvedName]] = {}
    for side, refs in participants.items():
        resolved: dict[str, ResolvedName] = {}
        for kind_value, ref in refs.items():
            guid = ref.guid
            row = rows.get((guid, kind_value)) if guid is not None else None
            if ref.name:
                resolved[kind_value] = ResolvedName(
                    name=ref.name,
                    name_source="SOURCE_XML",
                    resolved_at=None,
                    guid=str(guid) if guid else None,
                    ref_uuid=str(ref.ref_uuid) if ref.ref_uuid else None,
                )
            elif row is not None and row.name:
                resolved[kind_value] = ResolvedName(
                    name=row.name,
                    name_source=str(row.source or "VETIS_LOOKUP"),
                    resolved_at=row.last_checked_at.isoformat() if row.last_checked_at else None,
                    guid=str(guid) if guid else None,
                    ref_uuid=str(row.uuid) if row.uuid is not None else None,
                )
            else:
                # Missing/Pending/Error are honest states; no GUID/UUID ever
                # surfaces instead of a name (§10).
                if row is None:
                    state = "MISSING"
                elif row.status == "ERROR":
                    state = "ERROR"
                elif row.status == "PENDING":
                    state = "PENDING"
                else:
                    state = "MISSING"
                resolved[kind_value] = ResolvedName(
                    name=None,
                    name_source=state,
                    resolved_at=None,
                    guid=str(guid) if guid else None,
                    ref_uuid=str(ref.ref_uuid) if ref.ref_uuid else None,
                )
        result[side] = resolved
    return result


NAME_FIELD_KEYS = {
    ("sender", "BUSINESS_ENTITY"): "senderOwner",
    ("sender", "ENTERPRISE"): "senderEnterprise",
    ("receiver", "BUSINESS_ENTITY"): "receiverOwner",
    ("receiver", "ENTERPRISE"): "receiverEnterprise",
}


def participant_name_overrides(
    participants: dict[str, dict[str, ResolvedName]],
) -> dict[str, str | None]:
    """The flat field overrides for the unified read model (§9).

    Old keys keep their single meaning; each name additionally carries its
    honest state under ``<key>NameSource`` (SOURCE_XML | VETIS_LOOKUP |
    PENDING | ERROR | MISSING) so the UI can render §10 without guessing.
    """
    fields: dict[str, str | None] = {}
    for (side, kind), key in NAME_FIELD_KEYS.items():
        resolved = participants.get(side, {}).get(kind)
        fields[key] = resolved.name if resolved is not None else None
        fields[f"{key}NameSource"] = resolved.name_source if resolved is not None else "MISSING"
    return fields


# --- the read-only worker resolution (§8) ---------------------------------------


class EnterpriseLookupPort(Protocol):
    """The two pinned read-only lookup methods (never a write)."""

    async def get_enterprise_by_guid(self, guid: str) -> str: ...

    async def get_business_entity_by_guid(self, guid: str) -> str: ...


def _backoff(failure_count: int) -> timedelta:
    """Exponential backoff with the 24-hour upper bound (§8)."""
    delay = BACKOFF_BASE * (2 ** max(0, failure_count - 1))
    return delay if delay < MAX_BACKOFF else MAX_BACKOFF


def _parse_source_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _claim_due(db: AsyncSession, *, now: datetime, limit: int) -> list[VetisReferenceName]:
    """Claim due rows with SKIP LOCKED (at most one job per key)."""
    rows = (
        await db.execute(
            select(VetisReferenceName)
            .where(
                VetisReferenceName.next_check_at.is_(None)
                | (VetisReferenceName.next_check_at <= now),
                VetisReferenceName.status.in_(("PENDING", "ERROR", "RESOLVED")),
            )
            .order_by(VetisReferenceName.next_check_at.nulls_first())
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).scalars()
    claimed = list(rows)
    for row in claimed:
        # The lease: a concurrent worker never repeats this key.
        row.next_check_at = now + timedelta(minutes=5)
        row.updated_at = now
    return claimed


async def _apply_lookup_result(
    db: AsyncSession, row: VetisReferenceName, record: dict[str, object] | None, *, now: datetime
) -> None:
    """Apply one lookup outcome honestly; never a fabricated name (§8)."""
    if record is None or not (record.get("active") is True and record.get("last") is True):
        # A not-active/not-last answer never replaces a good name.
        problem = "VETIS_REFERENCE_INACTIVE" if record is None else "VETIS_REFERENCE_NOT_LAST"
        row.last_problem_code = problem
        row.failure_count = row.failure_count + 1
        if row.name is None:
            row.status = "PENDING"
        row.next_check_at = now + _backoff(row.failure_count)
        row.updated_at = now
        return
    name = record.get("name") if isinstance(record, dict) else None
    if not isinstance(name, str) or not name.strip():
        row.last_problem_code = "VETIS_REFERENCE_NAME_ABSENT"
        row.failure_count = row.failure_count + 1
        if row.name is None:
            row.status = "PENDING"
        row.next_check_at = now + _backoff(row.failure_count)
        row.updated_at = now
        return
    row.name = name.strip()
    row.source = "VETIS_LOOKUP"
    row.status = "RESOLVED"
    row.active = bool(record.get("active"))
    row.uuid = _parse_uuid(record.get("uuid"))
    row.source_created_at = _parse_source_timestamp(record.get("created_at"))
    row.source_updated_at = _parse_source_timestamp(record.get("updated_at"))
    row.last_checked_at = now
    row.next_check_at = now + NAME_REFRESH_INTERVAL
    row.failure_count = 0
    row.last_problem_code = None
    row.updated_at = now


async def _apply_lookup_failure(
    db: AsyncSession, row: VetisReferenceName, problem: str, *, now: datetime
) -> None:
    """A transport/API error keeps the previous name and schedules a retry."""
    row.last_problem_code = problem
    row.failure_count = row.failure_count + 1
    if row.name is None:
        row.status = "PENDING"
    else:
        row.status = "ERROR"
    row.last_checked_at = now
    row.next_check_at = now + _backoff(row.failure_count)
    row.updated_at = now


async def resolve_due_reference_names(
    db: AsyncSession,
    transport: EnterpriseLookupPort,
    *,
    now: datetime | None = None,
    limit: int = 20,
) -> dict[str, int]:
    """Resolve due cache entries via the pinned read-only methods (§8).

    One tick claims due rows (SKIP LOCKED), performs the lookups OUTSIDE any
    transaction and applies each result in its own committed transaction.
    The never-delete rule holds: an error keeps the previous name.
    """
    current = now or datetime.now(UTC)
    claimed = await _claim_due(db, now=current, limit=limit)
    keys = [(row.contour, row.entity_kind, row.guid) for row in claimed]
    await db.commit()
    resolved = 0
    retried = 0
    for contour, kind, guid in keys:
        try:
            if kind == VetisEntityKind.ENTERPRISE.value:
                record = parse_enterprise_by_guid(await transport.get_enterprise_by_guid(str(guid)))
            else:
                record = parse_business_entity_by_guid(await transport.get_business_entity_by_guid(str(guid)))
            # The cheap echo guard (§8): the response GUID must match the
            # requested key before ANY result is applied; a mismatch is a
            # diagnostic + retry, never an applied name.
            echo = record.get("guid")
            if echo is not None and _parse_uuid(echo) != guid:
                record = {"problem": "VETIS_REFERENCE_GUID_MISMATCH"}
        except Exception as exc:  # noqa: BLE001 - any failure is an honest retry
            problem = getattr(exc, "code", None) or type(exc).__name__
            row = (
                await db.execute(
                    select(VetisReferenceName).where(
                        VetisReferenceName.contour == contour,
                        VetisReferenceName.entity_kind == kind,
                        VetisReferenceName.guid == guid,
                    )
                )
            ).scalar_one_or_none()
            if row is not None:
                await _apply_lookup_failure(db, row, str(problem)[:128], now=datetime.now(UTC))
            await db.commit()
            retried += 1
            _LOG.warning(
                "reference_name_resolution_failed",
                extra={"contour": contour, "entity_kind": kind, "problem": str(problem)},
            )
            continue
        row = (
            await db.execute(
                select(VetisReferenceName).where(
                    VetisReferenceName.contour == contour,
                    VetisReferenceName.entity_kind == kind,
                    VetisReferenceName.guid == guid,
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            if isinstance(record, dict) and record.get("problem") == "VETIS_REFERENCE_GUID_MISMATCH":
                # The response GUID did not match the requested key: never
                # applied — a diagnostic + retry instead (§8).
                await _apply_lookup_failure(
                    db, row, "VETIS_REFERENCE_GUID_MISMATCH", now=datetime.now(UTC)
                )
                retried += 1
            else:
                await _apply_lookup_result(db, row, record, now=datetime.now(UTC))
                resolved += 1
        await db.commit()
    return {"claimed": len(keys), "resolved": resolved, "retried": retried}


async def backfill_reference_names(
    db: AsyncSession, documents: list[tuple[str, object]], *, now: datetime | None = None
) -> dict[str, int]:
    """The safe idempotent backfill over existing incoming documents (§7).

    ``documents`` carries ``(contour, source_snapshot)`` pairs; only derived
    cache rows/queue entries are created — the raw XML, checksum, revision
    and every local fact stay untouched. A repeated run creates nothing new
    (the same upsert dedup rules apply).
    """
    created = 0
    seen = 0
    for contour, snapshot in documents:
        counters = await upsert_reference_names(db, contour, snapshot, now=now or datetime.now(UTC))
        created += counters["created"]
        seen += counters["seen"]
    return {"seen": seen, "created": created}


def compose_reference_transport(manifest: object) -> EnterpriseLookupPort:
    """Build the pinned EnterpriseService lookup transport from the profile.

    Missing pins → honest 503 before any network contact; the endpoint and
    both SOAP actions come from the pinned manifest, never guessed (§8).
    """
    from backend.src.modules.integrations.vetis.manifest import (
        integration_not_configured,
        load_secret_profile,
        secret_profile_path,
    )
    from backend.src.modules.integrations.vetis.transport import (
        ZeepEnterpriseLookupTransport,
        enterprise_allowlist,
    )

    if manifest.schema_pins.status != "PINNED" or not manifest.enterprise_endpoint:
        raise integration_not_configured()
    gateway_user = gateway_password = None
    profile_path = secret_profile_path()
    if profile_path:
        profile = load_secret_profile(profile_path)
        gateway_user = profile.gateway_user
        gateway_password = profile.gateway_password
    enterprise_action = manifest.soap_actions.get(
        "enterprise_by_guid", "getEnterpriseByGuidRequest"
    )
    business_entity_action = manifest.soap_actions.get(
        "business_entity_by_guid", "getBusinessEntityByGUIDRequest"
    )
    return ZeepEnterpriseLookupTransport(
        endpoint=manifest.enterprise_endpoint,
        enterprise_action=enterprise_action,
        business_entity_action=business_entity_action,
        connect_timeout_s=manifest.constraints.connect_timeout_s,
        read_timeout_s=manifest.constraints.read_timeout_s,
        allowed_urls=enterprise_allowlist(manifest),
        gateway_user=gateway_user,
        gateway_password=gateway_password,
    )
