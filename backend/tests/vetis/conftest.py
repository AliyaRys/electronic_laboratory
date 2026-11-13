"""Shared VetIS test fixtures (the laboratory/binding environment of ТЗ-10)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.modules.identity.models import Laboratory, Territory
from backend.src.modules.integrations.vetis.models import VetisBinding, VetisContour

ENTERPRISE = "00000000-0000-0000-0000-0000000000e1"
MEMBER = "00000000-0000-0000-0000-0000000000be"


@pytest.fixture
async def sync_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    """A laboratory with a registered VetIS binding and its own session factory."""
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(
        territory_id=territory.id, name="Агропромышленный парк", address="ул. Тестовая, 1", organization="ГБУ"
    )
    db_session.add(lab)
    await db_session.flush()
    binding = VetisBinding(
        laboratory_id=lab.id,
        contour=VetisContour.PILOT,
        business_member_id=MEMBER,
        enterprise_id=ENTERPRISE,
        initiator="fixture-read-initiator",
    )
    db_session.add(binding)
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        lab=lab,
        binding=binding,
        factory=async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )
