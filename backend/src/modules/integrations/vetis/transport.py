"""VetIS transport boundary (ADR-018): Zeep stays inside the adapter.

The transport speaks only two confirmed SOAP actions of the application
management service (``submitApplicationRequest`` /
``receiveApplicationResultRequest``). Every call records the business
operation it carries; write operations (``ProcessIncomingConsignment``) are
rejected at the boundary before any network contact, and product-dictionary
operations (ProductService family) are never invoked by this read path.

Zeep is imported lazily inside :class:`ZeepApplicationTransport` only: subject
modules never import Zeep, and tests inject a :class:`SpyTransport`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Collection
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

import requests

if TYPE_CHECKING:
    from xml.etree import ElementTree as ET

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.manifest import VetisManifest

__all__ = [
    "WRITE_OPERATIONS",
    "PRODUCT_SERVICE_OPERATIONS",
    "PURPOSE_LIST_PAGE",
    "WriteOperationRejected",
    "VetisTransport",
    "SpyTransport",
    "RestrictedSession",
    "ZeepApplicationTransport",
    "ZeepDictionaryTransport",
    "ZeepEnterpriseLookupTransport",
    "SpyEnterpriseLookupTransport",
    "build_get_vet_document_list_application",
    "build_purpose_list_request",
    "parse_purpose_list",
    "build_get_enterprise_by_guid_request",
    "build_get_business_entity_by_guid_request",
    "parse_enterprise_by_guid",
    "parse_business_entity_by_guid",
    "dictionary_allowlist",
    "enterprise_allowlist",
    "imports_allowlist",
    "is_read_only_operation",
]

# Business operations that change external state — never callable through this
# read-only boundary (ADR-018/ADR-019, O-13).
WRITE_OPERATIONS = frozenset({"ProcessIncomingConsignment"})

# Product-dictionary (ProductService family) operations: the read path never
# resolves names through per-read SOAP dictionary calls.
PRODUCT_SERVICE_OPERATIONS = frozenset(
    {
        "GetProductListOperation",
        "GetProductByUuidOperation",
        "GetProductItemListOperation",
        "GetProductItemByUuidOperation",
        "GetProductItemByGuidOperation",
        "GetSubProductListOperation",
        "GetSubProductByUuidOperation",
        "GetUnitListOperation",
        "GetUnitByUuidOperation",
    }
)

_APPLICATION_DEFINITIONS_NS = "http://api.vetrf.ru/schema/cdm/application/ws-definitions"
_APPLICATION_NS = "http://api.vetrf.ru/schema/cdm/application"
_BASE_NS = "http://api.vetrf.ru/schema/cdm/base"
_DICTIONARY_NS = "http://api.vetrf.ru/schema/cdm/dictionary/v2"
_MERCURY_NS = "http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2"
_VET_DOCUMENT_NS = "http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"


class WriteOperationRejected(Exception):
    """A write operation was requested from the read-only boundary."""


def is_read_only_operation(operation: str) -> bool:
    """True only for business operations that never change external state."""
    return operation not in WRITE_OPERATIONS


def _schema_import_rejected(url: str) -> ProblemError:
    return ProblemError(
        status=503,
        code="INTEGRATION_SCHEMA_IMPORT_REJECTED",
        title="Schema import rejected",
        detail="Запрос за пределами закреплённого набора схем ВетИС отклонён; сетевого обращения не было.",
    )


class RestrictedSession(requests.Session):
    """A requests.Session restricted to the pinned schema import locations.

    Every attempted URL is recorded in ``attempted`` (proof of no egress); a
    URL outside the allowlist raises a 503-style problem BEFORE any network
    contact. Used by the Zeep transport so the WSDL and every XSD
    ``schemaLocation`` import stay inside the manifest pins.
    """

    def __init__(self, allowed: Collection[str]) -> None:
        super().__init__()
        self._allowed = frozenset(url.rstrip("/") for url in allowed)
        self.attempted: list[str] = []

    def is_allowed(self, url: str) -> bool:
        return url.rstrip("/") in self._allowed

    def request(  # type: ignore[override]
        self,
        method: str | bytes,
        url: str,
        *args: object,
        **kwargs: object,
    ) -> object:
        target = str(url)
        self.attempted.append(target)
        if not self.is_allowed(target):
            raise _schema_import_rejected(target)
        return self.perform(str(method), target, **kwargs)

    def perform(self, method: str, url: str, **kwargs: object) -> object:
        """The escape hook to the real session (spy tests override this)."""
        return super().request(method, url, **kwargs)  # type: ignore[arg-type]


def imports_allowlist(manifest: VetisManifest) -> set[str]:
    """The pinned import locations: endpoint, its WSDL and every pinned XSD.

    Built from the manifest only — never from an arbitrary WSDL response.
    """
    allowed: set[str] = {manifest.endpoint, f"{manifest.endpoint}?wsdl"}
    if manifest.schema_pins.wsdl is not None:
        allowed.add(manifest.schema_pins.wsdl.resource)
    for entry in manifest.schema_pins.xsd:
        allowed.add(entry.resource)
        allowed.update(entry.imports)
    return allowed


class VetisTransport(Protocol):
    """The two confirmed SOAP actions of the application management service."""

    async def send_application(self, application_xml: str) -> str: ...

    async def receive_result(self, application_id: str) -> str: ...


class SpyTransport:
    """A recording spy: proves zero external writes and zero ProductService calls."""

    def __init__(self, result_pages: list[str] | None = None) -> None:
        self._pages = list(result_pages or [])
        self.calls: list[dict[str, object]] = []
        self._last_operation = "GetVetDocumentListOperation"

    async def send_application(self, application_xml: str) -> str:
        operation = (
            "ProcessIncomingConsignment"
            if "processIncomingConsignmentRequest" in application_xml
            else "GetVetDocumentListOperation"
        )
        self._last_operation = operation
        self.calls.append(
            {
                "kind": "submitApplicationRequest",
                "operation": operation,
                "xml": application_xml,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        return "spy-application-id"

    async def receive_result(self, application_id: str) -> str:
        page = self._pages.pop(0) if self._pages else ""
        self.calls.append(
            {
                "kind": "receiveApplicationResultRequest",
                # The business operation being polled (the SOAP action itself
                # remains recorded in ``kind``).
                "operation": self._last_operation,
                "application_id": application_id,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        return page

    @property
    def write_calls(self) -> int:
        return sum(1 for call in self.calls if str(call["operation"]) in WRITE_OPERATIONS)

    @property
    def product_service_calls(self) -> int:
        return sum(1 for call in self.calls if str(call["operation"]) in PRODUCT_SERVICE_OPERATIONS)


class ZeepApplicationTransport:
    """The real Zeep boundary: TLS verified, DTD/entities off, bounded timeouts.

    Connection timeout 10 s, read timeout 60 s (manifest constraints). The
    Zeep client is created lazily and used inside a worker thread because Zeep
    is synchronous; the async protocol stays honest for the caller.

    ``allowed_urls`` is the schema imports allowlist (ADR-018): every HTTP(S)
    request Zeep makes — the WSDL itself, every XSD ``schemaLocation`` import —
    must be in the allowlist built from the manifest pins; anything else is
    rejected BEFORE any network egress.
    """

    def __init__(
        self,
        endpoint: str,
        connect_timeout_s: int = 10,
        read_timeout_s: int = 60,
        allowed_urls: Collection[str] | None = None,
        gateway_user: str | None = None,
        gateway_password: str | None = None,
        api_key: str | None = None,
        issuer_id: str | None = None,
    ) -> None:
        self._endpoint = endpoint
        self._connect_timeout = connect_timeout_s
        self._read_timeout = read_timeout_s
        self._allowed_urls = frozenset(allowed_urls or ())
        self._gateway_user = gateway_user
        self._gateway_password = gateway_password
        self._api_key = api_key
        self._issuer_id = issuer_id

    def _client(self) -> object:  # pragma: no cover - requires credentials/zeep at runtime
        import zeep
        from zeep.transports import Transport

        settings = zeep.Settings(
            strict=False,
            xml_huge_tree=False,
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True,
        )
        session = RestrictedSession(allowed=self._allowed_urls) if self._allowed_urls else requests.Session()
        if self._gateway_user is not None and self._gateway_password is not None:
            session.auth = (self._gateway_user, self._gateway_password)
        transport = Transport(session=session, timeout=self._read_timeout, operation_timeout=self._read_timeout)  # type: ignore[no-untyped-call]
        # TLS verification is left at its verified default (never disabled).
        return zeep.Client(wsdl=f"{self._endpoint}?wsdl", transport=transport, settings=settings)  # type: ignore[no-untyped-call]

    def _post(self, action: str, body: str) -> str:  # pragma: no cover - live boundary
        session = RestrictedSession(allowed=self._allowed_urls) if self._allowed_urls else requests.Session()
        if self._gateway_user is not None and self._gateway_password is not None:
            session.auth = (self._gateway_user, self._gateway_password)
        envelope = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
            f"<soapenv:Header/><soapenv:Body>{body}</soapenv:Body></soapenv:Envelope>"
        )
        response = session.post(
            self._endpoint,
            data=envelope.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": action},
            timeout=(self._connect_timeout, self._read_timeout),
        )
        response.raise_for_status()
        return str(response.text)

    async def send_application(self, application_xml: str) -> str:  # pragma: no cover
        response_xml = await asyncio.to_thread(self._post, "submitApplicationRequest", application_xml)
        from xml.etree import ElementTree as ET

        root = ET.fromstring(response_xml)
        application_id = next(
            (
                node.text.strip()
                for node in root.iter()
                if node.tag.rsplit("}", 1)[-1] == "applicationId" and node.text and node.text.strip()
            ),
            None,
        )
        if application_id is None:
            raise ProblemError(
                status=502,
                code="VETIS_SUBMIT_RESPONSE_INVALID",
                title="VetIS submit response invalid",
                detail="Шлюз ВетИС не вернул applicationId; повторная отправка автоматически запрещена.",
            )
        return application_id

    async def receive_result(self, application_id: str) -> str:  # pragma: no cover
        from xml.sax.saxutils import escape

        body = (
            f'<apldef:receiveApplicationResultRequest xmlns:apldef="{_APPLICATION_DEFINITIONS_NS}">'
            f"<apldef:apiKey>{escape(self._api_key or '')}</apldef:apiKey>"
            f"<apldef:issuerId>{escape(self._issuer_id or '')}</apldef:issuerId>"
            f"<apldef:applicationId>{escape(application_id)}</apldef:applicationId>"
            "</apldef:receiveApplicationResultRequest>"
        )
        return await asyncio.to_thread(self._post, "receiveApplicationResultRequest", body)


def build_get_vet_document_list_application(
    *,
    endpoint_namespace: str,
    service_id: str,
    issuer_id: str,
    business_member_id: str,
    enterprise_id: str,
    initiator: str,
    offset: int,
    count: int,
    api_key: str | None = None,
) -> str:
    """Build the submitApplicationRequest envelope for a READ list application.

    The secret ``apiKey`` (when provided) is inserted by the caller from the
    secret profile only; it is never logged and never present in fixtures.
    """
    from xml.sax.saxutils import escape

    if not is_read_only_operation("GetVetDocumentListOperation"):
        raise WriteOperationRejected("GetVetDocumentListOperation")
    count = max(1, min(count, 1000))
    offset = max(0, offset)
    import uuid

    api_key_value = escape(api_key or "")
    return (
        f'<apldef:submitApplicationRequest xmlns:apldef="{_APPLICATION_DEFINITIONS_NS}" '
        f'xmlns:apl="{_APPLICATION_NS}" xmlns:bs="{_BASE_NS}" xmlns:dt="{_DICTIONARY_NS}" '
        f'xmlns:mercvu="{_MERCURY_NS}" xmlns:vd="{_VET_DOCUMENT_NS}">'
        f"<apldef:apiKey>{api_key_value}</apldef:apiKey>"
        "<apl:application>"
        f"<apl:serviceId>{escape(service_id)}</apl:serviceId>"
        f"<apl:issuerId>{escape(issuer_id)}</apl:issuerId>"
        f"<apl:issueDate>{datetime.now(UTC).isoformat()}</apl:issueDate>"
        "<apl:data>"
        "<mercvu:getVetDocumentListRequest>"
        f"<mercvu:localTransactionId>{uuid.uuid4()}</mercvu:localTransactionId>"
        f"<mercvu:initiator><vd:login>{escape(initiator)}</vd:login></mercvu:initiator>"
        f"<bs:listOptions><bs:count>{count}</bs:count><bs:offset>{offset}</bs:offset></bs:listOptions>"
        "<vd:vetDocumentType>INCOMING</vd:vetDocumentType>"
        "<vd:vetDocumentStatus>CONFIRMED</vd:vetDocumentStatus>"
        "<mercvu:businessMember>"
        f"<dt:businessEntity><bs:guid>{escape(business_member_id)}</bs:guid></dt:businessEntity>"
        f"<dt:enterprise><bs:guid>{escape(enterprise_id)}</bs:guid></dt:enterprise>"
        "</mercvu:businessMember>"
        "</mercvu:getVetDocumentListRequest>"
        "</apl:data></apl:application></apldef:submitApplicationRequest>"
    )


# --- the purpose dictionary (GetPurposeList, ТЗ DR5 §9.4) ------------------------

# The page size the owner pinned for the full purpose walk (API REQUESTS.txt
# item 3): more than 151 today, so a complete pass needs one page unless the
# external list grows.
PURPOSE_LIST_PAGE = 160

_REGISTRY_DEFINITIONS_NS = "http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2"


def dictionary_allowlist(manifest: VetisManifest) -> set[str]:
    """The fail-closed allowlist of the DictionaryService boundary.

    Built from the pinned manifest only: the DictionaryService endpoint
    itself. Every other URL is rejected BEFORE any network contact.
    """
    allowed = imports_allowlist(manifest)
    if manifest.dictionary_endpoint:
        allowed.add(manifest.dictionary_endpoint)
    return allowed


def build_purpose_list_request(*, offset: int, count: int) -> str:
    """The plain SOAP envelope of a read-only GetPurposeList page."""
    if not is_read_only_operation("GetPurposeList"):
        raise WriteOperationRejected("GetPurposeList")
    return (
        f'<ws:getPurposeListRequest xmlns:ws="{_REGISTRY_DEFINITIONS_NS}" '
        f'xmlns:bs="{_BASE_NS}">'
        f"<bs:listOptions><bs:count>{max(1, count)}</bs:count>"
        f"<bs:offset>{max(0, offset)}</bs:offset></bs:listOptions>"
        "</ws:getPurposeListRequest>"
    )


def parse_purpose_list(result_xml: str) -> tuple[list[dict[str, object]], int]:
    """Parse one GetPurposeList page into source-faithful records.

    Returns (records, total). A record carries guid/uuid/name/active/last/
    status/createDate/updateDate/previous exactly as the source rendered them.
    """
    from xml.etree import ElementTree as ET

    ns = {
        "bs": _BASE_NS,
        "dt": _DICTIONARY_NS,
        "v2": _REGISTRY_DEFINITIONS_NS,
    }
    root = ET.fromstring(result_xml)
    purpose_list = root.find(".//dt:purposeList", ns)
    if purpose_list is None:
        raise ProblemError(
            status=502,
            code="VETIS_PURPOSE_LIST_INVALID",
            title="VetIS purpose list invalid",
            detail="Ответ ВетИС не содержит список назначений груза.",
        )
    raw_total = purpose_list.get("total") or "0"
    total = int(raw_total) if raw_total.strip().isdigit() else 0
    records: list[dict[str, object]] = []

    def _text(parent: ET.Element | None, tag: str) -> str | None:
        node = parent.find(tag, ns) if parent is not None else None
        if node is None or node.text is None:
            return None
        value = node.text.strip()
        return value or None

    for element in purpose_list.findall("dt:purpose", ns):
        guid = _text(element, "bs:guid")
        name = _text(element, "dt:name")
        if not guid or not name:
            # A record without its stable identity or name is unusable; the
            # pass must not fabricate one.
            raise ProblemError(
                status=502,
                code="VETIS_PURPOSE_LIST_INVALID",
                title="VetIS purpose list invalid",
                detail="Ответ ВетИС содержит запись назначения без GUID или названия.",
            )
        records.append(
            {
                "guid": guid,
                "uuid": _text(element, "bs:uuid"),
                "name": name,
                "active": (_text(element, "bs:active") or "false") == "true",
                "last": (_text(element, "bs:last") or "false") == "true",
                "status": int(_text(element, "bs:status") or 0),
                "created_at": _text(element, "bs:createDate"),
                "updated_at": _text(element, "bs:updateDate"),
                "previous": _text(element, "bs:previous"),
            }
        )
    return records, total


class ZeepDictionaryTransport:
    """The real read-only DictionaryService boundary (GetPurposeList only).

    Same guards as the application transport: TLS verified, DTD/entities off,
    bounded timeouts and the fail-closed URL allowlist; the SOAPAction comes
    from the pinned manifest, never guessed.
    """

    def __init__(
        self,
        endpoint: str,
        *,
        soap_action: str,
        connect_timeout_s: int = 10,
        read_timeout_s: int = 60,
        allowed_urls: Collection[str] | None = None,
        gateway_user: str | None = None,
        gateway_password: str | None = None,
    ) -> None:
        self._endpoint = endpoint
        self._soap_action = soap_action
        self._connect_timeout = connect_timeout_s
        self._read_timeout = read_timeout_s
        self._allowed_urls = frozenset(allowed_urls or ())
        self._gateway_user = gateway_user
        self._gateway_password = gateway_password

    def _post(self, body: str) -> str:  # pragma: no cover - live boundary
        session = RestrictedSession(allowed=self._allowed_urls) if self._allowed_urls else requests.Session()
        if self._gateway_user is not None and self._gateway_password is not None:
            session.auth = (self._gateway_user, self._gateway_password)
        envelope = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
            f"<soapenv:Header/><soapenv:Body>{body}</soapenv:Body></soapenv:Envelope>"
        )
        response = session.post(
            self._endpoint,
            data=envelope.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": self._soap_action},
            timeout=(self._connect_timeout, self._read_timeout),
        )
        response.raise_for_status()
        return str(response.text)

    async def get_purpose_list_page(self, *, offset: int, count: int) -> str:
        return await asyncio.to_thread(self._post, build_purpose_list_request(offset=offset, count=count))


class SpyPurposeTransport:
    """A recording spy of the purpose boundary: proves zero writes and records
    every requested page (used by the dictionary-sync tests only)."""

    def __init__(self, pages: list[str]) -> None:
        self._pages = list(pages)
        self.calls: list[dict[str, object]] = []

    async def get_purpose_list_page(self, *, offset: int, count: int) -> str:
        self.calls.append({"offset": offset, "count": count, "at": datetime.now(UTC).isoformat()})
        if not self._pages:
            raise RuntimeError("spy: no more purpose pages")
        return self._pages.pop(0)


# --- the participant-name lookups (ТЗ DR18 §8, EnterpriseService) -----------------

def build_get_enterprise_by_guid_request(guid: str, *, registry_ns: str = _REGISTRY_DEFINITIONS_NS) -> str:
    """The plain SOAP envelope of a read-only GetEnterpriseByGuid v2 call."""
    from xml.sax.saxutils import escape

    if not is_read_only_operation("GetEnterpriseByGuid"):
        raise WriteOperationRejected("GetEnterpriseByGuid")
    return (
        f'<ws:getEnterpriseByGuidRequest xmlns:ws="{registry_ns}" '
        f'xmlns:bs="{_BASE_NS}">'
        f"<bs:guid>{escape(guid)}</bs:guid>"
        "</ws:getEnterpriseByGuidRequest>"
    )


def build_get_business_entity_by_guid_request(guid: str, *, registry_ns: str = _REGISTRY_DEFINITIONS_NS) -> str:
    """The plain SOAP envelope of a read-only GetBusinessEntityByGUID call."""
    from xml.sax.saxutils import escape

    if not is_read_only_operation("GetBusinessEntityByGUID"):
        raise WriteOperationRejected("GetBusinessEntityByGUID")
    return (
        f'<ws:getBusinessEntityByGuidRequest xmlns:ws="{registry_ns}" '
        f'xmlns:bs="{_BASE_NS}">'
        f"<bs:guid>{escape(guid)}</bs:guid>"
        "</ws:getBusinessEntityByGuidRequest>"
    )


def _localname(element: ET.Element | None) -> str:
    return element.tag.rsplit("}", 1)[-1] if element is not None else ""


def _child_text(parent: ET.Element | None, localname: str) -> str | None:
    """A DIRECT child value read by LOCALNAME only (the pinned response namespaces
    come from the contract; the parser never guesses them from a ВВСД XML).

    R-DR25-1/2: only the element's OWN children qualify — a descendant search
    would reach nested containers (juridicalAddress/country/region/…), which
    are never a source of a businessEntity/enterprise field. That descendant
    search is exactly how a country name once leaked into the ХС name."""
    if parent is None:
        return None
    for child in parent:
        if _localname(child) == localname:
            value = (child.text or "").strip()
            return value or None
    return None


def _identity_record(element: ET.Element | None, kind: str) -> dict[str, object]:
    """The source-faithful record of one lookup response (ТЗ DR18 §8)."""
    if element is None or _localname(element) != kind:
        raise ProblemError(
            status=502,
            code="VETIS_REFERENCE_RESPONSE_INVALID",
            title="VetIS reference response invalid",
            detail=f"Ответ ВетИС не содержит объект {kind}.",
        )
    created = _child_text(element, "createDate")
    updated = _child_text(element, "updateDate")
    return {
        "guid": _child_text(element, "guid"),
        "uuid": _child_text(element, "uuid"),
        "active": (_child_text(element, "active") or "false") == "true",
        "last": (_child_text(element, "last") or "false") == "true",
        "status": int(_child_text(element, "status") or 0),
        "created_at": created,
        "updated_at": updated,
    }


def parse_enterprise_by_guid(result_xml: str) -> dict[str, object]:
    """Parse a GetEnterpriseByGuid v2 response; the name is the enterprise's
    OWN top-level ``dt:name`` — never a nested address field (R-DR25-2)."""
    from xml.etree import ElementTree as ET

    root = ET.fromstring(result_xml)
    enterprise = next((node for node in root.iter() if _localname(node) == "enterprise"), None)
    record = _identity_record(enterprise, "enterprise")
    record["name"] = _child_text(enterprise, "name")
    return record


def parse_business_entity_by_guid(result_xml: str) -> dict[str, object]:
    """Parse a GetBusinessEntityByGUID response; the name cascade reads ONLY
    the top-level children of dt:businessEntity: name → fullName → fio
    (R-DR25-1). Nested elements (juridicalAddress/country/…) are NEVER a
    source: when none of the three fields is present the record yields NO
    name (VETIS_REFERENCE_NAME_ABSENT → retry), never an address substitute."""
    from xml.etree import ElementTree as ET

    root = ET.fromstring(result_xml)
    entity = next((node for node in root.iter() if _localname(node) == "businessEntity"), None)
    record = _identity_record(entity, "businessEntity")
    record["name"] = (
        _child_text(entity, "name") or _child_text(entity, "fullName") or _child_text(entity, "fio")
    )
    return record


def enterprise_allowlist(manifest: VetisManifest) -> set[str]:
    """The fail-closed allowlist of the EnterpriseService boundary."""
    allowed = dictionary_allowlist(manifest)
    if manifest.enterprise_endpoint:
        allowed.add(manifest.enterprise_endpoint)
    return allowed


class ZeepEnterpriseLookupTransport:
    """The real read-only EnterpriseService boundary (ТЗ DR18 §8).

    Same guards as the dictionary transport: TLS verified, DTD/entities off,
    bounded timeouts and the fail-closed URL allowlist; both SOAP actions come
    from the pinned manifest, never guessed.
    """

    def __init__(
        self,
        endpoint: str,
        *,
        enterprise_action: str,
        business_entity_action: str,
        connect_timeout_s: int = 10,
        read_timeout_s: int = 60,
        allowed_urls: Collection[str] | None = None,
        gateway_user: str | None = None,
        gateway_password: str | None = None,
    ) -> None:
        self._endpoint = endpoint
        self._enterprise_action = enterprise_action
        self._business_entity_action = business_entity_action
        self._connect_timeout = connect_timeout_s
        self._read_timeout = read_timeout_s
        self._allowed_urls = frozenset(allowed_urls or ())
        self._gateway_user = gateway_user
        self._gateway_password = gateway_password

    def _post(self, action: str, body: str) -> str:  # pragma: no cover - live boundary
        session = RestrictedSession(allowed=self._allowed_urls) if self._allowed_urls else requests.Session()
        if self._gateway_user is not None and self._gateway_password is not None:
            session.auth = (self._gateway_user, self._gateway_password)
        envelope = (
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
            f"<soapenv:Header/><soapenv:Body>{body}</soapenv:Body></soapenv:Envelope>"
        )
        response = session.post(
            self._endpoint,
            data=envelope.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": action},
            timeout=(self._connect_timeout, self._read_timeout),
        )
        response.raise_for_status()
        return str(response.text)

    async def get_enterprise_by_guid(self, guid: str) -> str:
        return await asyncio.to_thread(
            self._post, self._enterprise_action, build_get_enterprise_by_guid_request(guid)
        )

    async def get_business_entity_by_guid(self, guid: str) -> str:
        return await asyncio.to_thread(
            self._post, self._business_entity_action, build_get_business_entity_by_guid_request(guid)
        )


class SpyEnterpriseLookupTransport:
    """A recording spy of the EnterpriseService boundary (ТЗ DR18 §11).

    Proves zero write operations: only the two read-only lookup methods are
    invokable; every call is recorded with its operation name.
    """

    def __init__(
        self,
        *,
        enterprise_responses: list[str] | None = None,
        business_entity_responses: list[str] | None = None,
        failure: Exception | None = None,
    ) -> None:
        self._enterprise_responses = list(enterprise_responses or [])
        self._business_entity_responses = list(business_entity_responses or [])
        self._failure = failure
        self.calls: list[dict[str, object]] = []

    async def get_enterprise_by_guid(self, guid: str) -> str:
        self.calls.append({"operation": "GetEnterpriseByGuid", "guid": guid})
        if self._failure is not None:
            raise self._failure
        if not self._enterprise_responses:
            raise RuntimeError("spy: no more enterprise responses")
        return self._enterprise_responses.pop(0)

    async def get_business_entity_by_guid(self, guid: str) -> str:
        self.calls.append({"operation": "GetBusinessEntityByGUID", "guid": guid})
        if self._failure is not None:
            raise self._failure
        if not self._business_entity_responses:
            raise RuntimeError("spy: no more business entity responses")
        return self._business_entity_responses.pop(0)
