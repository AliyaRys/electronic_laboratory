"""The atomic full-disposal command (API-06, FT-SMP-06/07, O-01/O-07).

``dispose_samples`` consumes the **whole** actual balance of one
laboratory/species basket in a single transaction: there is no partial
disposal, no reverse disposal and no 30/40-threshold automation — the user
chooses the species, the date and the outgoing eVSD number, and the weight is
always the server-computed sum of every still-active collection (the readonly
``expected_mass_kg`` of the dialog only guards a stale confirmation).

Order of work (SPEC-04): lock the basket row → check the ``If-Match`` basket
revision → lock **all** active collections by UUID in a stable order → sum the
mass server-side (never trust the client) → claim the idempotency record →
verify the shown mass/date/number → write the disposal, attach every locked
collection, bump the basket revision and record the technical event atomically.
The command never commits: the HTTP coordinator owns the transaction, so a
failure rolls the whole disposal back.

Competition: a concurrent collection selection (or a second disposal) either
bumps the basket revision or blocks on the basket row lock, so a dialog opened
before the change loses with 409 ``REVISION_CONFLICT`` and changes nothing.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import moscow_date, utcnow
from backend.src.core.commands import IdempotencyRecorder, UnitOfWork, canonical_request_hash, ensure_revision
from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError, ProblemItem, validation_error
from backend.src.modules.identity.models import TechnicalEvent
from backend.src.modules.samples.models import SampleBasket, SampleCollection, SampleDisposal
from backend.src.modules.samples.schemas import DisposalView, DisposalWrite

__all__ = ["dispose_samples", "load_disposal_view", "disposal_view"]


def _plain_decimal(value: Decimal) -> str:
    """A plain decimal string without the asyncpg numeric scale (``12.600000`` → ``12.6``)."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _basket_context_id(laboratory_id: uuid.UUID, product_species_id: uuid.UUID) -> uuid.UUID:
    """A stable idempotency context for the composite-keyed basket."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"sample-basket:{laboratory_id}:{product_species_id}")


def _nothing_to_dispose() -> ProblemError:
    return validation_error(
        [
            ProblemItem(
                path="productSpeciesId", message="У вида продукции нет положительного остатка: утилизировать нечего."
            )
        ]
    )


def _stale_shown_mass(actual: Decimal) -> ProblemError:
    """409: the balance changed after the dialog was opened (FT-SMP-07)."""
    return ProblemError(
        status=409,
        code="REVISION_CONFLICT",
        title="Revision conflict",
        detail=(
            f"Остаток изменился после открытия диалога: актуальный вес {_plain_decimal(actual)} кг. "
            "Обновите данные и подтвердите утилизацию заново."
        ),
    )


def _disposal_date_problem(detail: str) -> ProblemError:
    return validation_error([ProblemItem(path="disposedOn", message=detail)])


def _validate_disposed_on(disposed_on: date, collected_ons: list[date], today: date) -> None:
    """R-06 + the field catalog: a physical event is never in the future and
    the disposal never precedes the collections it consumes."""
    if disposed_on > today:
        raise _disposal_date_problem("Дата утилизации не может быть в будущем.")
    if collected_ons and disposed_on < max(collected_ons):
        raise _disposal_date_problem("Дата утилизации не может предшествовать включённым отборам.")


def disposal_view(row: SampleDisposal) -> DisposalView:
    """The API-06 ``DisposalView`` of one stored disposal row."""
    return DisposalView(
        id=str(row.id),
        laboratory_id=str(row.laboratory_id),
        product_species_id=str(row.product_species_id),
        disposed_on=row.disposed_on,
        mass_kg=_plain_decimal(row.mass_kg),
        external_vsd_number=row.external_vsd_number,
        actor_id=str(row.actor_id),
        recorded_at=row.recorded_at,
    )


async def load_disposal_view(db: AsyncSession, disposal_id: uuid.UUID) -> DisposalView:
    """The stored disposal fact (the idempotent replay answer)."""
    row = (await db.execute(select(SampleDisposal).where(SampleDisposal.id == disposal_id))).scalar_one_or_none()
    if row is None:
        raise ProblemError(status=404, code="NOT_FOUND", title="Not Found", detail="Утилизация не найдена.")
    return disposal_view(row)


async def dispose_samples(
    ctx: CommandContext,
    payload: DisposalWrite,
    *,
    uow: UnitOfWork | AsyncSession,
) -> DisposalView:
    """Dispose the whole current balance of one laboratory/species basket.

    The stored mass is computed by the server from every locked active
    collection; the shown ``expected_mass_kg`` is only the confirmation guard.
    The command writes disposal + attachments + basket revision + idempotency
    record + technical event in one transaction and never commits.
    """
    db = uow.session if isinstance(uow, UnitOfWork) else uow
    work = uow if isinstance(uow, UnitOfWork) else UnitOfWork(db)

    # 1. The basket row is the serialization point of the laboratory/species.
    basket = (
        await db.execute(
            select(SampleBasket)
            .where(
                SampleBasket.laboratory_id == payload.laboratory_id,
                SampleBasket.product_species_id == payload.product_species_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if basket is None:
        raise _nothing_to_dispose()
    today = moscow_date(utcnow())

    # 2. The idempotency claim comes before the revision check: a committed
    #    command replayed with the same key (e.g. a client timeout after the
    #    commit) answers the saved disposal without re-running any guard and
    #    never records a second event. A first-time request falls through to
    #    the checks below; a failing one rolls its claim record back.
    recorder = IdempotencyRecorder()
    request_hash = canonical_request_hash(payload.model_dump(mode="json", by_alias=True), ctx.expected_revision)
    record = await recorder.claim(
        work,
        actor_id=ctx.actor_id,
        action="sample:dispose",
        context_id=_basket_context_id(payload.laboratory_id, payload.product_species_id),
        key=ctx.idempotency_key,
        request_hash=request_hash,
    )
    if record.status == "SUCCESS":
        if record.result_id is None:  # pragma: no cover - complete() always sets it
            raise ProblemError(
                status=409,
                code="IDEMPOTENCY_MISMATCH",
                title="Idempotency mismatch",
                detail="Команда не завершилась сохранённым результатом.",
            )
        return await load_disposal_view(db, record.result_id)

    # 3. If-Match of the basket revision (the dialog was opened at this rev).
    ensure_revision(ctx.expected_revision, int(basket.rev))

    # 4. Lock ALL active collections of the species in one stable order, then
    #    sum the actual mass server-side — the client value is never trusted.
    collections = (
        (
            await db.execute(
                select(SampleCollection)
                .where(
                    SampleCollection.laboratory_id == payload.laboratory_id,
                    SampleCollection.product_species_id == payload.product_species_id,
                    SampleCollection.disposal_id.is_(None),
                )
                .order_by(SampleCollection.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    mass = sum((item.mass_kg for item in collections), Decimal("0"))

    # 5. The readonly mass guard: a stale dialog loses (FT-SMP-07).
    if Decimal(payload.expected_mass_kg) != mass:
        raise _stale_shown_mass(mass)
    if mass <= 0:
        raise _nothing_to_dispose()

    # 6/7. The user-entered date and outgoing eVSD number (a manually entered
    # fact, never an API-verified confirmation).
    _validate_disposed_on(payload.disposed_on, [item.collected_on for item in collections], today)
    number = payload.external_vsd_number.strip()
    if not number:
        raise validation_error(
            [ProblemItem(path="externalVsdNumber", message="Номер исходящего ВСД обязателен и не может быть пустым.")]
        )

    # 8. One atomic write: disposal + attachments + revision + event + record.
    row = SampleDisposal(
        laboratory_id=payload.laboratory_id,
        product_species_id=payload.product_species_id,
        disposed_on=payload.disposed_on,
        mass_kg=mass,
        external_vsd_number=number,
        actor_id=ctx.actor_id,
    )
    db.add(row)
    await db.flush()
    for item in collections:
        item.disposal_id = row.id
    new_revision = int(basket.rev) + 1
    basket.rev = new_revision
    db.add(
        TechnicalEvent(
            actor_id=ctx.actor_id,
            object_uuid=row.id,
            action="sample:dispose",
            result=_plain_decimal(mass),
            trace_id=uuid.uuid4().hex,
            revision=new_revision,
        )
    )
    await db.flush()
    await recorder.complete(work, record, row.id)
    return disposal_view(row)
