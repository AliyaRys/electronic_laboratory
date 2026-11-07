"""VetIS ports (DATA-06): the seam the local modules build against.

Until ТЗ-10/ТЗ-11 the only real implementation is the disabled adapter: every
call answers ``503 INTEGRATION_NOT_CONFIGURED`` honestly — no SOAP, no
network, no fabricated data (ADR-018: «фиктивные поступления/подтверждения не
создаются»). The concrete SOAP adapter is composed in the integration
composition root only.
"""

from __future__ import annotations

from typing import Protocol

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.contracts import (
    ExternalResult,
    IncomingPage,
    ReceiptIntent,
    ReconciliationEvidence,
    Submission,
    VetisScope,
)

__all__ = ["VetisReadPort", "VetisWritePort", "DisabledVetisAdapter"]


def integration_not_configured() -> ProblemError:
    """The stable 503 problem for an unconfigured VetIS module (API-10)."""
    return ProblemError(
        status=503,
        code="INTEGRATION_NOT_CONFIGURED",
        title="Integration not configured",
        detail=(
            "Интеграция с ВетИС не настроена. Обновление поступлений недоступно; обратитесь к администратору установки."
        ),
    )


class VetisReadPort(Protocol):
    """Stage 1 (ADR-018): read-only access to the VU document list."""

    async def list_incoming(self, scope: VetisScope, cursor: str | None) -> IncomingPage: ...


class VetisWritePort(Protocol):
    """Stage 2 (ADR-019): receipt submission, polling and reconciliation."""

    async def submit_receipt(self, intent: ReceiptIntent, initiator: str) -> Submission: ...

    async def get_operation(self, application_id: str, initiator: str) -> ExternalResult: ...

    async def reconcile_receipt(self, intent: ReceiptIntent, initiator: str) -> ReconciliationEvidence: ...


class DisabledVetisAdapter:
    """The honest disabled adapter: every port raises a stable 503 problem."""

    async def list_incoming(self, scope: VetisScope, cursor: str | None) -> IncomingPage:
        raise integration_not_configured()

    async def submit_receipt(self, intent: ReceiptIntent, initiator: str) -> Submission:
        raise integration_not_configured()

    async def get_operation(self, application_id: str, initiator: str) -> ExternalResult:
        raise integration_not_configured()

    async def reconcile_receipt(self, intent: ReceiptIntent, initiator: str) -> ReconciliationEvidence:
        raise integration_not_configured()
