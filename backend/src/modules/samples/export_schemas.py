"""Sample accounting export projections (DR49 §7.1, API-06).

The document view is the ONLY data the renderers see: laboratory name, the
generation instant, the applied period, the balances and the FULL disposal
history of the period. Technical values (product GUIDs, actor ids, internal
revisions) are never part of the projection, so they cannot reach the files.
Every mass stays an exact ``Decimal`` — no intermediate float exists.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

__all__ = ["BalanceRow", "DisposalRow", "SampleAccountingDocumentView"]


class BalanceRow(BaseModel):
    """One current positive balance of a product (kg)."""

    model_config = ConfigDict(extra="forbid")

    product_name: str
    mass_kg: Decimal


class DisposalRow(BaseModel):
    """One immutable disposal fact of the history (kg)."""

    model_config = ConfigDict(extra="forbid")

    disposed_on: date
    product_name: str
    mass_kg: Decimal
    external_vsd_number: str
    actor_name: str


class SampleAccountingDocumentView(BaseModel):
    """The full projection of one «Учёт проб» document (PDF/XLSX)."""

    model_config = ConfigDict(extra="forbid")

    laboratory_name: str
    generated_at: datetime
    date_from: date | None = None
    date_to: date | None = None
    balances: list[BalanceRow]
    disposals: list[DisposalRow]

    def period_label(self) -> str:
        """The Russian period label shared by the PDF header and the sheets."""
        from backend.src.modules.samples.export_service import format_day

        if self.date_from is not None and self.date_to is not None:
            return f"{format_day(self.date_from)} — {format_day(self.date_to)}"
        if self.date_from is not None:
            return f"с {format_day(self.date_from)}"
        if self.date_to is not None:
            return f"по {format_day(self.date_to)}"
        return "за всё время"

    def empty_history_text(self) -> str:
        return "За выбранный период утилизаций нет." if self.date_from or self.date_to else "Утилизаций пока нет."
