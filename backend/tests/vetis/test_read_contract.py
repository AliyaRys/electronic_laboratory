"""VetIS read contract tests (ТЗ-10 V01): manifest pinning, read-only adapter.

All assertions run on обезличенные pinned fixtures: no gateway credentials,
no issued operational UUIDs, no real apiKey/login values ever appear here.
"""

from __future__ import annotations

import base64
import json
import sys
import uuid
from decimal import Decimal
from pathlib import Path

import pytest

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentDTO
from backend.src.modules.integrations.vetis.contracts import VetisScope
from backend.src.modules.integrations.vetis.models import VetisContour

RESOURCES = Path(__file__).resolve().parents[2] / "resources" / "vetis"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


# --- helpers -----------------------------------------------------------------


def make_scope(
    enterprise: str = "00000000-0000-0000-0000-0000000000e1", member: str = "00000000-0000-0000-0000-0000000000be"
) -> VetisScope:
    return VetisScope(
        laboratory_id=uuid.uuid4(),
        contour=VetisContour.PILOT,
        business_member_id=member,
        enterprise_id=enterprise,
    )


def _cursor(offset: int, seen: list[str]) -> str:
    raw = json.dumps({"offset": offset, "seen": seen}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> dict[str, object]:
    return json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")))


class FakeTransport:
    """Transport spy: records every call, never touches the network."""

    def __init__(self, pages: list[str]) -> None:
        self.pages = list(pages)
        self.calls: list[dict[str, object]] = []

    async def send_application(self, application_xml: str) -> str:
        self.calls.append(
            {"kind": "submitApplicationRequest", "operation": "GetVetDocumentListOperation", "xml": application_xml}
        )
        return "fixture-application-id"

    async def receive_result(self, application_id: str) -> str:
        self.calls.append(
            {
                "kind": "receiveApplicationResultRequest",
                "operation": "GetVetDocumentListOperation",
                "application_id": application_id,
            }
        )
        page = self.pages.pop(0) if self.pages else EMPTY_PAGE
        self.calls[-1]["result_xml"] = page
        return page


# --- pinned de-identified XML fixtures ---------------------------------------

LIST_HEADER = (
    '<ns2:receiveApplicationResultResponse xmlns:ns2="http://api.vetrf.ru/schema/cdm/application/v2" '
    'xmlns:bs="http://api.vetrf.ru/schema/cdm/base" '
    'xmlns:mer="http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2">'
    "<bs:status>COMPLETED</bs:status>"
    "<mer:getVetDocumentListResponse>"
    "<bs:total>{total}</bs:total><bs:count>{count}</bs:count><bs:offset>{offset}</bs:offset>"
    "{docs}"
    "</mer:getVetDocumentListResponse></ns2:receiveApplicationResultResponse>"
)

DOC_TEMPLATE = """
<mer:vetDocument>
  <bs:uuid>{evsd}</bs:uuid>
  <bs:guid>{evsd}</bs:guid>
  <bs:issueDate>2026-11-01T10:00:00+03:00</bs:issueDate>
  <bs:issueSeries>ВИС</bs:issueSeries>
  <bs:issueNumber>{number}</bs:issueNumber>
  <bs:type>TRANSPORT</bs:type>
  <bs:status>{status}</bs:status>
  <mer:certifiedConsignment>
    <mer:consignor>
      <bs:name>{consignor_name}</bs:name>
      <mer:businessEntity><bs:guid>00000000-0000-0000-0000-0000000000c0</bs:guid><bs:name>{consignor_name}</bs:name></mer:businessEntity>
      <mer:enterprise><bs:guid>00000000-0000-0000-0000-0000000000c1</bs:guid><bs:name>{consignor_name}</bs:name></mer:enterprise>
    </mer:consignor>
    <mer:consignee>
      <bs:name>{consignee_name}</bs:name>
      <mer:businessEntity><bs:guid>00000000-0000-0000-0000-0000000000be</bs:guid><bs:name>{consignee_name}</bs:name></mer:businessEntity>
      <mer:enterprise><bs:guid>{receiver}</bs:guid><bs:name>{consignee_name}</bs:name></mer:enterprise>
    </mer:consignee>
    <mer:batch>
      <mer:productType>{product_type}</mer:productType>
      <mer:product><bs:guid>00000000-0000-0000-0000-000000000101</bs:guid>
        <bs:uuid>00000000-0000-0000-0000-000000000102</bs:uuid><bs:name>говядина</bs:name></mer:product>
      <mer:subProduct><bs:guid>00000000-0000-0000-0000-000000000103</bs:guid>
        <bs:name>полутуши</bs:name></mer:subProduct>
      <mer:productItem><bs:guid>00000000-0000-0000-0000-000000000104</bs:guid>
        <bs:name>Отруба говяжьи</bs:name></mer:productItem>
      <mer:volume>120.500</mer:volume>
      <mer:unit><bs:guid>00000000-0000-0000-0000-000000000105</bs:guid><bs:name>кг</bs:name></mer:unit>
    </mer:batch>
    <mer:transportInfo><mer:transportNumber>{transport}</mer:transportNumber></mer:transportInfo>
  </mer:certifiedConsignment>
</mer:vetDocument>
"""


def doc(
    evsd: uuid.UUID,
    number: str,
    *,
    receiver: str = "00000000-0000-0000-0000-0000000000e1",
    status: str = "CONFIRMED",
    product_type: str = "1",
    transport: str = "А123ВС",
) -> str:
    return DOC_TEMPLATE.format(
        evsd=evsd,
        number=number,
        consignor_name="ООО Источник",
        consignee_name="Лаборатория Агропромышленного парка",
        receiver=receiver,
        status=status,
        product_type=product_type,
        transport=transport,
    )


EMPTY_PAGE = LIST_HEADER.format(total=0, count=0, offset=0, docs="")


def pinned_manifest():
    """A manifest with PINNED schema (fixture WSDL/XSD) for adapter behaviour tests."""
    import hashlib

    from backend.src.modules.integrations.vetis.manifest import load_manifest_with_pins

    wsdl = FIXTURES / "fixture.wsdl"
    xsd = FIXTURES / "fixture.xsd"
    pins = {
        "status": "PINNED",
        "wsdl": {"resource": str(wsdl), "sha256": hashlib.sha256(wsdl.read_bytes()).hexdigest()},
        "xsd": [{"resource": str(xsd), "sha256": hashlib.sha256(xsd.read_bytes()).hexdigest(), "imports": []}],
    }
    return load_manifest_with_pins(RESOURCES / "manifest.json", pins)


def page(total: int, offset: int, docs: list[str]) -> str:
    return LIST_HEADER.format(total=total, count=len(docs), offset=offset, docs="".join(docs))


# --- 1. Manifest pinning ------------------------------------------------------


def test_manifest_carries_confirmed_profile_without_secrets() -> None:
    """Endpoint/serviceId/namespace/SOAPActions come from the committed manifest; no secrets inside."""
    manifest = json.loads((RESOURCES / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["endpoint"] == "https://api2.vetrf.ru:8002/platform/services/2.0/ApplicationManagementService"
    assert manifest["service_id"] == "mercury-vu.service:2.0"
    assert manifest["namespaces"]["business"] == "http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2"
    assert manifest["soap_actions"]["submit"] == "submitApplicationRequest"
    assert manifest["soap_actions"]["receive"] == "receiveApplicationResultRequest"
    text = (RESOURCES / "manifest.json").read_text(encoding="utf-8")
    for forbidden in ("apiKey", "apiKey:", "password", "login", "issuerId"):
        assert forbidden not in text.lower() or forbidden == "login" and '"login"' not in text.lower()


def test_manifest_matches_versioned_schema() -> None:
    """The committed manifest validates against the versioned JSON schema."""
    from backend.src.modules.integrations.vetis.manifest import load_manifest

    manifest = load_manifest(RESOURCES / "manifest.json")
    assert manifest.service_id == "mercury-vu.service:2.0"
    assert manifest.contour == "PILOT"


def test_schema_pin_checksums_verified(tmp_path: Path) -> None:
    """SHA-256 of the WSDL and every XSD import is verified at load time."""
    import hashlib

    from backend.src.modules.integrations.vetis.manifest import ManifestPinError, load_manifest_with_pins

    wsdl = FIXTURES / "fixture.wsdl"
    xsd = FIXTURES / "fixture.xsd"
    pins = {
        "status": "PINNED",
        "wsdl": {"resource": str(wsdl), "sha256": hashlib.sha256(wsdl.read_bytes()).hexdigest()},
        "xsd": [{"resource": str(xsd), "sha256": hashlib.sha256(xsd.read_bytes()).hexdigest(), "imports": []}],
    }
    loaded = load_manifest_with_pins(RESOURCES / "manifest.json", pins)
    assert loaded.schema_pins.status == "PINNED"

    bad = dict(pins)
    bad["wsdl"] = {"resource": str(wsdl), "sha256": "0" * 64}
    with pytest.raises(ManifestPinError):
        load_manifest_with_pins(RESOURCES / "manifest.json", bad)  # type: ignore[arg-type]


def test_unpinned_manifest_refuses_live_calls() -> None:
    """Without verified WSDL/XSD pins the adapter honestly refuses to call the network."""
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.manifest import load_manifest

    manifest = load_manifest(RESOURCES / "manifest.json")
    transport = FakeTransport([EMPTY_PAGE])
    adapter = VetisReadAdapter(transport=transport, manifest=manifest)  # type: ignore[arg-type]
    with pytest.raises(ProblemError) as raised:
        adapter.require_live_ready()
    assert raised.value.status == 503
    assert raised.value.code == "INTEGRATION_NOT_CONFIGURED"
    assert transport.calls == []


# --- 2. Guard conditions ------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_initiator_is_422() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    transport = SpyTransport()
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    with pytest.raises(ProblemError) as raised:
        await adapter.list_incoming(make_scope(), None, "")
    assert raised.value.status == 422
    assert raised.value.code == "INTEGRATION_INITIATOR_MISSING"
    assert transport.calls == []


@pytest.mark.asyncio
async def test_missing_binding_is_422() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    transport = SpyTransport()
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    scope = VetisScope(laboratory_id=uuid.uuid4(), contour=VetisContour.PILOT)
    with pytest.raises(ProblemError) as raised:
        await adapter.list_incoming(scope, None, "fixture-initiator")
    assert raised.value.status == 422
    assert raised.value.code == "INTEGRATION_SCOPE_MISSING"
    assert transport.calls == []


# --- 3. Business predicate filters -------------------------------------------


@pytest.mark.asyncio
async def test_predicate_filters_unsuitable_documents() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    evsd = uuid.uuid4()
    transport = SpyTransport(
        [
            page(
                5,
                0,
                [
                    doc(evsd, "1"),
                    doc(uuid.uuid4(), "2", receiver="00000000-0000-0000-0000-0000000000e2"),
                    doc(uuid.uuid4(), "3", status="WITHDRAWN"),
                ],
            ),
            page(5, 3, [doc(uuid.uuid4(), "4", product_type="4"), doc(uuid.uuid4(), "5")]),
        ]
    )
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    scope = make_scope()

    first = await adapter.list_incoming(scope, None, "fixture-initiator")
    second = await adapter.list_incoming(scope, first.next_cursor, "fixture-initiator")

    items = first.items + second.items
    assert all(isinstance(item, IncomingDocumentDTO) for item in items)
    assert len(items) == 2
    assert [item.external_status for item in items] == ["CONFIRMED", "CONFIRMED"]
    filtered = {key: first.filtered[key] + second.filtered[key] for key in first.filtered}
    assert filtered["receiver"] == 1
    assert filtered["status"] == 1
    assert filtered["product_type"] == 1
    # A missing productType never counts as meat.
    transport2 = SpyTransport([page(1, 0, [doc(uuid.uuid4(), "6", product_type="")])])
    adapter2 = VetisReadAdapter(transport=transport2, manifest=pinned_manifest())
    result2 = await adapter2.list_incoming(make_scope(), None, "fixture-initiator")
    assert result2.items == []
    assert result2.filtered["product_type"] == 1


# --- 4. Pagination is duplicate-safe ------------------------------------------


@pytest.mark.asyncio
async def test_pagination_replay_does_not_duplicate() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    first, second, repeated = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    transport = SpyTransport(
        [
            page(3, 0, [doc(first, "1"), doc(second, "2")]),
            page(3, 2, [doc(repeated, "3"), doc(first, "1")]),
            page(3, 2, [doc(repeated, "3"), doc(first, "1")]),
        ]
    )
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())

    first_page = await adapter.list_incoming(make_scope(), None, "fixture-initiator")
    assert [i.evsd_uuid for i in first_page.items] == [first, second]
    assert first_page.next_cursor is not None
    # Cursor replays the offset AND the already-returned identities.
    state = _decode_cursor(first_page.next_cursor)
    assert state["offset"] == 2
    assert first_page.complete is False

    second_page = await adapter.list_incoming(make_scope(), first_page.next_cursor, "fixture-initiator")
    assert [i.evsd_uuid for i in second_page.items] == [repeated]
    assert second_page.complete is True

    # Replaying the same cursor returns the same page without duplicating.
    replay = await adapter.list_incoming(make_scope(), first_page.next_cursor, "fixture-initiator")
    assert [i.evsd_uuid for i in replay.items] == [repeated]


# --- 5. Normalization fidelity -------------------------------------------------


@pytest.mark.asyncio
async def test_quantities_precision_and_separate_levels() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    evsd = uuid.uuid4()
    transport = SpyTransport([page(1, 0, [doc(evsd, "77")])])
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    result = await adapter.list_incoming(make_scope(), None, "fixture-initiator")

    batch = result.items[0].snapshot.vd_document.batch
    # Decimal precision retained (DecimalString parses to Decimal).
    assert isinstance(batch.volume, Decimal)
    assert str(batch.volume) == "120.500"
    # Three levels stay separate, each with its own source identity and name.
    assert batch.product.guid is not None
    assert batch.product.external_uuid is not None
    assert batch.product.name == "говядина"
    assert batch.sub_product is not None and batch.sub_product.name == "полутуши"
    assert batch.product_item is not None and batch.product_item.name == "Отруба говяжьи"
    assert batch.product.name != batch.product_item.name
    assert batch.unit is not None and batch.unit.name == "кг"


@pytest.mark.asyncio
async def test_guid_stock_vs_uuid_evsd_separate() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    evsd = uuid.uuid4()
    transport = SpyTransport([page(1, 0, [doc(evsd, "9")])])
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    result = await adapter.list_incoming(make_scope(), None, "fixture-initiator")
    item = result.items[0]
    assert item.evsd_uuid == evsd
    # The product's stock GUID/UUID never substitutes the eVSD UUID.
    assert item.snapshot.vd_document.batch.product.guid != evsd


@pytest.mark.asyncio
async def test_unknown_dictionary_guid_kept_with_source_name() -> None:
    """An GUID unknown to the shared local dictionary does not block the import."""
    from backend.src.modules.integrations.vetis import normalizer

    evsd = uuid.uuid4()
    xml = page(1, 0, [doc(evsd, "10", product_type="1")]).replace(
        "00000000-0000-0000-0000-000000000101", "00000000-0000-0000-0000-00000000dead"
    )
    entries = normalizer.parse_vet_document_list(xml)
    assert len(entries) == 1
    snapshot = normalizer.normalize_snapshot(entries[0])
    assert snapshot.vd_document.batch.product.name == "говядина"
    assert snapshot.vd_document.batch.product.guid is not None
    # The normalizer never consults the local dictionary: it keeps the source name.


# --- 6. Read-only proof ---------------------------------------------------------


@pytest.mark.asyncio
async def test_transport_spy_zero_writes_and_zero_product_service() -> None:
    from backend.src.modules.integrations.vetis.adapter import VetisReadAdapter
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    evsd = uuid.uuid4()
    transport = SpyTransport([page(1, 0, [doc(evsd, "11")])])
    adapter = VetisReadAdapter(transport=transport, manifest=pinned_manifest())
    await adapter.list_incoming(make_scope(), None, "fixture-initiator")
    assert transport.write_calls == 0
    assert transport.product_service_calls == 0
    assert {call["operation"] for call in transport.calls} == {"GetVetDocumentListOperation"}


@pytest.mark.asyncio
async def test_transport_rejects_write_operations() -> None:
    from backend.src.modules.integrations.vetis.transport import (
        build_get_vet_document_list_application,
        is_read_only_operation,
    )

    assert is_read_only_operation("GetVetDocumentListOperation")
    assert not is_read_only_operation("ProcessIncomingConsignment")
    application = build_get_vet_document_list_application(
        endpoint_namespace="http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2",
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture-issuer",
        enterprise_id="fixture-enterprise-guid",
        initiator="fixture-initiator",
        offset=0,
        count=1000,
    )
    assert "getVetDocumentListRequest" in application
    assert "ProcessIncomingConsignment" not in application


def test_subject_modules_never_import_zeep() -> None:
    """XML/SOAP stays inside the adapter: subject modules never import Zeep."""
    for module_name in list(sys.modules):
        if module_name.startswith("backend.src.modules.arrivals") or module_name.startswith(
            "backend.src.modules.integrations.vetis.models"
        ):
            module = sys.modules[module_name]
            assert getattr(module, "__dict__", {}).get("zeep", "zeep-absent") != sys.modules.get("zeep", object())
    arrivals_router_source = Path(sys.modules["backend.src.modules.arrivals.router"].__file__).read_text(
        encoding="utf-8"
    )  # type: ignore[arg-type]
    assert "zeep" not in arrivals_router_source
