"""Sample ledger read queries (API-06): available facts and the live balance.

The balance is never materialized (DATA-03): it is the SUM of collections of
the party with ``disposal_id IS NULL``, computed inside the caller's
transaction so a concurrent selection/disposal is always reflected.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.samples.models import SampleCollection
from backend.src.modules.samples.schemas import CollectionView

__all__ = ["list_available_collections", "active_party_mass"]


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
