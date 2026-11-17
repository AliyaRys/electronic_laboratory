"""E01 strict result shapes and boundary values."""

from __future__ import annotations

import asyncio
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


def test_microscopy_is_nonnegative_decimal_and_invalid_numbers_fail() -> None:
    """ТЗ DR42 §5.1: VSE-F24 accepts 2 / 2.5 as decimal strings; the wire
    form carries a dot; negatives, NaN/Infinity, exponent forms, empty
    performed values and JSON floats are all rejected."""
    two_and_half = research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "2.5"})
    assert two_and_half.value == "2.5"
    zero = research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "0"})
    assert zero.value == "0"
    # 2,5 is normalised by the client; the wire form rejects the comma.
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "2,5"})
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "NaN"})
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "Infinity"})
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "2e1"})
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": ""})
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": 1.5})
    # The legacy INTEGER write kind no longer matches the FT field type.
    with pytest.raises(ValidationError):
        research_adapter.validate_python({"indicatorId": str(MICROSCOPY), "kind": "INTEGER", "value": 2})


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


def test_microscopy_negative_fails_medical_validation() -> None:
    """ТЗ DR42 §5.1: the FT bound (nonnegative) is enforced by the medical
    validation; the wire grammar only fixes the decimal shape."""
    write = ExaminationWrite.model_validate(
        {
            **payload(trich=False).model_dump(mode="json", by_alias=True),
            "researches": [
                *payload(trich=False).model_dump(mode="json", by_alias=True)["researches"],
                {"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "-1"},
            ],
        }
    )
    # classification_snapshot without a product never triggers the trichinelloscopy
    # lookup, so no session access happens.
    party = SimpleNamespace(classification_snapshot={}, incoming_document_id=None)
    with pytest.raises(ProblemError) as raised:
        asyncio.run(validate_researches(None, party, write))  # type: ignore[arg-type]
    assert any("неотрицательное" in item.message for item in raised.value.errors)


def test_microscopy_decimal_passes_medical_validation() -> None:
    write = ExaminationWrite.model_validate(
        {
            **payload(trich=False).model_dump(mode="json", by_alias=True),
            "researches": [
                *payload(trich=False).model_dump(mode="json", by_alias=True)["researches"],
                {"indicatorId": str(MICROSCOPY), "kind": "DECIMAL", "value": "2.5"},
            ],
        }
    )
    party = SimpleNamespace(classification_snapshot={}, incoming_document_id=None)
    asyncio.run(validate_researches(None, party, write))  # type: ignore[arg-type]
