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
    "product_name_of",
]

PAGE_SIZE = 20

# DR45 §4: the frozen product name of a collection snapshot.
_PRODUCT_NAME = SampleCollection.classification_snapshot["product"]["name"].astext


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


def _view(
    collection: SampleCollection,
    *,
    product_name: str | None = None,
    evsd_uuid: str | None = None,
    collected_by_name: str | None = None,
) -> CollectionView:
    return CollectionView(
        id=str(collection.id),
        party_id=str(collection.party_id),
        laboratory_id=str(collection.laboratory_id),
        product_species_id=str(collection.product_species_id),
        classification_snapshot=dict(collection.classification_snapshot),
        collected_on=collection.collected_on,
        mass_kg=str(collection.mass_kg),
        collected_by=str(collection.collected_by),
        # DR45 §4: the human-readable projection (defaults from the snapshot).
        product_name=product_name if product_name is not None else _plain_name(collection.classification_snapshot),
        evsd_uuid=evsd_uuid if evsd_uuid is not None else "",
        collected_by_name=collected_by_name,
        created_at=collection.created_at,
        disposal_id=str(collection.disposal_id) if collection.disposal_id is not None else None,
        revision=int(collection.rev or 1),
    )


def _plain_name(snapshot: object) -> str | None:
    product = snapshot.get("product") if isinstance(snapshot, dict) else None
    name = product.get("name") if isinstance(product, dict) else None
    return str(name) if name else None


def product_name_of() -> object:
    """The SQL expression of the frozen product name (DR45 §4)."""
    return _PRODUCT_NAME


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
                # DR45 §4: one normalized display name of the active group —
                # the lexicographic minimum never depends on the row order.
                func.min(_PRODUCT_NAME).label("product_name"),
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
            product_name=row.product_name,
        )
        for row in rows
    ]


async def collection_page(db: AsyncSession, laboratory_id: UUID, page: int) -> tuple[list[CollectionView], int]:
    """A stable page of the available (not disposed) facts of one laboratory.

    DR45 §4: the eVSD UUID (party → document) and the collector's ФИО are
    resolved by the same joined query — never per row (no N+1)."""
    from backend.src.modules.arrivals.models import IncomingDocument, Party
    from backend.src.modules.identity.models import User

    base = (
        select(
            SampleCollection,
            IncomingDocument.evsd_uuid,
            User.full_name,
        )
        .join(Party, Party.id == SampleCollection.party_id)
        .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
        .outerjoin(User, User.id == SampleCollection.collected_by)
        .where(SampleCollection.laboratory_id == laboratory_id, SampleCollection.disposal_id.is_(None))
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
        .all()
    )
    return [
        _view(collection, evsd_uuid=str(evsd_uuid), collected_by_name=name)
        for collection, evsd_uuid, name in rows
    ], int(total)


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
    from backend.src.modules.identity.models import User

    base = (
        select(
            SampleDisposal,
            # DR45 §4: the display values ride with the page — the product
            # name from the consumed collections' snapshots and the actor
            # ФИО, resolved by the same query (no N+1).
            func.min(_PRODUCT_NAME).label("product_name"),
            User.full_name,
        )
        .outerjoin(SampleCollection, SampleCollection.disposal_id == SampleDisposal.id)
        .outerjoin(User, User.id == SampleDisposal.actor_id)
        .where(*filters)  # type: ignore[arg-type]
        .group_by(SampleDisposal.id, User.full_name)
    )  # type: ignore[arg-type]
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                base.order_by(func.max(SampleDisposal.recorded_at).desc(), SampleDisposal.id)
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            )
        )
        .all()
    )
    views = []
    for row, product_name, actor_name in rows:
        view = disposal_view(row)
        views.append(
            DisposalView(
                id=view.id,
                laboratory_id=view.laboratory_id,
                product_species_id=view.product_species_id,
                disposed_on=view.disposed_on,
                mass_kg=view.mass_kg,
                external_vsd_number=view.external_vsd_number,
                actor_id=view.actor_id,
                recorded_at=view.recorded_at,
                product_name=product_name,
                actor_name=actor_name,
            )
        )
    return views, int(total)
