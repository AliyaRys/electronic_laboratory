"""``apply_sample`` (DATA-06): the internal contract of physical selections.

This module holds the write side of the sample ledger. It has **no** public
HTTP endpoint and never commits: ``apply_sample`` runs inside the
coordinator's transaction (E01 calls it when a card is saved in waiting or
completed state), and a coordinator rollback leaves neither a collection nor a
balance change. The balance itself is a query-time SUM of collections with
``disposal_id IS NULL`` (DATA-03) — there is no materialized balance.

Semantics (FT-SMP-01..04):

- ``NEW`` registers one new physical fact with its own snapshot/author/date;
  it never deletes or overwrites earlier collections;
- ``REUSE`` links an existing not-disposed fact of the same party without any
  weight change and without touching its date or revision;
- ``EDIT`` corrects the same not-disposed fact: the balance changes by the
  difference, and the collection revision moves under If-Match;
- a disposed fact is immutable: both REUSE and EDIT are rejected with 409
  ``SAMPLE_DISPOSED``.

Concurrency: the party row, the collection row and the laboratory/species
basket row are locked with ``FOR UPDATE`` before any write, so concurrent
writers serialize (FT-SMP-07 preparation).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, MetaData, Table, delete, select
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import moscow_date, utcnow
from backend.src.core.commands import ensure_revision
from backend.src.core.problems import ProblemError, ProblemItem, not_found, validation_error
from backend.src.modules.arrivals.models import Party
from backend.src.modules.samples.models import SampleBasket, SampleCollection
from backend.src.modules.samples.schemas import NewSample, ReuseSample, SampleSelection

__all__ = ["apply_sample", "detach_examination_samples"]

_EXAMINATION_SAMPLES = Table(
    "examination_samples",
    MetaData(),
    Column("examination_id", PgUUID(as_uuid=True)),
    Column("collection_id", PgUUID(as_uuid=True)),
)

_MAX_MASS_SCALE = 6  # Numeric(20,6): weights carry at most six decimal places


def _mass_problem(detail: str) -> ProblemError:
    return validation_error([ProblemItem(path="sample.massKg", message=detail)])


def _date_problem() -> ProblemError:
    return validation_error([ProblemItem(path="sample.collectedOn", message="Дата отбора не может быть в будущем.")])


def _validate_mass(mass: Decimal) -> None:
    if mass <= 0:
        raise _mass_problem("Вес пробы должен быть положительным числом.")
    exponent = mass.as_tuple().exponent
    scale = -exponent if isinstance(exponent, int) and exponent < 0 else 0
    if scale > _MAX_MASS_SCALE:
        raise _mass_problem("Вес пробы допускает не более шести знаков после запятой; округление недопустимо.")


def _validate_collected_on(collected_on: date) -> None:
    if collected_on > moscow_date(utcnow()):
        raise _date_problem()


def _species_of(party: Party) -> UUID:
    product = party.classification_snapshot.get("product")
    if not isinstance(product, dict) or product.get("id") is None:
        raise ProblemError(
            status=422,
            code="CONFIGURATION_MISSING",
            title="Configuration missing",
            detail="Снимок классификации партии не содержит вида продукции: отбор невозможен.",
        )
    return UUID(str(product["id"]))


async def _get_or_create_basket(uow: AsyncSession, laboratory_id: UUID, product_species_id: UUID) -> SampleBasket:
    """The laboratory/species basket under lock — the serialization point.

    A lost creation race against the UNIQUE primary key is retried with a
    fresh locked read inside a savepoint, never surfacing as a 500.
    """
    basket = (
        await uow.execute(
            select(SampleBasket)
            .where(
                SampleBasket.laboratory_id == laboratory_id,
                SampleBasket.product_species_id == product_species_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if basket is not None:
        return basket
    basket = SampleBasket(laboratory_id=laboratory_id, product_species_id=product_species_id, rev=1)
    uow.add(basket)
    try:
        async with uow.begin_nested():
            await uow.flush()
    except IntegrityError:  # pragma: no cover - exercised only by true races
        basket = (
            await uow.execute(
                select(SampleBasket)
                .where(
                    SampleBasket.laboratory_id == laboratory_id,
                    SampleBasket.product_species_id == product_species_id,
                )
                .with_for_update()
            )
        ).scalar_one()
    return basket


async def _locked_collection(uow: AsyncSession, collection_id: UUID, party_id: UUID) -> SampleCollection:
    """The collection of THIS party under lock; anything else is a foreign 404."""
    collection = (
        await uow.execute(select(SampleCollection).where(SampleCollection.id == collection_id).with_for_update())
    ).scalar_one_or_none()
    if collection is None or collection.party_id != party_id:
        raise not_found("Отбор не найден.")
    return collection


def sample_disposed() -> ProblemError:
    """409 SAMPLE_DISPOSED: a disposed fact is never rewritten or re-linked."""
    return ProblemError(
        status=409,
        code="SAMPLE_DISPOSED",
        title="Sample disposed",
        detail=(
            "Отбор уже утилизирован: исправление и повторное использование "
            "недопустимы, для фактического отбора нужен новый отбор."
        ),
    )


def _ensure_not_disposed(collection: SampleCollection) -> None:
    if collection.disposal_id is not None:
        raise sample_disposed()


async def apply_sample(
    uow: AsyncSession,
    actor_id: UUID,
    party_id: UUID,
    examination_id: UUID,
    selection: SampleSelection,
) -> SampleCollection:
    """Apply one sample selection of a card inside the caller's transaction.

    ``examination_id`` is the future owner of the ``examination_samples`` link
    (E01): this contract neither creates the link nor touches the
    examination, and it never commits — the caller owns the transaction.
    Returns the collection fact (created, reused or corrected).
    """
    del examination_id  # the link itself is written by E01 (examination_samples)

    party = (await uow.execute(select(Party).where(Party.id == party_id).with_for_update())).scalar_one_or_none()
    if party is None:
        raise not_found("Партия не найдена.")
    species = _species_of(party)
    basket = await _get_or_create_basket(uow, party.laboratory_id, species)

    collection: SampleCollection
    if isinstance(selection, NewSample):
        _validate_collected_on(selection.collected_on)
        mass = Decimal(selection.mass_kg)
        _validate_mass(mass)
        collection = SampleCollection(
            party_id=party.id,
            laboratory_id=party.laboratory_id,
            product_species_id=species,
            classification_snapshot=dict(party.classification_snapshot),
            collected_on=selection.collected_on,
            mass_kg=mass,
            collected_by=actor_id,
        )
        uow.add(collection)
        basket.rev = (basket.rev or 1) + 1
    elif isinstance(selection, ReuseSample):
        collection = await _locked_collection(uow, selection.collection_id, party.id)
        _ensure_not_disposed(collection)
        # REUSE adds no weight and never replaces the fact's own date.
    else:  # EditSample
        collection = await _locked_collection(uow, selection.collection_id, party.id)
        _ensure_not_disposed(collection)
        ensure_revision(selection.expected_revision, collection.rev)
        _validate_collected_on(selection.collected_on)
        mass = Decimal(selection.mass_kg)
        _validate_mass(mass)
        collection.collected_on = selection.collected_on
        collection.mass_kg = mass
        collection.rev = (collection.rev or 1) + 1
        basket.rev = (basket.rev or 1) + 1

    await uow.flush()
    return collection


async def detach_examination_samples(uow: AsyncSession, examination_id: UUID) -> int:
    """Remove the examination→collection links of a deleted ВСЭ (E03 hook).

    FT-SMP-02: deleting a ВСЭ detaches only the link rows — never the
    collections, which stay in the balance or in the disposal history. The
    E01 table exists now; this hook deliberately deletes only links.
    """
    result = await uow.execute(
        delete(_EXAMINATION_SAMPLES).where(_EXAMINATION_SAMPLES.c.examination_id == examination_id)
    )
    return int(result.rowcount or 0)  # type: ignore[attr-defined]
