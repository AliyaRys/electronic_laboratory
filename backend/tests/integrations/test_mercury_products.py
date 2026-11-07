"""The owner-supplied Mercury level-2 dictionary is available locally."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2, VetisContour
from backend.src.modules.integrations.vetis.queries import require_product_lvl2


async def test_pilot_snapshot_contains_all_28_products(db_session: AsyncSession) -> None:
    count = await db_session.scalar(
        select(func.count()).select_from(MercuryProductGuidLvl2).where(MercuryProductGuidLvl2.contour == "PILOT")
    )
    assert count == 28


async def test_names_are_resolved_by_stable_guid(db_session: AsyncSession) -> None:
    pork = await require_product_lvl2(db_session, VetisContour.PILOT, uuid.UUID("57a674fd-ca2b-c523-6853-72d27b4ae32c"))
    assert pork.name == "свинина"
    assert pork.current_uuid == uuid.UUID("b48f2d1f-d1d6-67cb-db17-0d9b39ae84cb")


async def test_trichinelloscopy_is_required_for_exactly_four_owner_approved_products(
    db_session: AsyncSession,
) -> None:
    products = (
        await db_session.scalars(
            select(MercuryProductGuidLvl2).where(MercuryProductGuidLvl2.requires_trichinelloscopy.is_(True))
        )
    ).all()
    assert {product.name for product in products} == {
        "свинина",
        "конина",
        "субпродукты и жиры свиные",
        "субпродукты и жиры конские",
    }


async def test_unknown_guid_fails_without_showing_raw_identifier(db_session: AsyncSession) -> None:
    with pytest.raises(ProblemError) as raised:
        await require_product_lvl2(db_session, VetisContour.PILOT, uuid.UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"))

    assert raised.value.code == "MERCURY_PRODUCT_DICTIONARY_MISS"
    assert "локального названия" in raised.value.detail
