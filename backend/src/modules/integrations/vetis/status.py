"""The single owner of the Russian eVSD status labels (ТЗ DR5 §8).

Business rules (filters, admissibility, sync) always use the RAW
``vetDStatus`` code stored in ``incoming_documents.external_status``; the
Russian label is a UI/document projection only and is never fed back into
rules. An unknown future code must never look CONFIRMED: it renders as
«Неизвестный статус» while the raw code stays in backend diagnostics.
"""

from __future__ import annotations

__all__ = ["STATUS_LABELS", "UNKNOWN_STATUS_LABEL", "status_label"]

# The owner-approved map (C:\Users\Алия\Desktop\status_vetis.txt, section 8
# of the доработка spec). ``FINALIZED`` is supported defensively: the docs
# note it is not used in ``vetDStatus`` (the flag is ``finalized``), but an
# unexpected code must still translate honestly instead of crashing.
STATUS_LABELS: dict[str, str] = {
    "CONFIRMED": "Оформлен",
    "WITHDRAWN": "Аннулирован",
    "UTILIZED": "Погашен",
    "FINALIZED": "Закрыт",
}

UNKNOWN_STATUS_LABEL = "Неизвестный статус"


def status_label(code: str | None) -> str:
    """The Russian label for a raw VetIS status code; unknown → «Неизвестный статус»."""
    if not code:
        return UNKNOWN_STATUS_LABEL
    return STATUS_LABELS.get(code.strip().upper(), UNKNOWN_STATUS_LABEL)
