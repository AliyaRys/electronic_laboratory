"""The single owner of the Russian transport-storage-type labels (DR16).

The ``vd:certifiedConsignment/vd:transportStorageType`` code is stored raw
(``storageCode``) for business rules, XML гашение and diagnostics; the Russian
label (``storage``) is a UI/document projection only and is never fed back
into rules (R-DR16-1). An unknown future VetIS code must never look matching
automatically: it renders honestly as «Неизвестный способ хранения», the raw
code stays in the snapshot and the diagnostic log (R-DR16-3).
"""

from __future__ import annotations

import logging

__all__ = ["STORAGE_TYPE_LABELS", "UNKNOWN_STORAGE_LABEL", "storage_type_label"]

_LOG = logging.getLogger("vetis.storage_types")

# The DR16-approved map (dorabotka/2026-11-12-transport-storage-comparison.md §3).
STORAGE_TYPE_LABELS: dict[str, str] = {
    "FROZEN": "Замороженный",
    "CHILLED": "Охлажденный",
    "COOLED": "Охлаждаемый",
    "VENTILATED": "Вентилируемый",
}

UNKNOWN_STORAGE_LABEL = "Неизвестный способ хранения"


def storage_type_label(code: str | None) -> str | None:
    """The Russian label for a raw VetIS storage code.

    An absent/blank code stays absent (no fictitious value, R-DR16-3); an
    unknown non-empty code renders the honest fallback and is recorded in the
    diagnostics.
    """
    if code is None or code.strip() == "":
        return None
    label = STORAGE_TYPE_LABELS.get(code.strip().upper())
    if label is None:
        _LOG.warning("unknown_transport_storage_type", extra={"storage_code": code.strip()})
        return UNKNOWN_STORAGE_LABEL
    return label
