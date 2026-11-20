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
from backend.src.modules.catalog_pricing.mandatory import indicator_by_code
from backend.src.modules.examinations.schemas import ExaminationWrite, ResearchWrite
from backend.src.modules.examinations.validation import COOKING, MICROSCOPY, PH, validate_researches
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


# --- ТЗ DR54 Task 6: the cooking test without «Иное (указать)» ----------------------


def test_cooking_registry_has_exactly_five_variants() -> None:
    """ТЗ DR54 Task 6 Шаг 1: the canonical registry carries exactly the five
    subject-defined variants — «Иное (указать)» is gone."""
    definition = indicator_by_code("VSE-F26")
    assert definition.options == (
        "Бульон прозрачный, аромат специфический",
        "Бульон мутный",
        "Бульон с хлопьями",
        "Бульон с осадком",
        "Нехарактерный / неприятный запах",
    )


@pytest.mark.parametrize(
    "value",
    [
        "Бульон прозрачный, аромат специфический",
        "Бульон мутный",
        "Бульон с хлопьями",
        "Бульон с осадком",
        "Нехарактерный / неприятный запах",
    ],
)
async def test_cooking_five_variants_pass(db_session: AsyncSession, result_env: SimpleNamespace, value: str) -> None:
    """ТЗ DR54 Task 6: each of the five subject-defined variants is accepted
    as a NEW cooking result."""
    party = await party_with_confirmation(db_session, result_env.lab.id, BEEF)
    base = payload(number=f"COOK-{value[:8]}", trich=False).model_dump(mode="json", by_alias=True)
    base["researches"].append({"indicatorId": str(COOKING), "kind": "ENUM", "value": value})
    parsed = ExaminationWrite.model_validate(base)
    await validate_researches(db_session, party, parsed)


@pytest.mark.parametrize(
    "value",
    ["Иное", "Вариант, которого нет в справочнике"],
)
async def test_cooking_legacy_other_and_unknown_fail(
    db_session: AsyncSession, result_env: SimpleNamespace, value: str
) -> None:
    """ТЗ DR54 Task 6: «Иное (указать)» removed — a NEW result with the legacy
    variant (or any other non-registry value) is a typed VSE-F26 error."""
    party = await party_with_confirmation(db_session, result_env.lab.id, BEEF)
    base = payload(trich=False).model_dump(mode="json", by_alias=True)
    legacy = {"indicatorId": str(COOKING), "kind": "ENUM", "value": value, "otherText": "Старая формулировка"}
    base["researches"].append(legacy)
    parsed = ExaminationWrite.model_validate(base)
    with pytest.raises(ProblemError) as raised:
        await validate_researches(db_session, party, parsed)
    items = raised.value.errors
    assert any(
        item.field_id == "VSE-F26"
        and str(COOKING) in str(item.path)
        and "Допустим один из пяти вариантов пробы варки" in item.message
        for item in items
    )


@pytest.mark.parametrize("value", ["0", "14"])
async def test_ph_inclusive_boundaries_pass(db_session: AsyncSession, result_env: SimpleNamespace, value: str) -> None:
    party = await party_with_confirmation(db_session, result_env.lab.id, BEEF)
    base = payload(number=f"PH-{value}", trich=False).model_dump(mode="json", by_alias=True)
    base["researches"].append({"indicatorId": str(PH), "kind": "DECIMAL", "value": value})
    parsed = ExaminationWrite.model_validate(base)
    await validate_researches(db_session, party, parsed)


async def test_ph_over_14_is_not_a_blocking_error(db_session: AsyncSession, result_env: SimpleNamespace) -> None:
    """ТЗ DR52 §2: pH вне настроенной нормы (14,5) — это оценка DEVIATION
    серверным прайсинг-движком, а не VALIDATION_ERROR; значение сохраняется."""
    party = await party_with_confirmation(db_session, result_env.lab.id, BEEF)
    base = payload(trich=False).model_dump(mode="json", by_alias=True)
    base["researches"].append({"indicatorId": str(PH), "kind": "DECIMAL", "value": "14.5"})
    parsed = ExaminationWrite.model_validate(base)
    await validate_researches(db_session, party, parsed)


async def test_ph_invalid_shape_still_fails(db_session: AsyncSession, result_env: SimpleNamespace) -> None:
    """ТЗ DR52 §2: нечисловое/экспоненциальное значение остаётся структурной
    ошибкой ввода; decimal-грамматика не ослаблена."""
    from pydantic import ValidationError as PydValidationError

    base = payload(trich=False).model_dump(mode="json", by_alias=True)
    base["researches"].append({"indicatorId": str(PH), "kind": "DECIMAL", "value": "abc"})
    with pytest.raises(PydValidationError):
        ExaminationWrite.model_validate(base)


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
