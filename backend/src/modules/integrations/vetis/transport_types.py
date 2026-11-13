"""The single owner of the Russian transport-type labels (DR19).

The ``vd:certifiedConsignment/vd:transportInfo/vd:transportType`` code is
stored raw AS A STRING (``transportTypeCode``) for business rules, XML гашение
and diagnostics; the Russian label (``transportType``) is a read projection
only and is never fed back into rules (R-DR19-1/2). An unknown future VetIS
code must never look matching automatically: it renders honestly as
«Неизвестный вид транспорта», the raw code stays in the snapshot, the import
is never rejected and the diagnostic log records the code (R-DR19-3).
"""

from __future__ import annotations

import logging

__all__ = [
    "TRANSPORT_TYPE_LABELS",
    "UNKNOWN_TRANSPORT_LABEL",
    "transport_type_label",
]

_LOG = logging.getLogger("vetis.transport_types")

# The DR19-approved map (dorabotka/2026-11-13-transport-type-reconciliation.md §2).
# Codes 6 and 7 are v2.1 values; they are supported like every other code.
TRANSPORT_TYPE_LABELS: dict[str, str] = {
    "1": "Автомобильный",
    "2": "Железнодорожный",
    "3": "Авиатранспортный",
    "4": "Морской (контейнер)",
    "5": "Морской (трюм)",
    "6": "Речной",
    "7": "Перегон (скота)",
}

UNKNOWN_TRANSPORT_LABEL = "Неизвестный вид транспорта"


def transport_type_label(code: str | None) -> str | None:
    """The Russian label for a raw VetIS transport-type code.

    An absent/blank code stays absent (no fictitious value, R-DR19-3); an
    unknown non-empty code renders the honest fallback, keeps the source code
    present and is recorded in the diagnostics.
    """
    if code is None or code.strip() == "":
        return None
    label = TRANSPORT_TYPE_LABELS.get(code.strip())
    if label is None:
        _LOG.warning("unknown_transport_type", extra={"transport_type_code": code.strip()})
        return UNKNOWN_TRANSPORT_LABEL
    return label
