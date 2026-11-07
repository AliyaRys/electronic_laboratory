"""E01 strict result shapes and boundary values."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
import pytest_asyncio
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.examinations.schemas import ExaminationWrite, ResearchWrite
from backend.src.modules.examinations.validation import MICROSCOPY, PH, validate_researches
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.tests.examinations.test_create import BEEF, party_with_confirmation, payload

research_adapter = TypeAdapter(ResearchWrite)


@pytest_asyncio.fixture
async def result_env(db_session: AsyncSession) -> SimpleNamespace:
    territory = Territory(name="Республика для результатов")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="ГБУ")
    actor = User(
        login="result-vet",
        full_name="Врач",
        email="result@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add_all([lab, actor])
    await db_session.commit()
    return SimpleNamespace(lab=lab, actor=actor)


def test_microscopy_zero_is_result_and_invalid_numbers_fail() -> None:
    zero = research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "INTEGER", "value": 0})
    assert zero.value == 0
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "INTEGER", "value": -1})
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "INTEGER", "value": 1.5})


def test_dosimetry_requires_both_decimal_readings() -> None:
    with pytest.raises(ValidationError):
        research_adapter.validate_python(
            {
                "indicatorId": str(uuid.uuid4()),
                "kind": "DOSIMETRY",
                "value": {"first": "0.10"},
            }
        )


def test_other_and_findings_are_complete_and_limited() -> None:
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(uuid.uuid4()), "kind": "ENUM", "value": "Иное"})
    base = payload(trich=False).model_dump(mode="json", by_alias=True)
    with pytest.raises(ValidationError):
        ExaminationWrite.model_validate({**base, "invasiveFindings": [{"disease": "Фасциолёз", "location": ""}]})
    with pytest.raises(ValidationError):
        ExaminationWrite.model_validate(
            {
                **base,
                "noncontagiousFindings": [{"disease": f"Болезнь {index}"} for index in range(11)],
            }
        )


@pytest.mark.parametrize("value", ["0", "14"])
async def test_ph_inclusive_boundaries_pass(db_session: AsyncSession, result_env: SimpleNamespace, value: str) -> None:
    party = await party_with_confirmation(db_session, result_env.lab.id, BEEF)
    base = payload(number=f"PH-{value}", trich=False).model_dump(mode="json", by_alias=True)
    base["researches"].append({"indicatorId": str(PH), "kind": "DECIMAL", "value": value})
    parsed = ExaminationWrite.model_validate(base)
    await validate_researches(db_session, party, parsed)


async def test_ph_over_14_fails_server_validation(db_session: AsyncSession, result_env: SimpleNamespace) -> None:
    party = await party_with_confirmation(db_session, result_env.lab.id, BEEF)
    base = payload(trich=False).model_dump(mode="json", by_alias=True)
    base["researches"].append({"indicatorId": str(PH), "kind": "DECIMAL", "value": "14.1"})
    parsed = ExaminationWrite.model_validate(base)
    with pytest.raises(ProblemError) as raised:
        await validate_researches(db_session, party, parsed)
    assert raised.value.code == "VALIDATION_ERROR"
