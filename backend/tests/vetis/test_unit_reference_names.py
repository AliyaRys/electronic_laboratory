"""The UNIT reference names of the conclusion (fix-loop DR55).

The VetIS side is proven on обезличенные pinned fixtures with a recording
spy of the read-only boundary — live VetIS calls in tests are FORBIDDEN; the
spy proves only ``GetUnitByUuidOperation`` (a PRODUCT_SERVICE read-only
operation) is ever reachable and zero writes happen.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.integrations.vetis.models import VetisEntityKind, VetisReferenceName
from backend.src.modules.integrations.vetis.reference_names import (
    extract_unit,
    resolve_due_reference_names,
    resolved_unit_names,
    upsert_reference_names,
)
from backend.src.modules.integrations.vetis.transport import (
    SpyEnterpriseLookupTransport,
    build_get_unit_by_uuid_request,
    is_read_only_operation,
    parse_unit_by_uuid,
)

# The обезличенный live case: the VetIS unit carries BOTH identities; the
# GetUnitByUuid key is the UUID, the batch GUID travels paired.
UNIT_UUID = uuid.UUID("069792f0-053d-11e1-99b4-d8d385fbc9e8")
UNIT_GUID = uuid.UUID("21ed96c9-337b-4a27-8761-c6e6ad3c9f5b")
_PILOT = "PILOT"

UNIT_RESPONSE = (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
    '<soapenv:Body><ws:getUnitByUuidResponse '
    'xmlns:ws="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2">'
    '<dt:unit xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
    f"<bs:uuid>{UNIT_UUID}</bs:uuid>"
    f"<bs:guid>{UNIT_GUID}</bs:guid>"
    "<bs:active>true</bs:active><bs:last>true</bs:last><bs:status>100</bs:status>"
    "<bs:createDate>2026-01-01T00:00:00</bs:createDate>"
    "<bs:updateDate>2026-06-01T00:00:00</bs:updateDate>"
    "<dt:name>кг</dt:name>"
    "</dt:unit></ws:getUnitByUuidResponse></soapenv:Body></soapenv:Envelope>"
)


def unit_snapshot(*, unit_uuid: str | None = str(UNIT_UUID), name: object = None) -> dict:
    unit: dict[str, object] = {"guid": str(UNIT_GUID)}
    if unit_uuid is not None:
        unit["uuid"] = unit_uuid
    if name is not None:
        unit["name"] = name
    return {"vdDocument": {"batch": {"volume": "4", "unit": unit}}}


# --- the transport surface ----------------------------------------------------------


def test_get_unit_by_uuid_is_read_only_and_builds_the_pinned_envelope() -> None:
    assert is_read_only_operation("GetUnitByUuidOperation")
    request = build_get_unit_by_uuid_request(str(UNIT_UUID))
    assert str(UNIT_UUID) in request
    assert "getUnitByUuidRequest" in request


def test_parse_unit_by_uuid_reads_the_own_name_only() -> None:
    record = parse_unit_by_uuid(UNIT_RESPONSE)
    assert record["name"] == "кг"
    assert record["uuid"] == str(UNIT_UUID)
    assert record["active"] is True and record["last"] is True


# --- the cache mechanics ------------------------------------------------------------


async def test_upsert_creates_a_unit_queue_entry_keyed_by_the_uuid(db_session: AsyncSession) -> None:
    counters = await upsert_reference_names(db_session, _PILOT, unit_snapshot(), now=datetime.now(UTC))
    await db_session.commit()
    row = (
        await db_session.execute(
            select(VetisReferenceName).where(
                VetisReferenceName.contour == _PILOT, VetisReferenceName.entity_kind == VetisEntityKind.UNIT.value
            )
        )
    ).scalar_one()
    assert counters["created"] == 1
    assert row.guid == UNIT_UUID  # the resolution key is the VetIS unit UUID
    assert row.uuid == UNIT_GUID  # the batch GUID travels paired
    assert row.status == "PENDING" and row.name is None


async def test_named_snapshot_lands_as_resolved_source_xml(db_session: AsyncSession) -> None:
    await upsert_reference_names(db_session, _PILOT, unit_snapshot(name="кг"), now=datetime.now(UTC))
    await db_session.commit()
    row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.entity_kind == "UNIT"))
    ).scalar_one()
    assert row.name == "кг" and row.source == "SOURCE_XML" and row.status == "RESOLVED"


async def test_snapshot_without_unit_uuid_keys_the_row_by_the_guid_honestly(db_session: AsyncSession) -> None:
    """No unit uuid → the batch GUID becomes the key; such a row can never
    resolve through GetUnitByUuidOperation and stays an honest missing."""
    await upsert_reference_names(db_session, _PILOT, unit_snapshot(unit_uuid=None), now=datetime.now(UTC))
    await db_session.commit()
    row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.entity_kind == "UNIT"))
    ).scalar_one()
    assert row.guid == UNIT_GUID and row.name is None
    # The read model never resolves it and never prints the GUID.
    assert await resolved_unit_names(db_session, _PILOT, [str(UNIT_GUID)]) == {}


async def test_tick_resolves_a_due_unit_row_through_the_read_only_spy(db_session: AsyncSession) -> None:
    await upsert_reference_names(db_session, _PILOT, unit_snapshot(), now=datetime.now(UTC))
    await db_session.commit()
    spy = SpyEnterpriseLookupTransport(unit_responses=[UNIT_RESPONSE])  # type: ignore[arg-type]
    counters = await resolve_due_reference_names(db_session, spy, now=datetime.now(UTC))
    await db_session.commit()
    assert counters["resolved"] == 1
    assert [call["operation"] for call in spy.calls] == ["GetUnitByUuid"]  # zero writes, zero other reads
    row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.entity_kind == "UNIT"))
    ).scalar_one()
    assert row.name == "кг" and row.source == "VETIS_LOOKUP" and row.status == "RESOLVED"
    # The paired batch GUID stays intact — the read side matches parties by it.
    assert row.uuid == UNIT_GUID


async def test_tick_echo_guard_never_applies_a_foreign_uuid(db_session: AsyncSession) -> None:
    await upsert_reference_names(db_session, _PILOT, unit_snapshot(), now=datetime.now(UTC))
    await db_session.commit()
    foreign = UNIT_RESPONSE.replace(str(UNIT_UUID), str(uuid.UUID(int=42)))
    spy = SpyEnterpriseLookupTransport(unit_responses=[foreign])  # type: ignore[arg-type]
    counters = await resolve_due_reference_names(db_session, spy, now=datetime.now(UTC))
    await db_session.commit()
    assert counters["retried"] == 1 and counters["resolved"] == 0
    row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.entity_kind == "UNIT"))
    ).scalar_one()
    assert row.name is None and row.last_problem_code == "VETIS_REFERENCE_GUID_MISMATCH"


async def test_tick_transport_failure_keeps_the_row_pending(db_session: AsyncSession) -> None:
    await upsert_reference_names(db_session, _PILOT, unit_snapshot(), now=datetime.now(UTC))
    await db_session.commit()
    spy = SpyEnterpriseLookupTransport(failure=RuntimeError("no network in tests"))  # type: ignore[arg-type]
    counters = await resolve_due_reference_names(db_session, spy, now=datetime.now(UTC))
    await db_session.commit()
    assert counters["retried"] == 1
    row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.entity_kind == "UNIT"))
    ).scalar_one()
    assert row.name is None and row.failure_count == 1


# --- the read model of the conclusion -----------------------------------------------


async def test_resolved_unit_names_matches_both_identities(db_session: AsyncSession) -> None:
    await upsert_reference_names(db_session, _PILOT, unit_snapshot(), now=datetime.now(UTC))
    row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.entity_kind == "UNIT"))
    ).scalar_one()
    row.name = "кг"
    row.source = "VETIS_LOOKUP"
    row.status = "RESOLVED"
    await db_session.commit()

    cache = await resolved_unit_names(db_session, _PILOT, [str(UNIT_UUID), str(UNIT_GUID)])
    assert cache[str(UNIT_UUID)] == "кг"
    assert cache[str(UNIT_GUID)] == "кг"  # the приёмка key (accepted_unit_id) resolves too

    # Another contour never leaks: contours are never merged implicitly.
    assert await resolved_unit_names(db_session, "PRODUCTION", [str(UNIT_UUID)]) == {}

    # An ERROR row is never a source of a name.
    row.status = "ERROR"
    await db_session.commit()
    assert await resolved_unit_names(db_session, _PILOT, [str(UNIT_UUID)]) == {}


def test_extract_unit_shapes() -> None:
    assert extract_unit(unit_snapshot()) is not None
    ref = extract_unit(unit_snapshot())
    assert ref is not None and ref.kind == VetisEntityKind.UNIT and ref.guid == UNIT_UUID
    assert extract_unit({"vdDocument": {"batch": {}}}) is None
    assert extract_unit({}) is None
