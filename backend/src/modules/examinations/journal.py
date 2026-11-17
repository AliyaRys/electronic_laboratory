"""The scoped journal read model (ТЗ DR45 §2): ``GET /api/v1/examinations``.

The journal is its OWN server read model, never the arrivals result list:
the WAITING/COMPLETED filter selects ``Examination.status`` (not the
arrival's ``result``), and the page query resolves every display value with
joins in ONE statement — the eVSD UUID of the party, the consignor name from
the frozen source snapshot and the specialist ФИО (frozen at save time; a
legacy row without one resolves it once from the user). No UUID of a party,
user or product ever leaves the model raw.

Ordering: COMPLETED by ``first_completed_at``, WAITING by ``created_at``,
with ``id`` as the deterministic tie-breaker, ascending or descending.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.models import User

__all__ = ["ExaminationJournalItem", "JOURNAL_PAGE_SIZE", "journal_page"]

JOURNAL_PAGE_SIZE = 20


class ExaminationJournalItem(BaseModel):
    """One journal row: only the display values of the approved mockup."""

    model_config = ConfigDict(extra="forbid")

    examination_id: str
    party_id: str
    laboratory_id: str
    number: str
    stamp: str
    status: str
    created_at: datetime
    first_completed_at: datetime | None
    outcome: str | None
    specialist_id: str
    specialist_name: str | None
    evsd_uuid: str
    consignor_name: str | None


def _ref_name(entry: object) -> str | None:
    if not isinstance(entry, dict):
        return None
    name = entry.get("name")
    return str(name) if name else None


def _consignor_name(snapshot: object) -> str | None:
    payload = snapshot.get("vdDocument") if isinstance(snapshot, dict) else None
    consignor = payload.get("consignor") if isinstance(payload, dict) else None
    if not isinstance(consignor, dict):
        return None
    return _ref_name(consignor.get("enterprise")) or (str(consignor.get("name") or "") or None)


async def journal_page(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    *,
    status: Literal["WAITING", "COMPLETED"],
    q: str | None = None,
    outcome: Literal["FIT", "UNFIT"] | None = None,
    specialist_id: uuid.UUID | None = None,
    occurred_from: datetime | None = None,
    occurred_to: datetime | None = None,
    sort: Literal["asc", "desc"] = "desc",
    page: int = 1,
    page_size: int = JOURNAL_PAGE_SIZE,
) -> tuple[list[ExaminationJournalItem], int]:
    """One stable journal page of one laboratory; ``total`` matches the filter.

    COMPLETED cards are filtered by the ``occurred_*`` window on
    ``first_completed_at`` and ordered by it; WAITING cards use
    ``created_at``. The window is half-open ``[from; to)``.
    """
    from backend.src.modules.examinations.models import ExaminationStatus

    order_column = Examination.first_completed_at if status == "COMPLETED" else Examination.created_at
    primary = order_column.desc() if sort == "desc" else order_column.asc()
    filters: list[object] = [Examination.laboratory_id == laboratory_id, Examination.status == status]
    if outcome is not None:
        filters.append(Examination.outcome == outcome)
    if specialist_id is not None:
        # The displayed specialist (the frozen one or the pre-DR35 audit
        # fallback) is the filter target — never the raw created_by alone.
        filters.append(
            or_(Examination.specialist_id == specialist_id, Examination.created_by == specialist_id)
        )
    if occurred_from is not None:
        filters.append(order_column >= occurred_from)
    if occurred_to is not None:
        filters.append(order_column < occurred_to)
    if q is not None and q.strip():
        needle = f"%{q.strip().lower()}%"
        consignor = IncomingDocument.source_snapshot["vdDocument"]["consignor"]["enterprise"]["name"].astext
        filters.append(
            or_(
                func.lower(Examination.number).like(needle),
                func.lower(Examination.stamp).like(needle),
                func.lower(IncomingDocument.evsd_uuid.cast(String)).like(needle),
                func.lower(consignor).like(needle),
            )
        )
    base = (
        select(
            Examination,
            IncomingDocument.evsd_uuid,
            IncomingDocument.source_snapshot,
        )
        .join(Party, Party.id == Examination.party_id)
        .join(IncomingDocument, IncomingDocument.id == Party.incoming_document_id)
        .where(*filters)  # type: ignore[arg-type]
        .order_by(primary, Examination.id)
    )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (
        (
            await db.execute(
                base.add_columns(User.full_name)
                .outerjoin(
                    User,
                    User.id
                    == func.coalesce(Examination.specialist_id, Examination.created_by),
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .all()
    )
    items: list[ExaminationJournalItem] = []
    for examination, evsd_uuid, snapshot, specialist_frozen in rows:
        # DR35 §12.3: the displayed specialist is the saved specialist_id; a
        # pre-DR35 row keeps the audit actor as the displayed specialist.
        specialist_uuid = examination.specialist_id if examination.specialist_id is not None else examination.created_by
        name = examination.specialist_name
        if name is None:
            name = specialist_frozen
        items.append(
            ExaminationJournalItem(
                examination_id=str(examination.id),
                party_id=str(examination.party_id),
                laboratory_id=str(examination.laboratory_id),
                number=examination.number,
                stamp=examination.stamp,
                status=examination.status,
                created_at=examination.created_at,
                first_completed_at=examination.first_completed_at,
                outcome=examination.outcome,
                specialist_id=str(specialist_uuid),
                specialist_name=name,
                evsd_uuid=str(evsd_uuid),
                consignor_name=_consignor_name(snapshot),
            )
        )
    return items, int(total)
