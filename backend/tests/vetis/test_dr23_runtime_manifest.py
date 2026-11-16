"""ТЗ DR23 §7 backend tests: the runtime pinned manifest and the resolver tick.

The committed manifest stays ``PENDING``; the runtime overlay
(``VETIS_SCHEMA_PINS``) carries the verified ``PINNED`` state.  Every test
uses обезличенные fixtures and a recording spy of the EnterpriseService
boundary — live VetIS calls in tests are FORBIDDEN.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.manifest import ManifestPinError, load_runtime_manifest
from backend.src.modules.integrations.vetis.models import VetisReferenceName
from backend.src.modules.integrations.vetis.reference_names import (
    NAME_REFRESH_INTERVAL,
    resolve_due_reference_names,
    resolve_participants,
    upsert_reference_names,
)
from backend.src.modules.integrations.vetis.transport import WRITE_OPERATIONS, SpyEnterpriseLookupTransport

RECEIVER_BE = uuid.UUID("3e188573-0de9-42c1-ab14-1f3e8391cb3e")
RECEIVER_ENT = uuid.UUID("8fb3e002-0997-4ffc-a7bc-d8a5d80975e0")
PROD_BE = uuid.UUID("41b1a37e-1111-4222-8333-000000000001")
PILOT_ENT = uuid.UUID("41b1a37e-1111-4222-8333-000000000002")

_PILOT = "PILOT"
_PRODUCTION = "PRODUCTION"


def receivers_guid_only_snapshot() -> dict[str, object]:
    """Only the receiver participants arrive as GUIDs (the §1 symptom shape)."""
    return {
        "vdDocument": {
            "consignee": {
                "name": "",
                "businessEntity": {"guid": str(RECEIVER_BE), "uuid": str(RECEIVER_BE)},
                "enterprise": {"guid": str(RECEIVER_ENT), "uuid": str(RECEIVER_ENT)},
            },
        }
    }


def business_entity_response(
    guid: uuid.UUID, *, active: bool = True, last: bool = True, name: str | None = "ОАО «Восход»"
) -> str:
    """The GetBusinessEntityByGUID answer shape with controllable checks."""
    name_xml = f"<ent:fullName>{name}</ent:fullName>" if name else ""
    return (
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soapenv:Body><ws:getBusinessEntityByGuidResponse '
        'xmlns:ws="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2">'
        '<ent:businessEntity xmlns:ent="http://api.vetrf.ru/schema/cdm/dictionary/businessEntity/v2" '
        'xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
        f"<bs:uuid>{uuid.UUID(int=2)}</bs:uuid>"
        f"<bs:guid>{guid}</bs:guid>"
        f"<bs:active>{str(active).lower()}</bs:active><bs:last>{str(last).lower()}</bs:last>"
        f"<bs:status>100</bs:status>{name_xml}"
        "</ent:businessEntity></ws:getBusinessEntityByGuidResponse></soapenv:Body></soapenv:Envelope>"
    )


def enterprise_response(guid: uuid.UUID, *, active: bool = True, last: bool = True) -> str:
    """The GetEnterpriseByGuid v2 answer shape with controllable checks."""
    return (
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soapenv:Body><ws:getEnterpriseByGuidResponse '
        'xmlns:ws="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2">'
        '<dt:enterprise xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
        f"<bs:uuid>{uuid.UUID(int=1)}</bs:uuid>"
        f"<bs:guid>{guid}</bs:guid>"
        f"<bs:active>{str(active).lower()}</bs:active><bs:last>{str(last).lower()}</bs:last>"
        "<bs:status>100</bs:status>"
        "<dt:name>Лабораторный убойный пункт</dt:name>"
        "</dt:enterprise></ws:getEnterpriseByGuidResponse></soapenv:Body></soapenv:Envelope>"
    )


@pytest.fixture
def spy_enterprise():
    from backend.src.modules.integrations.vetis.transport import SpyEnterpriseLookupTransport

    def build(**kwargs: object) -> SpyEnterpriseLookupTransport:
        return SpyEnterpriseLookupTransport(**kwargs)  # type: ignore[arg-type]

    return build


def _write_pinned_resource(tmp_path, name: str) -> dict[str, str]:
    """One WSDL/XSD file with its real SHA-256 for the pins overlay."""
    path = tmp_path / name
    path.write_text(f"<schema>{name}</schema>", encoding="utf-8")
    return {"resource": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _set_pinned_env(
    monkeypatch, tmp_path, *, status: str = "PINNED", wsdl: dict | None = None, xsd: list | None = None
) -> None:
    pins: dict[str, object] = {"status": status}
    if wsdl is None and status == "PINNED":
        pins["wsdl"] = _write_pinned_resource(tmp_path, "service.wsdl")
    elif wsdl is not None:
        pins["wsdl"] = wsdl
    if xsd is None and status == "PINNED":
        pins["xsd"] = [_write_pinned_resource(tmp_path, "base.xsd")]
    elif xsd is not None:
        pins["xsd"] = xsd
    pins_file = tmp_path / "vetis-pins.json"
    pins_file.write_text(json.dumps(pins), encoding="utf-8")
    monkeypatch.setenv("VETIS_SCHEMA_PINS", str(pins_file))


async def _pending_rows(db: AsyncSession, snapshot: object, contour: str = _PILOT) -> None:
    await upsert_reference_names(db, contour, snapshot)
    await db.commit()


async def _row(db: AsyncSession, guid: uuid.UUID, kind: str, contour: str = _PILOT) -> VetisReferenceName:
    return (
        await db.execute(
            select(VetisReferenceName).where(
                VetisReferenceName.contour == contour,
                VetisReferenceName.entity_kind == kind,
                VetisReferenceName.guid == guid,
            )
        )
    ).scalar_one()


# --- §5.1: the single runtime manifest loader ------------------------------------


async def test_1_runtime_pinned_overrides_committed_pending(tmp_path, monkeypatch) -> None:
    """The runtime PINNED overlay works over the committed PENDING manifest."""
    _set_pinned_env(monkeypatch, tmp_path)
    manifest = load_runtime_manifest()
    assert manifest.schema_pins.status == "PINNED"
    assert manifest.schema_pins.wsdl is not None and manifest.schema_pins.xsd
    # The committed manifest on disk is never modified by the overlay.
    from backend.src.modules.integrations.vetis.manifest import manifest_path

    committed = json.loads(manifest_path().read_text(encoding="utf-8"))
    assert committed["schema_pins"]["status"] == "PENDING"


def test_2a_missing_pins_file_is_not_configured(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VETIS_SCHEMA_PINS", str(tmp_path / "absent-vetis-pins.json"))
    with pytest.raises(ProblemError) as raised:
        load_runtime_manifest()
    assert raised.value.code == "INTEGRATION_NOT_CONFIGURED"
    assert raised.value.status == 503


def test_2b_pending_pins_file_is_not_configured(tmp_path, monkeypatch) -> None:
    _set_pinned_env(monkeypatch, tmp_path, status="PENDING")
    with pytest.raises(ProblemError) as raised:
        load_runtime_manifest()
    assert raised.value.code == "INTEGRATION_NOT_CONFIGURED"


def test_2c_checksum_mismatch_is_a_pin_mismatch(tmp_path, monkeypatch) -> None:
    wsdl = _write_pinned_resource(tmp_path, "service.wsdl")
    wsdl["sha256"] = "0" * 64
    _set_pinned_env(monkeypatch, tmp_path, wsdl=wsdl)
    with pytest.raises(ManifestPinError) as raised:
        load_runtime_manifest()
    assert raised.value.code == "INTEGRATION_SCHEMA_PIN_MISMATCH"


def test_2d_absent_pinned_resource_is_not_configured(tmp_path, monkeypatch) -> None:
    wsdl = {"resource": str(tmp_path / "absent.wsdl"), "sha256": "0" * 64}
    _set_pinned_env(monkeypatch, tmp_path, wsdl=wsdl)
    with pytest.raises(ProblemError) as raised:
        load_runtime_manifest()
    assert raised.value.code == "INTEGRATION_NOT_CONFIGURED"


# --- §5.2: the resolver tick with the runtime manifest ----------------------------


async def test_3_tick_uses_runtime_pinned_manifest_and_resolver_transport(
    db_session: AsyncSession, test_db_engine, tmp_path, monkeypatch
) -> None:
    """reference_names_tick no longer answers NOT_CONFIGURED under runtime pins."""
    from backend.src.modules.integrations.vetis import reference_names, worker

    _set_pinned_env(monkeypatch, tmp_path)
    spy = SpyEnterpriseLookupTransport()
    seen: dict[str, object] = {}

    async def fake_resolve(db, transport, **kwargs):  # noqa: ANN001
        seen["transport"] = transport
        seen["kwargs"] = kwargs
        return {"claimed": 0, "resolved": 0, "retried": 0}

    session_factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(reference_names, "compose_reference_transport", lambda _manifest: spy)
    monkeypatch.setattr(reference_names, "resolve_due_reference_names", fake_resolve)
    monkeypatch.setattr(worker, "get_session_factory", lambda: session_factory)
    result = await worker.reference_names_tick()
    assert result["result"] == "SUCCESS"
    assert result.get("problem") is None
    assert seen["transport"] is spy
    assert seen["kwargs"].get("contour") == "PILOT"
    # No write operation is ever reachable from the tick composition.
    assert all(str(call["operation"]) not in WRITE_OPERATIONS for call in spy.calls)


async def test_4_pending_business_entity_only_get_business_entity_by_guid(
    db_session: AsyncSession, spy_enterprise
) -> None:
    await _pending_rows(
        db_session,
        {
            "vdDocument": {
                "consignee": {"name": "", "businessEntity": {"guid": str(RECEIVER_BE)}},
            }
        },
    )
    spy = spy_enterprise(business_entity_responses=[business_entity_response(RECEIVER_BE)])
    counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert counters["resolved"] == 1
    assert [call["operation"] for call in spy.calls] == ["GetBusinessEntityByGUID"]


async def test_5_pending_enterprise_only_get_enterprise_by_guid(
    db_session: AsyncSession, spy_enterprise
) -> None:
    await _pending_rows(
        db_session,
        {
            "vdDocument": {
                "consignee": {"name": "", "enterprise": {"guid": str(RECEIVER_ENT)}},
            }
        },
    )
    spy = spy_enterprise(enterprise_responses=[enterprise_response(RECEIVER_ENT)])
    counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert counters["resolved"] == 1
    assert [call["operation"] for call in spy.calls] == ["GetEnterpriseByGuid"]


async def test_6_success_resolves_receiver_rows_and_the_read_model(
    db_session: AsyncSession, spy_enterprise
) -> None:
    await _pending_rows(db_session, receivers_guid_only_snapshot())
    spy = spy_enterprise(
        enterprise_responses=[enterprise_response(RECEIVER_ENT)],
        business_entity_responses=[business_entity_response(RECEIVER_BE)],
    )
    counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert counters == {"claimed": 2, "resolved": 2, "retried": 0}
    be = await _row(db_session, RECEIVER_BE, "BUSINESS_ENTITY")
    ent = await _row(db_session, RECEIVER_ENT, "ENTERPRISE")
    for row, name in ((be, "ОАО «Восход»"), (ent, "Лабораторный убойный пункт")):
        assert row.name == name
        assert row.source == "VETIS_LOOKUP"
        assert row.status == "RESOLVED"
        assert row.last_checked_at is not None
        assert row.next_check_at is not None and row.next_check_at > datetime.now(UTC)
        assert row.next_check_at - datetime.now(UTC) <= NAME_REFRESH_INTERVAL + timedelta(minutes=1)
        assert row.failure_count == 0
        assert row.last_problem_code is None
    from backend.src.modules.integrations.vetis.reference_names import participant_name_overrides

    overrides = participant_name_overrides(
        await resolve_participants(db_session, _PILOT, receivers_guid_only_snapshot())
    )
    assert overrides["receiverOwner"] == "ОАО «Восход»"
    assert overrides["receiverOwnerNameSource"] == "VETIS_LOOKUP"
    assert overrides["receiverEnterprise"] == "Лабораторный убойный пункт"
    assert overrides["receiverEnterpriseNameSource"] == "VETIS_LOOKUP"


async def test_7_failures_keep_the_prior_name_and_schedule_backoff(
    db_session: AsyncSession, spy_enterprise
) -> None:
    """Timeout, a wrong GUID echo and inactive/not-last/absent-name answers."""
    seeded = {
        "vdDocument": {
            "consignee": {
                "name": "",
                "businessEntity": {"guid": str(RECEIVER_BE), "name": "Старое название"},
                "enterprise": {"guid": str(RECEIVER_ENT)},
            },
        }
    }
    await _pending_rows(db_session, seeded)
    be = await _row(db_session, RECEIVER_BE, "BUSINESS_ENTITY")
    assert be.name == "Старое название"
    ent = await _row(db_session, RECEIVER_ENT, "ENTERPRISE")
    # Both rows are due right now (the named row's 24 h refresh is backdated).
    for row in (be, ent):
        row.next_check_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()

    # 1) transport timeout/5xx: prior name kept, honest retry backoff.
    spy = spy_enterprise(failure=RuntimeError("connection timeout"))
    counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert counters["retried"] == 2
    be = await _row(db_session, RECEIVER_BE, "BUSINESS_ENTITY")
    assert be.name == "Старое название" and be.status == "ERROR"
    assert be.failure_count == 1 and be.last_checked_at is not None
    ent = await _row(db_session, RECEIVER_ENT, "ENTERPRISE")
    assert ent.name is None and ent.status == "PENDING"

    # 2) a wrong GUID echo is never applied.
    spy = spy_enterprise(business_entity_responses=[business_entity_response(uuid.UUID(int=99))])
    # Make both rows due again.
    for row in (be, ent):
        row.next_check_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()
    counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert counters["resolved"] == 0 and counters["retried"] == 2
    be = await _row(db_session, RECEIVER_BE, "BUSINESS_ENTITY")
    assert be.name == "Старое название"
    assert be.last_problem_code == "VETIS_REFERENCE_GUID_MISMATCH"

    # 3) inactive/not-last/absent-name answers never replace a good name.
    spy = spy_enterprise(
        business_entity_responses=[
            business_entity_response(RECEIVER_BE, active=False),
            business_entity_response(RECEIVER_BE, last=False),
            business_entity_response(RECEIVER_BE, name=None),
        ]
    )
    for _ in range(3):
        be = await _row(db_session, RECEIVER_BE, "BUSINESS_ENTITY")
        be.next_check_at = datetime.now(UTC) - timedelta(minutes=1)
        await db_session.commit()
        counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
        await db_session.commit()
        be = await _row(db_session, RECEIVER_BE, "BUSINESS_ENTITY")
        assert be.name == "Старое название"
        assert be.status in ("ERROR", "PENDING") and be.failure_count >= 1
    assert be.last_problem_code in (
        "VETIS_REFERENCE_INACTIVE",
        "VETIS_REFERENCE_NOT_LAST",
        "VETIS_REFERENCE_NAME_ABSENT",
    )


async def test_8_pilot_never_touches_production_rows(db_session: AsyncSession, spy_enterprise) -> None:
    await _pending_rows(
        db_session,
        {"vdDocument": {"consignee": {"name": "", "businessEntity": {"guid": str(PROD_BE)}}}},
        contour=_PRODUCTION,
    )
    await _pending_rows(
        db_session,
        {"vdDocument": {"consignee": {"name": "", "enterprise": {"guid": str(PILOT_ENT)}}}},
        contour=_PILOT,
    )
    spy = spy_enterprise(enterprise_responses=[enterprise_response(PILOT_ENT)])
    counters = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert counters["claimed"] == 1
    assert [call["guid"] for call in spy.calls] == [str(PILOT_ENT)]
    production = await _row(db_session, PROD_BE, "BUSINESS_ENTITY", contour=_PRODUCTION)
    assert production.name is None
    assert production.status == "PENDING"
    assert production.last_checked_at is None
    assert production.last_problem_code is None


async def test_9_repeated_tick_is_idempotent(db_session: AsyncSession, spy_enterprise) -> None:
    await _pending_rows(db_session, receivers_guid_only_snapshot())
    spy = spy_enterprise(
        enterprise_responses=[enterprise_response(RECEIVER_ENT)],
        business_entity_responses=[business_entity_response(RECEIVER_BE)],
    )
    first = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    assert first["resolved"] == 2
    calls_after_first = len(spy.calls)
    second = await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    # The refreshed rows are not due for another 24 h: no new calls, no dupes.
    assert second == {"claimed": 0, "resolved": 0, "retried": 0}
    assert len(spy.calls) == calls_after_first
    rows = (await db_session.execute(select(VetisReferenceName))).scalars().all()
    assert len(rows) == 2


async def test_10_no_write_operation_is_ever_reachable(db_session: AsyncSession, spy_enterprise) -> None:
    await _pending_rows(db_session, receivers_guid_only_snapshot())
    spy = spy_enterprise(
        enterprise_responses=[enterprise_response(RECEIVER_ENT)],
        business_entity_responses=[business_entity_response(RECEIVER_BE)],
    )
    await resolve_due_reference_names(db_session, spy, contour=_PILOT)
    await db_session.commit()
    operations = {str(call["operation"]) for call in spy.calls}
    assert operations == {"GetEnterpriseByGuid", "GetBusinessEntityByGUID"}
    assert operations & WRITE_OPERATIONS == set()


async def test_11_not_configured_result_is_visible_and_safe(
    db_session: AsyncSession, test_db_engine, monkeypatch, caplog
) -> None:
    """The unconfigured tick is an honest diagnostic, never an empty success."""
    import logging as _logging

    from backend.src.modules.integrations.vetis import worker

    monkeypatch.delenv("VETIS_SCHEMA_PINS", raising=False)
    monkeypatch.setattr(
        worker,
        "get_session_factory",
        lambda: async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )
    with caplog.at_level(_logging.INFO, logger="vetis.worker"):
        result = await worker.reference_names_tick()
    assert result["result"] == "NOT_CONFIGURED"
    assert result["problem"] == "INTEGRATION_NOT_CONFIGURED"
    assert result["claimed"] == 0 and result["resolved"] == 0 and result["retried"] == 0
    records = [r for r in caplog.records if r.getMessage() == "reference_names_tick"]
    assert records, "the tick diagnostic must be logged"
    record = records[-1]
    assert record.result == "NOT_CONFIGURED"  # type: ignore[attr-defined]
    assert record.problem_code == "INTEGRATION_NOT_CONFIGURED"  # type: ignore[attr-defined]
    assert record.claimed == 0 and record.resolved == 0  # type: ignore[attr-defined]
    # No secrets ever reach the diagnostics.
    text = caplog.text.lower()
    for forbidden in ("apikey", "issuerid", "password", "login", "soapenv"):
        assert forbidden not in text
