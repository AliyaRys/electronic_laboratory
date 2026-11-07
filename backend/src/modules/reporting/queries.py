"""Reporting read queries (API-08): operational indicators and sources.

``operational_query`` counts completed facts, never card creation dates
(FT-RPT-02, R-09): «Обработанная партия — одна подтверждённо завершённая
сверка, кроме отмеченных внутренних транзакций», and each really performed
CHECK service gives exactly one unit of its indicator regardless of the
tariff multiplier (the stored fact is the boolean ``performed`` flag; a full
return without the service adds nothing). The internal flag is excluded from
«обработанные партии» only — its performed services are still counted.
Sample balances are the current live sums (samples.queries), independent of
the history window.

``list_report_sources`` projects the completed local ВСЭ cards of one
half-year into ``ReportSource`` facts: the classification comes from the
party snapshot (the Mercury species guid the examination validation also
resolves), the accepted mass from the immutable receipt confirmation, the
performed indicator ids from the research snapshot.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.models import Party, ReceiptConfirmation, Reconciliation
from backend.src.modules.examinations.models import Examination
from backend.src.modules.reporting.calculator import period_bounds
from backend.src.modules.reporting.schemas import OperationalView, ReportPeriod, ReportSource
from backend.src.modules.samples.queries import balance_list

__all__ = ["operational_query", "list_report_sources"]

#: The two CHECK services that own operational indicators (DATA-04).
PRODUCT_IDENTIFICATION = "PRODUCT_IDENTIFICATION"
TRANSPORT_INSPECTION = "TRANSPORT_INSPECTION"

_COMPLETED_STATES = ("CONFIRMED", "RETURNED")


def _performed(services: object, code: str) -> bool:
    """One performed service fact of the reconciliation (boolean semantics)."""
    if not isinstance(services, list):
        return False
    return any(
        isinstance(item, dict) and item.get("code") == code and item.get("performed") is True for item in services
    )


def _species_of(classification_snapshot: object) -> str:
    """The Mercury species guid of a party classification snapshot."""
    product = classification_snapshot.get("product") if isinstance(classification_snapshot, dict) else None
    identifier = product.get("id") if isinstance(product, dict) else None
    return str(identifier) if identifier is not None else ""


async def operational_query(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    date_from: datetime,
    date_to: datetime,
) -> OperationalView:
    """API-08 operational indicators of one laboratory over [from; to)."""
    rows = (
        await db.execute(
            select(Reconciliation.transaction_type, Reconciliation.services)
            .join(Party, Party.id == Reconciliation.party_id)
            .where(
                Party.laboratory_id == laboratory_id,
                Reconciliation.state.in_(_COMPLETED_STATES),
                Reconciliation.completed_at >= date_from,
                Reconciliation.completed_at < date_to,
            )
            .order_by(Reconciliation.party_id)
        )
    ).all()
    processed = 0
    product = 0
    transport = 0
    for transaction_type, services in rows:
        # A reconciliation is unique per party (DATA-02), so one row is one
        # processed party; the internal flag is excluded from it only.
        if transaction_type != "INTERNAL":
            processed += 1
        if _performed(services, PRODUCT_IDENTIFICATION):
            product += 1
        if _performed(services, TRANSPORT_INSPECTION):
            transport += 1
    balances = await balance_list(db, laboratory_id)
    return OperationalView(
        processed_parties=processed,
        product_identifications=product,
        transport_inspections=transport,
        current_sample_balances=balances,
        period=ReportPeriod(date_from=date_from, date_to=date_to),
    )


async def list_report_sources(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    year: int,
    half: int,
) -> list[ReportSource]:
    """The completed local ВСЭ facts of one half-year as calculator sources."""
    start, end = period_bounds(year, half)
    rows = (
        await db.execute(
            select(Examination, Party.classification_snapshot, ReceiptConfirmation.accepted_mass_kg)
            .join(Party, Party.id == Examination.party_id)
            .outerjoin(ReceiptConfirmation, ReceiptConfirmation.party_id == Examination.party_id)
            .where(
                Examination.laboratory_id == laboratory_id,
                Examination.status == "COMPLETED",
                Examination.first_completed_at >= start,
                Examination.first_completed_at < end,
            )
            .order_by(Examination.first_completed_at, Examination.id)
        )
    ).all()
    sources: list[ReportSource] = []
    for examination, classification_snapshot, accepted_mass_kg in rows:
        performed = frozenset(
            uuid.UUID(str(item["indicatorId"]))
            for item in (examination.research_snapshot or [])
            if isinstance(item, dict) and item.get("indicatorId")
        )
        sources.append(
            ReportSource(
                id=examination.id,
                revision=int(examination.rev),
                first_completed_at=examination.first_completed_at,
                classification=_species_of(classification_snapshot),
                accepted_mass_kg=Decimal(str(accepted_mass_kg)) if accepted_mass_kg is not None else Decimal(0),
                performed_indicator_ids=performed,
                sent_to_lab=bool(examination.sent_to_lab),
                outcome=examination.outcome,
                direction=examination.direction,
            )
        )
    return sources
