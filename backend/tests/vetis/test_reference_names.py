"""ТЗ DR18 §11 backend tests: the contour-scoped participant-name cache.

The ten named contract tests of spec §11 live in this module plus the
arrivals API module (``backend/tests/arrivals/test_dr18_participant_names.py``).
The VetIS side is proven on обезличенные pinned fixtures with a recording spy
of the EnterpriseService boundary — live VetIS calls in tests are FORBIDDEN
(the live read-only check belongs to the controller after deploy).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.models import IncomingDocument, Party, Reconciliation
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.integrations.vetis.models import VetisSourceDocument
from backend.src.modules.integrations.vetis.reference_names import (
    NAME_REFRESH_INTERVAL,
    backfill_reference_names,
    extract_participants,
    resolve_due_reference_names,
    upsert_reference_names,
)
from backend.src.modules.integrations.vetis.transport import (
    WRITE_OPERATIONS,
    WriteOperationRejected,
    build_get_business_entity_by_guid_request,
    build_get_enterprise_by_guid_request,
    is_read_only_operation,
    parse_business_entity_by_guid,
    parse_enterprise_by_guid,
)


@pytest.fixture
async def name_lab(db_session: AsyncSession) -> Laboratory:
    """A minimal laboratory for the FK-backed enrichment tests."""
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(
        territory_id=territory.id, name="Лаборатория названий", address="ул. Тестовая, 3", organization="ГБУ"
    )
    user = User(
        login="namevet",
        full_name="Ветеринарный врач",
        email="names@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(laboratory)
    db_session.add(user)
    await db_session.commit()
    return SimpleNamespace(laboratory=laboratory, vet_id=user.id)


SENDER_BE = uuid.UUID("0ed40ab2-cda6-4daa-9302-1e21187be0e1")
SENDER_ENT = uuid.UUID("d562919c-05d8-442f-840d-4c37d41dcae1")
RECEIVER_BE = uuid.UUID("3e188573-0de9-42c1-ab14-1f3e8391cb3e")
RECEIVER_ENT = uuid.UUID("8fb3e002-0997-4ffc-a7bc-d8a5d80975e0")

_PILOT = "PILOT"
_PRODUCTION = "PRODUCTION"


# --- fixtures --------------------------------------------------------------------


def guid_only_snapshot() -> dict[str, object]:
    """The spec §1 shape: participants arrive ONLY as GUIDs."""
    return {
        "vdDocument": {
            "consignor": {
                "name": "",
                "businessEntity": {"guid": str(SENDER_BE), "uuid": str(SENDER_BE)},
                "enterprise": {"guid": str(SENDER_ENT), "uuid": str(SENDER_ENT)},
            },
            "consignee": {
                "name": "",
                "businessEntity": {"guid": str(RECEIVER_BE), "uuid": str(RECEIVER_BE)},
                "enterprise": {"guid": str(RECEIVER_ENT), "uuid": str(RECEIVER_ENT)},
            },
        }
    }


def named_xml_snapshot() -> dict[str, object]:
    """The same document WITH source names present in the XML."""
    return {
        "vdDocument": {
            "consignor": {
                "name": "Предприятие «Мясопром»",
                "businessEntity": {"guid": str(SENDER_BE), "name": "ООО «Мясопром»"},
                "enterprise": {"guid": str(SENDER_ENT), "name": "Предприятие «Мясопром»"},
            },
            "consignee": {
                "name": "Лабораторный убойный пункт",
                "businessEntity": {"guid": str(RECEIVER_BE), "name": "ОАО «Восход»"},
                "enterprise": {"guid": str(RECEIVER_ENT), "name": "Лабораторный убойный пункт"},
            },
        }
    }


@pytest.fixture
def spy_enterprise():
    from backend.src.modules.integrations.vetis.transport import SpyEnterpriseLookupTransport

    def build(**kwargs: object) -> SpyEnterpriseLookupTransport:
        return SpyEnterpriseLookupTransport(**kwargs)  # type: ignore[arg-type]

    return build


ENTERPRISE_RESPONSE = (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
    '<soapenv:Body><ws:getEnterpriseByGuidResponse '
    'xmlns:ws="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2">'
    '<dt:enterprise xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
    f"<bs:uuid>{uuid.UUID(int=1)}</bs:uuid>"
    f"<bs:guid>{SENDER_ENT}</bs:guid>"
    "<bs:active>true</bs:active><bs:last>true</bs:last><bs:status>100</bs:status>"
    "<bs:createDate>2026-01-01T00:00:00</bs:createDate>"
    "<bs:updateDate>2026-06-01T00:00:00</bs:updateDate>"
    "<dt:name>Предприятие «Мясопром»</dt:name>"
    "</dt:enterprise></ws:getEnterpriseByGuidResponse></soapenv:Body></soapenv:Envelope>"
)

BUSINESS_ENTITY_RESPONSE = (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
    '<soapenv:Body><ws:getBusinessEntityByGuidResponse '
    'xmlns:ws="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2">'
    '<ent:businessEntity xmlns:ent="http://api.vetrf.ru/schema/cdm/dictionary/businessEntity/v2" xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
    f"<bs:uuid>{uuid.UUID(int=2)}</bs:uuid>"
    f"<bs:guid>{SENDER_BE}</bs:guid>"
    "<bs:active>true</bs:active><bs:last>true</bs:last><bs:status>100</bs:status>"
    "<bs:createDate>2026-01-01T00:00:00</bs:createDate>"
    "<bs:updateDate>2026-06-01T00:00:00</bs:updateDate>"
    "<ent:fullName>ОАО «Мясопром»</ent:fullName>"
    "</ent:businessEntity></ws:getBusinessEntityByGuidResponse></soapenv:Body></soapenv:Envelope>"
)


# --- §11 tests -------------------------------------------------------------------


async def test_1_xml_names_saved_on_the_right_level(db_session: AsyncSession) -> None:
    counters = await upsert_reference_names(db_session, _PILOT, named_xml_snapshot())
    await db_session.commit()
    assert counters["created"] == 4
    from backend.src.modules.integrations.vetis.models import VetisEntityKind, VetisReferenceName

    rows = {
        (row.entity_kind, row.guid): row
        for row in (await db_session.execute(select(VetisReferenceName))).scalars()
    }
    sender_be = rows[(VetisEntityKind.BUSINESS_ENTITY.value, SENDER_BE)]
    sender_ent = rows[(VetisEntityKind.ENTERPRISE.value, SENDER_ENT)]
    assert sender_be.name == "ООО «Мясопром»"
    assert sender_ent.name == "Предприятие «Мясопром»"
    assert sender_be.source == "SOURCE_XML" and sender_ent.source == "SOURCE_XML"
    assert sender_be.status == "RESOLVED" and sender_ent.status == "RESOLVED"


async def test_2_guid_only_creates_two_pending_kinds(db_session: AsyncSession) -> None:
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    counters = await upsert_reference_names(db_session, _PILOT, guid_only_snapshot())
    await db_session.commit()
    # Four objects: sender BE/ENT + receiver BE/ENT (each on its own level).
    assert counters["created"] == 4 and counters["seen"] == 4
    rows = (await db_session.execute(select(VetisReferenceName))).scalars().all()
    assert len(rows) == 4
    for row in rows:
        assert row.name is None
        assert row.status == "PENDING"
        assert row.next_check_at is not None  # due immediately, never blocks import
        assert row.source is None  # no name was ever observed
    kinds = {row.entity_kind for row in rows}
    assert kinds == {"BUSINESS_ENTITY", "ENTERPRISE"}


async def test_3_one_guid_two_documents_one_job(db_session: AsyncSession) -> None:
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    first = await upsert_reference_names(db_session, _PILOT, guid_only_snapshot())
    await db_session.commit()
    second = await upsert_reference_names(db_session, _PILOT, guid_only_snapshot())
    await db_session.commit()
    rows = (await db_session.execute(select(VetisReferenceName))).scalars().all()
    assert len(rows) == 4  # the re-sync created NO new cache rows
    assert first["created"] == 4 and second["created"] == 0
    due = [row for row in rows if row.next_check_at is not None]
    assert len(due) == 4  # and no duplicate queue entries for one key


async def test_4_kind_and_contour_never_merged(db_session: AsyncSession) -> None:
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    # The SAME guid value as both a businessEntity and an enterprise.
    mixed = {
        "vdDocument": {
            "consignor": {
                "name": "",
                "businessEntity": {"guid": str(SENDER_BE)},
                "enterprise": {"guid": str(SENDER_BE)},
            },
            "consignee": {"name": "", "businessEntity": None, "enterprise": None},
        }
    }
    await upsert_reference_names(db_session, _PILOT, mixed)
    await upsert_reference_names(db_session, _PRODUCTION, mixed)
    await db_session.commit()
    rows = (await db_session.execute(select(VetisReferenceName))).scalars().all()
    assert len(rows) == 4  # 2 kinds × 2 contours; nothing merged
    assert len({(row.contour, row.entity_kind, row.guid) for row in rows}) == 4


async def test_5_enterprise_lookup_success(db_session: AsyncSession, spy_enterprise) -> None:
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    await upsert_reference_names(db_session, _PILOT, guid_only_snapshot())
    await db_session.commit()
    spy = spy_enterprise(enterprise_responses=[ENTERPRISE_RESPONSE, ENTERPRISE_RESPONSE])
    counters = await resolve_due_reference_names(db_session, spy)
    await db_session.commit()
    assert counters["resolved"] >= 1
    row = (
        await db_session.execute(
            select(VetisReferenceName).where(VetisReferenceName.guid == SENDER_ENT)
        )
    ).scalar_one()
    assert row.name == "Предприятие «Мясопром»"
    assert row.source == "VETIS_LOOKUP" and row.status == "RESOLVED"
    assert row.last_checked_at is not None
    assert row.next_check_at is not None
    assert row.next_check_at - row.last_checked_at <= NAME_REFRESH_INTERVAL + timedelta(seconds=5)
    assert row.uuid is not None  # the response uuid is stored as the version
    assert row.failure_count == 0 and row.last_problem_code is None


async def test_6_business_entity_name_fullname_fio(db_session: AsyncSession, spy_enterprise) -> None:
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    await upsert_reference_names(db_session, _PILOT, guid_only_snapshot())
    await db_session.commit()
    spy = spy_enterprise(business_entity_responses=[BUSINESS_ENTITY_RESPONSE, BUSINESS_ENTITY_RESPONSE])
    counters = await resolve_due_reference_names(db_session, spy)
    await db_session.commit()
    assert counters["resolved"] >= 1
    row = (
        await db_session.execute(
            select(VetisReferenceName).where(VetisReferenceName.guid == SENDER_BE)
        )
    ).scalar_one()
    # ent:name is absent → ent:fullName is used (then ent:fio).
    assert row.name == "ОАО «Мясопром»"
    assert row.source == "VETIS_LOOKUP" and row.status == "RESOLVED"


async def test_7_error_keeps_name_and_retries(db_session: AsyncSession, spy_enterprise) -> None:
    from backend.src.modules.integrations.vetis.models import VetisReferenceName

    # A good cached name first.
    await upsert_reference_names(db_session, _PILOT, named_xml_snapshot())
    await db_session.commit()
    # Make the enterprise refresh due now (a named row is refreshed at most
    # once per 24 h — the tick only picks genuinely due entries).

    named_row = (
        await db_session.execute(
            select(VetisReferenceName).where(VetisReferenceName.guid == SENDER_ENT)
        )
    ).scalar_one()
    named_row.next_check_at = datetime.now(UTC)
    await db_session.commit()
    # The enterprise refresh fails (transport error) — the name stays.
    spy = spy_enterprise(failure=RuntimeError("VETIS_ENTERPRISE_UNAVAILABLE"))
    counters = await resolve_due_reference_names(db_session, spy)
    await db_session.commit()
    assert counters["retried"] >= 1
    row = (
        await db_session.execute(
            select(VetisReferenceName).where(VetisReferenceName.guid == SENDER_ENT)
        )
    ).scalar_one()
    assert row.name == "Предприятие «Мясопром»"  # the previous good name survives
    assert row.status == "ERROR"
    assert row.failure_count == 1
    assert row.last_problem_code == "RuntimeError"
    assert row.next_check_at is not None and row.next_check_at > datetime.now(UTC)

    # A not-active/not-last answer never replaces a good name either.
    due_row = (
        await db_session.execute(select(VetisReferenceName).where(VetisReferenceName.guid == SENDER_ENT))
    ).scalar_one()
    due_row.next_check_at = datetime.now(UTC)  # the backoff retry became due
    await db_session.commit()
    stale = (
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soapenv:Body><ws:getEnterpriseByGuidResponse '
        'xmlns:ws="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2">'
        '<dt:enterprise xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
        f"<bs:guid>{SENDER_ENT}</bs:guid>"
        "<bs:active>false</bs:active><bs:last>false</bs:last>"
        "<dt:name>Устаревшая запись</dt:name>"
        "</dt:enterprise></ws:getEnterpriseByGuidResponse></soapenv:Body></soapenv:Envelope>"
    )
    spy = spy_enterprise(enterprise_responses=[stale])
    await resolve_due_reference_names(db_session, spy)
    await db_session.commit()
    await db_session.refresh(row)
    assert row.name == "Предприятие «Мясопром»"
    assert row.last_problem_code == "VETIS_REFERENCE_NOT_LAST"


async def test_8_backfill_idempotent(db_session: AsyncSession) -> None:
    documents = [
        (_PILOT, guid_only_snapshot()),
        (_PILOT, named_xml_snapshot()),
        (_PRODUCTION, guid_only_snapshot()),
    ]
    first = await backfill_reference_names(db_session, documents)
    await db_session.commit()
    second = await backfill_reference_names(db_session, documents)
    await db_session.commit()
    assert first["created"] == 8  # 4 PENDING + 4 named (separate contours)
    assert second["created"] == 0  # a repeated backfill creates nothing new
    assert second["seen"] == first["seen"]


async def test_9_enrichment_never_touches_source_or_facts(
    db_session: AsyncSession, spy_enterprise, name_lab
) -> None:
    evsd = uuid.uuid4()
    lab_id = name_lab.laboratory.id
    raw = "<vd:vetDocument>исходный XML</vd:vetDocument>"
    checksum = "a" * 64
    row = IncomingDocument(
        contour=_PILOT,
        evsd_uuid=evsd,
        laboratory_id=lab_id,
        external_status="COMPLETED",
        source_snapshot=named_xml_snapshot(),
        content_hash="b" * 64,
        fetched_at=datetime.now(UTC),
    )
    db_session.add(row)
    await db_session.flush()
    party_row = Party(id=uuid.uuid4(), incoming_document_id=row.id, laboratory_id=lab_id, classification_snapshot={})
    db_session.add(party_row)
    db_session.add(
        VetisSourceDocument(contour=_PILOT, evsd_uuid=evsd, laboratory_id=lab_id, raw_xml=raw, checksum=checksum)
    )
    db_session.add(
        Reconciliation(
            party_id=party_row.id,
            checks={"CHK-F05": {"matches": True}},
            services=[],
            actor_id=name_lab.vet_id,
            state="OPEN",
        )
    )
    await db_session.commit()
    document_before = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    source_before = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == evsd))
    ).scalar_one()

    counters = await backfill_reference_names(db_session, [(_PILOT, named_xml_snapshot())])
    spy = spy_enterprise(enterprise_responses=[ENTERPRISE_RESPONSE])
    await resolve_due_reference_names(db_session, spy)
    await db_session.commit()

    document_after = (
        await db_session.execute(select(IncomingDocument).where(IncomingDocument.evsd_uuid == evsd))
    ).scalar_one()
    source_after = (
        await db_session.execute(select(VetisSourceDocument).where(VetisSourceDocument.evsd_uuid == evsd))
    ).scalar_one()
    assert counters["created"] >= 0
    assert source_after.raw_xml == source_before.raw_xml == raw
    assert source_after.checksum == checksum and source_after.revision == source_before.revision
    assert document_after.source_snapshot == document_before.source_snapshot
    assert document_after.content_hash == "b" * 64
    reconciliations = (await db_session.execute(select(Reconciliation))).scalars().all()
    assert len(reconciliations) == 1
    assert reconciliations[0].checks == {"CHK-F05": {"matches": True}}


async def test_10_worker_never_calls_write_methods(db_session: AsyncSession, spy_enterprise) -> None:
    await upsert_reference_names(db_session, _PILOT, guid_only_snapshot())
    await db_session.commit()
    spy = spy_enterprise(
        enterprise_responses=[ENTERPRISE_RESPONSE],
        business_entity_responses=[BUSINESS_ENTITY_RESPONSE],
    )
    await resolve_due_reference_names(db_session, spy)
    await db_session.commit()
    operations = {str(call["operation"]) for call in spy.calls}
    assert operations <= {"GetEnterpriseByGuid", "GetBusinessEntityByGUID"}
    for operation in operations:
        assert is_read_only_operation(operation)
    for write in WRITE_OPERATIONS:
        assert not is_read_only_operation(write)
        with pytest.raises(WriteOperationRejected):
            if write == "ProcessIncomingConsignment":
                raise WriteOperationRejected(write)


def test_manifest_pinned_request_builders() -> None:
    """The lookup requests use the pinned registry namespace, never a guess."""
    request = build_get_enterprise_by_guid_request(str(SENDER_ENT))
    assert "getEnterpriseByGuidRequest" in request
    assert "http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2" in request
    assert str(SENDER_ENT) in request
    entity_request = build_get_business_entity_by_guid_request(str(SENDER_BE))
    assert "getBusinessEntityByGuidRequest" in entity_request
    parsed = parse_enterprise_by_guid(ENTERPRISE_RESPONSE)
    assert parsed["name"] == "Предприятие «Мясопром»"
    assert parsed["active"] is True and parsed["last"] is True
    parsed_entity = parse_business_entity_by_guid(BUSINESS_ENTITY_RESPONSE)
    assert parsed_entity["name"] == "ОАО «Мясопром»"


def test_extract_participants_keeps_levels() -> None:
    participants = extract_participants(named_xml_snapshot())
    sender = participants["sender"]
    assert sender["BUSINESS_ENTITY"].name == "ООО «Мясопром»"
    assert sender["ENTERPRISE"].name == "Предприятие «Мясопром»"
    assert sender["BUSINESS_ENTITY"].guid != sender["ENTERPRISE"].guid
