"""Read helpers for API-05 examination views."""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError, not_found
from backend.src.modules.examinations.models import Examination, ExaminationSample, ExaminationTombstone
from backend.src.modules.examinations.schemas import ExaminationView

__all__ = ["get_examination", "get_tombstone", "examination_deleted", "build_view", "get_view"]


def examination_deleted() -> ProblemError:
    return ProblemError(
        status=409,
        code="EXAMINATION_DELETED",
        title="Examination deleted",
        detail="Карточка ВСЭ удалена и не может быть изменена или восстановлена.",
    )


async def get_tombstone(db: AsyncSession, examination_id: uuid.UUID) -> ExaminationTombstone | None:
    return (
        await db.execute(select(ExaminationTombstone).where(ExaminationTombstone.examination_id == examination_id))
    ).scalar_one_or_none()


async def get_examination(
    db: AsyncSession,
    examination_id: uuid.UUID,
    *,
    lock: bool = False,
    deleted_conflict: bool = False,
) -> Examination:
    statement = select(Examination).where(Examination.id == examination_id)
    if lock:
        statement = statement.with_for_update()
    row = (await db.execute(statement.execution_options(populate_existing=True))).scalar_one_or_none()
    if row is None:
        if deleted_conflict and await get_tombstone(db, examination_id) is not None:
            raise examination_deleted()
        raise not_found("ВСЭ не найдена.")
    return row


async def current_collection_id(db: AsyncSession, examination_id: uuid.UUID) -> uuid.UUID:
    """The collection the card currently points to (one link per card)."""
    return (
        await db.execute(
            select(ExaminationSample.collection_id).where(ExaminationSample.examination_id == examination_id)
        )
    ).scalar_one()


async def build_view(db: AsyncSession, row: Examination) -> ExaminationView:
    collection_id = await current_collection_id(db, row.id)
    findings = row.findings_snapshot
    return ExaminationView(
        id=str(row.id),
        party_id=str(row.party_id),
        laboratory_id=str(row.laboratory_id),
        number=row.number,
        stamp=row.stamp,
        status=row.status,
        sent_to_lab=row.sent_to_lab,
        researches=list(row.research_snapshot),
        invasive_findings=list(cast(list[object], findings.get("invasive", []))),
        noncontagious_findings=list(cast(list[object], findings.get("noncontagious", []))),
        pricing=dict(row.pricing_snapshot),
        sample_collection_id=str(collection_id),
        outcome=row.outcome,
        direction=row.direction,
        reason=row.reason,
        created_by=str(row.created_by),
        created_at=row.created_at,
        first_completed_at=row.first_completed_at,
        revision=row.rev,
    )


async def get_view(db: AsyncSession, examination_id: uuid.UUID) -> ExaminationView:
    return await build_view(db, await get_examination(db, examination_id))
