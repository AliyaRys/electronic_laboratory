"""Sample ledger read queries (API-06): available facts and the live balance.

The balance is never materialized (DATA-03): it is the SUM of collections of
the party with ``disposal_id IS NULL``, computed inside the caller's
transaction so a concurrent selection/disposal is always reflected.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.samples.commands import disposal_view
from backend.src.modules.samples.models import SampleBasket, SampleCollection, SampleDisposal
from backend.src.modules.samples.schemas import BalanceView, CollectionView, DisposalView

__all__ = [
    "list_available_collections",
    "active_party_mass",
    "balance_list",
    "collection_page",
    "disposal_page",
    "PAGE_SIZE",
]

PAGE_SIZE = 20


def _plain(value: Decimal | None) -> str:
    """A plain decimal string without the numeric scale (``12.600000`` → ``12.6``)."""
    if value is None:
        return "0"
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _active(party_id: UUID) -> Select[tuple[SampleCollection]]:
    return (
        select(SampleCollection)
        .where(SampleCollection.party_id == party_id, SampleCollection.disposal_id.is_(None))
        .order_by(SampleCollection.created_at, SampleCollection.id)
    )


def _view(collection: SampleCollection) -> CollectionView:
    return CollectionView(
        id=str(collection.id),
        party_id=str(collection.party_id),
        laboratory_id=str(collection.laboratory_id),
        product_species_id=str(collection.product_species_id),
        classification_snapshot=dict(collection.classification_snapshot),
        collected_on=collection.collected_on,
        mass_kg=str(collection.mass_kg),
        collected_by=str(collection.collected_by),
        created_at=collection.created_at,
        disposal_id=str(collection.disposal_id) if collection.disposal_id is not None else None,
        revision=int(collection.rev or 1),
    )


async def list_available_collections(db: AsyncSession, party_id: UUID) -> list[CollectionView]:
    """The available (not disposed) physical facts of one party, oldest first."""
    rows = (await db.execute(_active(party_id))).scalars().all()
    return [_view(row) for row in rows]


async def active_party_mass(db: AsyncSession, party_id: UUID) -> Decimal:
    """The current balance of one party: SUM of its active collections."""
    total = (
        await db.execute(
            select(func.sum(SampleCollection.mass_kg)).where(
                SampleCollection.party_id == party_id, SampleCollection.disposal_id.is_(None)
            )
        )
    ).scalar_one()
    return Decimal(total) if total is not None else Decimal("0")


# --- S03 accounting read model (API-06) ---------------------------------------------


async def balance_list(db: AsyncSession, laboratory_id: UUID) -> list[BalanceView]:
    """The live balances of one laboratory: SUM of the active collections per
    species with the basket revision (DATA-03 — computed at query time, never
    materialized). Species without active collections are not listed."""
    rows = (
        await db.execute(
            select(
                SampleCollection.product_species_id,
                func.sum(SampleCollection.mass_kg).label("mass"),
                func.coalesce(func.max(SampleBasket.rev), 1).label("revision"),
            )
            .outerjoin(
                SampleBasket,
                (SampleBasket.laboratory_id == SampleCollection.laboratory_id)
                & (SampleBasket.product_species_id == SampleCollection.product_species_id),
            )
            .where(SampleCollection.laboratory_id == laboratory_id, SampleCollection.disposal_id.is_(None))
            .group_by(SampleCollection.product_species_id)
            .order_by(SampleCollection.product_species_id)
        )
    ).all()
    return [
        BalanceView(
            product_species_id=str(row.product_species_id),
            mass_kg=_plain(row.mass),
            revision=int(row.revision),
        )
        for row in rows
    ]


async def collection_page(db: AsyncSession, laboratory_id: UUID, page: int) -> tuple[list[CollectionView], int]:
    """A stable page of the available (not disposed) facts of one laboratory."""
    base = select(SampleCollection).where(
        SampleCollection.laboratory_id == laboratory_id, SampleCollection.disposal_id.is_(None)
    )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                base.order_by(SampleCollection.created_at, SampleCollection.id)
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            )
        )
        .scalars()
        .all()
    )
    return [_view(row) for row in rows], int(total)


async def disposal_page(
    db: AsyncSession,
    laboratory_id: UUID,
    page: int,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[list[DisposalView], int]:
    """A stable page of the immutable disposal history of one laboratory.

    The period filter applies to ``disposed_on`` only — it never touches the
    balances read model (API-06: «фильтр не влияет на balance»). The view
    fields come from the stored disposal rows (never from event payloads)."""
    filters: list[object] = [SampleDisposal.laboratory_id == laboratory_id]
    if date_from is not None:
        filters.append(SampleDisposal.disposed_on >= date_from)
    if date_to is not None:
        filters.append(SampleDisposal.disposed_on <= date_to)
    base = select(SampleDisposal).where(*filters)  # type: ignore[arg-type]
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                base.order_by(SampleDisposal.recorded_at.desc(), SampleDisposal.id)
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            )
        )
        .scalars()
        .all()
    )
    return [disposal_view(row) for row in rows], int(total)
