"""Apply verified external receipt evidence atomically to the local gate."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.confirmation import confirm_receipt
from backend.src.modules.arrivals.ports import ReceiptEvidence
from backend.src.modules.integrations.vetis.contracts import ExternalResult
from backend.src.modules.integrations.vetis.models import VetisOperation, VetisOperationState

__all__ = ["reconcile_receipt"]


async def reconcile_receipt(db: AsyncSession, operation: VetisOperation, result: ExternalResult) -> None:
    """Persist terminal state; only complete evidence may open local work."""
    if result.state == "CONFIRMED" and result.detail and isinstance(result.detail.get("evidence"), dict):
        evidence = ReceiptEvidence.model_validate(result.detail["evidence"])
        await confirm_receipt(db, evidence)
        operation.evidence = evidence.model_dump(mode="json")
        operation.state = VetisOperationState.CONFIRMED
        operation.problem_code = None
        operation.problem_detail = None
    elif result.state == "REJECTED":
        operation.state = VetisOperationState.REJECTED
        operation.problem_code = "VETIS_RECEIPT_REJECTED"
        operation.diagnostics = result.detail
    elif result.state == "UNKNOWN":
        operation.state = VetisOperationState.UNKNOWN
        operation.problem_code = "INTEGRATION_EVIDENCE_INCOMPLETE"
        operation.problem_detail = (
            "Внешний результат не доказывает состав гашения; "
            "автоматическая повторная отправка запрещена."
        )
        operation.diagnostics = result.detail
