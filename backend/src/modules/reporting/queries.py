"""Reporting read queries (API-08): operational indicators and sources.

``operational_query`` counts completed facts, never card creation dates
(FT-RPT-02, R-09) for the service indicators; DR48 adds the honest
``saved_examinations`` metric — the number of really existing saved local
ВСЭ cards created in the chosen period (both WAITING and COMPLETED, no
tombstones, no joins-distinct double counting). Each really performed
CHECK service gives exactly one unit of its indicator regardless of the
tariff multiplier (the stored fact is the boolean ``performed`` flag; a full
return without the service adds nothing). The internal flag is excluded from
the old «обработанные партии» metric only — its performed services are still
counted; the saved-cards metric never excludes internal transactions.

``list_report_sources`` projects the completed local ВСЭ cards of one chosen
calendar range into ``ReportSource`` facts: the classification comes from the
party snapshot (the Mercury species guid the examination validation also
resolves), the accepted mass from the immutable receipt confirmation, the
performed indicator ids from the research snapshot.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.models import Party, ReceiptConfirmation, Reconciliation
from backend.src.modules.examinations.models import Examination, ExaminationTombstone
from backend.src.modules.reporting.calculator import range_bounds
from backend.src.modules.reporting.schemas import OperationalView, ReportPeriod, ReportSource

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


def _saved_cards_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """The Moscow wall-clock window of the chosen card-creation days."""
    return range_bounds(date_from, date_to)


async def operational_query(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    date_from: date,
    date_to: date,
) -> OperationalView:
    """API-08 operational indicators of one laboratory over the chosen range."""
    start, end = _saved_cards_bounds(date_from, date_to)
    rows = (
        await db.execute(
            select(Reconciliation.transaction_type, Reconciliation.services)
            .join(Party, Party.id == Reconciliation.party_id)
            .where(
                Party.laboratory_id == laboratory_id,
                Reconciliation.state.in_(_COMPLETED_STATES),
                Reconciliation.completed_at >= start,
                Reconciliation.completed_at < end,
            )
            .order_by(Reconciliation.party_id)
        )
    ).all()
    product = 0
    transport = 0
    for _transaction_type, services in rows:
        if _performed(services, PRODUCT_IDENTIFICATION):
            product += 1
        if _performed(services, TRANSPORT_INSPECTION):
            transport += 1
    # DR48 §2.2: saved_examinations is a plain count of existing Examination
    # cards of the laboratory created in the period — WAITING and COMPLETED
    # both are saved cards; tombstones and other laboratories never count;
    # internal/fair parties never exclude a card; no joins-distinct.
    saved = await db.scalar(
        select(func.count())
        .select_from(Examination)
        .where(
            Examination.laboratory_id == laboratory_id,
            Examination.status.in_(("WAITING", "COMPLETED")),
            Examination.created_at >= start,
            Examination.created_at < end,
            ~select(ExaminationTombstone.examination_id)
            .where(ExaminationTombstone.examination_id == Examination.id)
            .exists(),
        )
    )
    return OperationalView(
        saved_examinations=int(saved or 0),
        product_identifications=product,
        transport_inspections=transport,
        period=ReportPeriod(date_from=date_from, date_to=date_to),
    )


async def list_report_sources(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    date_from: date,
    date_to: date,
) -> list[ReportSource]:
    """The completed local ВСЭ facts of the chosen range as calculator sources."""
    start, end = range_bounds(date_from, date_to)
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
