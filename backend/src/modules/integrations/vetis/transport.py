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
from typing import Protocol

import requests

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.manifest import VetisManifest

__all__ = [
    "WRITE_OPERATIONS",
    "PRODUCT_SERVICE_OPERATIONS",
    "WriteOperationRejected",
    "VetisTransport",
    "SpyTransport",
    "RestrictedSession",
    "ZeepApplicationTransport",
    "build_get_vet_document_list_application",
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

_APPLICATION_NS = "http://api.vetrf.ru/schema/cdm/application/v2"
_BASE_NS = "http://api.vetrf.ru/schema/cdm/base"
_MERCURY_NS = "http://api.vetrf.ru/schema/cdm/mercury/vu/applications/v2"


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

    async def send_application(self, application_xml: str) -> str:
        self.calls.append(
            {
                "kind": "submitApplicationRequest",
                "operation": "GetVetDocumentListOperation",
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
                "operation": "GetVetDocumentListOperation",
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
    ) -> None:
        self._endpoint = endpoint
        self._connect_timeout = connect_timeout_s
        self._read_timeout = read_timeout_s
        self._allowed_urls = frozenset(allowed_urls or ())

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
        transport = Transport(session=session, timeout=self._read_timeout, operation_timeout=self._read_timeout)  # type: ignore[no-untyped-call]
        # TLS verification is left at its verified default (never disabled).
        return zeep.Client(wsdl=f"{self._endpoint}?wsdl", transport=transport, settings=settings)  # type: ignore[no-untyped-call]

    async def send_application(self, application_xml: str) -> str:  # pragma: no cover
        client = await asyncio.to_thread(self._client)
        service = client.service  # type: ignore[attr-defined]
        return await asyncio.to_thread(
            service.submitApplicationRequest,
            _tns=_APPLICATION_NS,
            arg=application_xml,
        )

    async def receive_result(self, application_id: str) -> str:  # pragma: no cover
        client = await asyncio.to_thread(self._client)
        service = client.service  # type: ignore[attr-defined]
        return await asyncio.to_thread(
            service.receiveApplicationResultRequest,
            _tns=_APPLICATION_NS,
            applicationId=application_id,
        )


def build_get_vet_document_list_application(
    *,
    endpoint_namespace: str,
    service_id: str,
    issuer_id: str,
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
    api_key_line = f"<ns2:apiKey>{escape(api_key)}</ns2:apiKey>" if api_key else ""
    return (
        f'<ns2:submitApplicationRequest xmlns:ns2="{_APPLICATION_NS}" '
        f'xmlns:bs="{_BASE_NS}" xmlns:mer="{_MERCURY_NS}">'
        f"{api_key_line}"
        "<ns2:application>"
        f"<ns2:serviceId>{escape(service_id)}</ns2:serviceId>"
        f"<ns2:issuerId>{escape(issuer_id)}</ns2:issuerId>"
        f"<ns2:issueDate>{datetime.now(UTC).isoformat()}</ns2:issueDate>"
        "<mer:getVetDocumentListRequest>"
        f"<mer:enterpriseGuid>{escape(enterprise_id)}</mer:enterpriseGuid>"
        f"<mer:initiator><bs:login>{escape(initiator)}</bs:login></mer:initiator>"
        "<bs:vetDocumentType>INCOMING</bs:vetDocumentType>"
        "<bs:vetDocumentStatus>CONFIRMED</bs:vetDocumentStatus>"
        f"<bs:count>{count}</bs:count>"
        f"<bs:offset>{offset}</bs:offset>"
        "</mer:getVetDocumentListRequest>"
        "</ns2:application></ns2:submitApplicationRequest>"
    )
