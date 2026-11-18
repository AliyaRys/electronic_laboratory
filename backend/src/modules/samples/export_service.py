"""Sample accounting export service (DR49 §7): one consistent read snapshot.

The service opens a short REPEATABLE READ, read-only transaction and loads
the laboratory, the current balances and the FULL disposal history (no page,
no offset — the screen pagination never limits the file) from one snapshot,
so the numbers can never contradict each other. The projection resolves the
product names and the actor ФИО with joins the same way the screen read
model does (no N+1) and keeps masses as exact ``Decimal`` values.
"""

from __future__ import annotations

import re
from datetime import UTC, date
from decimal import Decimal
from typing import cast
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.src.core.clock import utcnow
from backend.src.core.problems import ProblemError, validation_error
from backend.src.modules.identity.models import Laboratory, User
from backend.src.modules.samples.export_schemas import (
    BalanceRow,
    DisposalRow,
    SampleAccountingDocumentView,
)
from backend.src.modules.samples.models import SampleCollection, SampleDisposal

__all__ = ["build_sample_accounting_document", "export_filename", "format_day", "format_mass"]

_MISSING_NAME = "Данные не найдены"

# DR45 §4: the frozen product name of a collection snapshot.
_PRODUCT_NAME = SampleCollection.classification_snapshot["product"]["name"].astext


def format_day(value: date) -> str:
    return value.strftime("%d.%m.%Y")


def format_mass(value: Decimal) -> str:
    """A Russian decimal mass: comma separator, no trailing zeros."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _plain_filename(part: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", part).strip().strip(".")
    return cleaned


def export_filename(kind: str, laboratory_name: str, date_from: date | None, date_to: date | None) -> str:
    """``Учёт_проб_<лаборатория>_<from-or-all>_<to-or-all>.<ext>`` (DR49 §7.3)."""
    safe_lab = _plain_filename(laboratory_name)
    left = _plain_filename(format_day(date_from) if date_from is not None else "все")
    right = _plain_filename(format_day(date_to) if date_to is not None else "все")
    parts = ["Учёт_проб", *(part for part in (safe_lab, left, right) if part)]
    base = _plain_filename("_".join(parts))
    return f"{base or 'Учёт_проб'}.{kind}"


def _validate_range(date_from: date | None, date_to: date | None) -> None:
    from backend.src.core.problems import ProblemItem

    if date_from is not None and date_to is not None and date_from > date_to:
        raise validation_error(
            [
                ProblemItem(
                    path="date_from",
                    field_id="PERIOD",
                    message="Дата начала не может быть позже даты окончания.",
                )
            ]
        )


async def build_sample_accounting_document(
    db: AsyncSession,
    laboratory_id: UUID,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> SampleAccountingDocumentView:
    """The projection of the export document from one REPEATABLE READ snapshot."""
    _validate_range(date_from, date_to)
    bind = db.bind
    if not isinstance(bind, AsyncEngine):
        raise RuntimeError("Sample accounting export requires an AsyncEngine-bound session.")
    async with bind.connect() as connection:
        connection = await connection.execution_options(isolation_level="REPEATABLE READ")
        async with AsyncSession(bind=connection, expire_on_commit=False) as snapshot_db, snapshot_db.begin():
            await snapshot_db.execute(text("SET TRANSACTION READ ONLY"))
            return await _load_document(snapshot_db, laboratory_id, date_from=date_from, date_to=date_to)


async def _load_document(
    db: AsyncSession,
    laboratory_id: UUID,
    *,
    date_from: date | None,
    date_to: date | None,
) -> SampleAccountingDocumentView:
    lab = (
        await db.execute(select(Laboratory).where(Laboratory.id == laboratory_id))
    ).scalar_one_or_none()
    if lab is None:
        raise ProblemError(status=404, code="NOT_FOUND", title="Not found", detail="Лаборатория не найдена.")

    generated_at = utcnow()

    balance_rows = (
        (
            await db.execute(
                select(
                    func.min(_PRODUCT_NAME).label("product_name"),
                    func.sum(SampleCollection.mass_kg).label("mass"),
                )
                .where(SampleCollection.laboratory_id == laboratory_id, SampleCollection.disposal_id.is_(None))
                .group_by(SampleCollection.product_species_id)
                .order_by(func.min(func.lower(_PRODUCT_NAME)), SampleCollection.product_species_id)
            )
        )
        .all()
    )
    balances = [
        BalanceRow(product_name=row.product_name or _MISSING_NAME, mass_kg=cast(Decimal, row.mass))
        for row in balance_rows
        if row.mass is not None
    ]

    filters: list[object] = [SampleDisposal.laboratory_id == laboratory_id]
    if date_from is not None:
        filters.append(SampleDisposal.disposed_on >= date_from)
    if date_to is not None:
        filters.append(SampleDisposal.disposed_on <= date_to)
    # FULL history: no page, no offset, no PAGE_SIZE — the file is never
    # limited by the screen pagination (DR49 §7.1).
    disposal_rows = (
        await db.execute(
            select(SampleDisposal, func.min(_PRODUCT_NAME).label("product_name"), User.full_name)
            .outerjoin(SampleCollection, SampleCollection.disposal_id == SampleDisposal.id)
            .outerjoin(User, User.id == SampleDisposal.actor_id)
            .where(*filters)  # type: ignore[arg-type]
            .group_by(SampleDisposal.id, User.full_name)
            .order_by(SampleDisposal.recorded_at.desc(), SampleDisposal.id)
        )
    ).all()
    rows = [(disposal, product_name, full_name) for (disposal, product_name, full_name) in disposal_rows]
    disposals = [        DisposalRow(
            disposed_on=disposal.disposed_on,
            product_name=product_name or _MISSING_NAME,
            mass_kg=disposal.mass_kg,
            external_vsd_number=disposal.external_vsd_number,
            actor_name=full_name or _MISSING_NAME,
        )
        for disposal, product_name, full_name in rows
    ]

    return SampleAccountingDocumentView(
        laboratory_name=lab.name,
        generated_at=generated_at.astimezone(UTC),
        date_from=date_from,
        date_to=date_to,
        balances=balances,
        disposals=disposals,
    )
