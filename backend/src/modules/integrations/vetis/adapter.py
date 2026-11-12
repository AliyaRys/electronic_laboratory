"""Read-only VetIS ВУ adapter (ТЗ-10 V01, ADR-018).

``list_incoming(scope, cursor, initiator) -> IncomingPage`` walks one page of
the pinned GetVetDocumentList read application (INCOMING + CONFIRMED scoped to
the pinned enterprise), applies the locally-enforced business predicate before
anything is persisted, and returns arrivals ``IncomingDocument`` DTOs that
feed the A01 ``upsert_incoming`` path directly.

Guards: missing initiator → 422 ``INTEGRATION_INITIATOR_MISSING``; missing
laboratory→ХС/площадка binding → 422 ``INTEGRATION_SCOPE_MISSING``; unpinned
schema → 503 ``INTEGRATION_NOT_CONFIGURED`` before any network contact.
Pagination cursors replay offset + already-returned identities, so replays
and overlapping pages never duplicate or overwrite an eVSD.

Zeep/XML never leaves this package: subject modules import contracts only.
"""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.schemas import IncomingDocument as IncomingDocumentDTO
from backend.src.modules.integrations.vetis.contracts import IncomingPage, VetisScope
from backend.src.modules.integrations.vetis.manifest import (
    VetisManifest,
    integration_not_configured,
)
from backend.src.modules.integrations.vetis.normalizer import (
    NormalizedEntry,
    extract_raw_documents,
    filter_entries,
    normalize_document,
    parse_vet_document_list,
)
from backend.src.modules.integrations.vetis.transport import (
    VetisTransport,
    build_get_vet_document_list_application,
)

__all__ = ["VetisReadAdapter"]

_PAGE_SIZE = 1000


def _initiator_missing() -> ProblemError:
    return ProblemError(
        status=422,
        code="INTEGRATION_INITIATOR_MISSING",
        title="Integration initiator missing",
        detail="Не передан инициатор операции чтения ВетИС. Операция не выполнена.",
    )


def _scope_missing() -> ProblemError:
    return ProblemError(
        status=422,
        code="INTEGRATION_SCOPE_MISSING",
        title="Enterprise binding missing",
        detail=(
            "Поступление не привязано однозначно к лаборатории: связь площадки "
            "с хозяйствующим субъектом не зарегистрирована. Партия не создана."
        ),
    )


class _CursorState(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    offset: int = 0
    seen: list[str] = Field(default_factory=list)


def _encode_cursor(state: _CursorState) -> str:
    raw = json.dumps({"offset": state.offset, "seen": state.seen}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str) -> _CursorState:
    try:
        raw = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")))
        return _CursorState.model_validate(raw)
    except Exception as exc:  # noqa: BLE001 - an opaque cursor is user input
        raise ProblemError(
            status=422,
            code="VALIDATION_ERROR",
            title="Validation error",
            detail="Курсор чтения ВетИС недействителен.",
        ) from exc


class VetisReadAdapter:
    """The pinned read-only ВУ adapter; every call stays inside the manifest."""

    def __init__(
        self,
        *,
        transport: VetisTransport,
        manifest: VetisManifest,
        clock: Callable[[], datetime] | None = None,
        issuer_id: str = "",
        api_key: str | None = None,
    ) -> None:
        self._transport = transport
        self._manifest = manifest
        self._clock = clock or (lambda: datetime.now(UTC))
        # Issuer/application identity comes from the server-side secret file
        # via the composition root; it is never logged and never in fixtures.
        self._issuer_id = issuer_id
        self._api_key = api_key

    def require_live_ready(self) -> None:
        """Refuse the network honestly until WSDL/XSD are pinned and verified."""
        if self._manifest.schema_pins.status != "PINNED":
            raise integration_not_configured()
        if self._manifest.initiator.write_capability:
            raise integration_not_configured()

    async def list_incoming(self, scope: VetisScope, cursor: str | None, initiator: str) -> IncomingPage:
        if not initiator or not initiator.strip():
            raise _initiator_missing()
        if not scope.enterprise_id or not scope.business_member_id:
            raise _scope_missing()
        self.require_live_ready()

        state = _decode_cursor(cursor) if cursor else _CursorState()
        application = build_get_vet_document_list_application(
            endpoint_namespace=self._manifest.namespaces["business"],
            service_id=self._manifest.service_id,
            issuer_id=self._issuer_id,
            business_member_id=scope.business_member_id,
            enterprise_id=scope.enterprise_id,
            initiator=initiator,
            offset=state.offset,
            count=_PAGE_SIZE,
            api_key=self._api_key,
        )
        application_id = await self._transport.send_application(application)
        result_xml = await self._transport.receive_result(application_id)

        entries = parse_vet_document_list(
            result_xml,
            xml_max_bytes=self._manifest.constraints.xml_max_bytes,
            xml_max_depth=self._manifest.constraints.xml_max_depth,
        )
        kept, filtered, filtered_documents = filter_entries(entries, scope)

        items: list[IncomingDocumentDTO] = []
        page_seen: set[str] = set()
        for entry in kept:
            identity = entry.evsd_uuid
            if identity is None or str(identity) in state.seen or str(identity) in page_seen:
                continue  # duplicate-safe: replays and page overlap never duplicate
            page_seen.add(str(identity))
            evsd_uuid, external_status, snapshot = normalize_document(
                entry,
                contour=scope.contour,
                laboratory_id=scope.laboratory_id,
                fetched_at=self._clock(),
            )
            items.append(
                IncomingDocumentDTO(
                    contour=scope.contour,
                    evsd_uuid=evsd_uuid or uuid.uuid4(),
                    laboratory_id=scope.laboratory_id,
                    external_status=external_status,
                    snapshot=snapshot,
                    fetched_at=self._clock(),
                )
            )

        total = _total(entries, result_xml)
        new_offset = state.offset + len(entries)
        complete = new_offset >= total
        next_cursor = None
        if not complete:
            next_state = _CursorState(offset=new_offset, seen=state.seen + sorted(page_seen))
            next_cursor = _encode_cursor(next_state)
        return IncomingPage(
            items=items,
            next_cursor=next_cursor,
            complete=complete,
            filtered=filtered,
            # ТЗ DR9 §5: the filtered external UUIDs BY REASON so the sync can
            # build the FULL observed set (kept + filtered), not only imports.
            filtered_documents=filtered_documents,
            raw_documents=extract_raw_documents(result_xml),
        )


def _total(entries: list[NormalizedEntry], result_xml: str) -> int:
    """The page total; a missing total means this page is the last one."""
    from xml.etree import ElementTree as ET

    ns = {"vd": "http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"}
    try:
        root = ET.fromstring(result_xml)
    except ET.ParseError:
        return 0
    document_list = root.find(".//vd:vetDocumentList", ns)
    total = document_list.get("total") if document_list is not None else None
    if total is None or not total.strip().isdigit():
        return len(entries)
    return max(int(total), len(entries))
