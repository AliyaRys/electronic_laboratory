"""Read contract for the local Mercury second-level product dictionary."""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2, VetisContour

__all__ = ["find_product_lvl2", "require_product_lvl2"]


async def find_product_lvl2(
    db: AsyncSession, contour: VetisContour | str, guid: uuid.UUID
) -> MercuryProductGuidLvl2 | None:
    """Return the locally mirrored product without making a VetIS request."""

    return cast(
        MercuryProductGuidLvl2 | None,
        await db.scalar(
            select(MercuryProductGuidLvl2).where(
                MercuryProductGuidLvl2.contour == str(contour),
                MercuryProductGuidLvl2.guid == guid,
            )
        ),
    )


async def require_product_lvl2(
    db: AsyncSession, contour: VetisContour | str, guid: uuid.UUID
) -> MercuryProductGuidLvl2:
    """Resolve a VSD product or fail safely instead of displaying its GUID."""

    product = await find_product_lvl2(db, contour, guid)
    if product is None:
        raise ProblemError(
            status=422,
            code="MERCURY_PRODUCT_DICTIONARY_MISS",
            title="Mercury product dictionary miss",
            detail=(
                "Для GUID продукции второго уровня нет локального названия. "
                "Обновите справочник Меркурия и повторите операцию."
            ),
        )
    return product
