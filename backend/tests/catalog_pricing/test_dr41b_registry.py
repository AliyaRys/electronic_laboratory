"""ТЗ DR41-B §6: fixed/none/configurable registry and honest evaluation.

Named tests (§6.1–§6.4, §9.3):

- ``test_registry_modes_match_the_ft_rules`` — F18/F19/F22/F27/F28 are FIXED,
  F23 is NONE, F20/F21/F24/F25/F26/F29 are CONFIGURABLE;
- ``test_fixed_indicator_evaluates_without_method_rule`` — F18 MATCH →
  IN_NORM and MISMATCH → DEVIATION with NO active MethodRule at all;
- ``test_fixed_reaction_mappings`` — F27 NEGATIVE → IN_NORM / POSITIVE →
  DEVIATION, F28 the reverse;
- ``test_none_indicator_is_not_applicable`` — F23 performed gets
  NOT_APPLICABLE and is not blocked by the missing MethodRule;
- ``test_write_norm_for_fixed_and_none_is_refused`` — POST/PUT of a norm row
  for a FIXED/NONE indicator is an honest 422 in Russian;
- ``test_legacy_integer_norm_fractional_value_is_honest_unknown`` — a decimal
  value against a legacy INTEGER norm is UNKNOWN with a re-save hint, never a
  fabricated verdict;
- ``test_context_marks_evaluation_modes_and_missing_is_configurable_only`` —
  the methods context carries the evaluation mode and «missing» lists only the
  configurable indicators;
- ``test_readiness_fixed_indicators_do_not_require_method_rule``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import UnitOfWork
from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing import commands as _commands
from backend.src.modules.catalog_pricing import context as context_module
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing import queries as _queries
from backend.src.modules.catalog_pricing.schemas import (
    MethodRuleWrite,
    PricingSnapshot,
    QualitativeRule,
    ResearchValue,
)
from backend.src.modules.catalog_pricing.service import evaluate_and_price
from backend.tests.catalog_pricing.test_pricing import _rule, _seed, _tariff, _vse_request

ORGANOLEPTIC = _mandatory.ORGANOLEPTIC_INDICATOR_ID
IDENTIFICATION = _mandatory.IDENTIFICATION_INDICATOR_ID
TEMPERATURE = _mandatory.TEMPERATURE_INDICATOR_ID
LUMINESCENT = _mandatory.LUMINESCENT_INDICATOR_ID
BACTERIOSCOPY = _mandatory.BACTERIOSCOPY_INDICATOR_ID
MICROSCOPY = _mandatory.MICROSCOPY_INDICATOR_ID
COPPER = _mandatory.COPPER_INDICATOR_ID
PEROXIDASE = _mandatory.PEROXIDASE_INDICATOR_ID
TRICHINELLA = _mandatory.TRICHINELLA_INDICATOR_ID


# --- §6.1–§6.3: the canonical registry modes -----------------------------------------


def test_registry_modes_match_the_ft_rules() -> None:
    modes = {item.code: item.evaluation_mode for item in _mandatory.CATALOG_INDICATORS}
    assert modes["VSE-F18"] == "FIXED"
    assert modes["VSE-F19"] == "FIXED"
    assert modes["VSE-F22"] == "FIXED"
    assert modes["VSE-F27"] == "FIXED"
    assert modes["VSE-F28"] == "FIXED"
    assert modes["VSE-F23"] == "NONE"
    # ТЗ DR53 Task 6: trichinelloscopy is FIXED now.
    assert modes["VSE-F21"] == "FIXED"
    for code in ("VSE-F20", "VSE-F24", "VSE-F25", "VSE-F26", "VSE-F29"):
        assert modes[code] == "CONFIGURABLE", code


def test_trichinella_registry_is_fixed_conditional_boolean() -> None:
    """ТЗ DR53 Task 6 Step 1: the F21 registry definition."""
    definition = _mandatory.indicator_by_code("VSE-F21")
    assert definition.result_schema == "BOOLEAN_MATCH"
    assert definition.evaluation_mode == "FIXED"
    assert definition.conditional is True
    assert definition.mandatory is False
    assert definition.options == ("Не обнаружено", "Обнаружено")
    assert definition.fixed_criterion == "норма: Не обнаружено"
    for value, expected in (("true", "IN_NORM"), (True, "IN_NORM"), ("Не обнаружено", "IN_NORM")):
        assert definition.fixed_values[value] == expected, value
    for value, expected in (("false", "DEVIATION"), (False, "DEVIATION"), ("Обнаружено", "DEVIATION")):
        assert definition.fixed_values[value] == expected, value


# --- §6.4: fixed evaluation without a MethodRule ---------------------------------------


@pytest.mark.integration
async def test_fixed_indicator_evaluates_without_method_rule(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_tariff(env.lab.id, species, str(ORGANOLEPTIC), "10.00", unit="RUB"))
    await db_session.commit()

    for value, expected in (("MATCH", "IN_NORM"), ("MISMATCH", "DEVIATION")):
        snapshot = await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                uuid.uuid4(),
                [ResearchValue.model_validate({"indicator_id": str(ORGANOLEPTIC), "performed": True, "value": value})],
                quantity="1",
            ),
            None,
        )
        evaluation = snapshot.lines[0].evaluation
        assert evaluation["status"] == expected, value
        assert evaluation["evaluation_mode"] == "FIXED"
        assert evaluation["criterion"] != ""


@pytest.mark.integration
async def test_fixed_reaction_mappings(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add_all(
        [
            _tariff(env.lab.id, species, str(COPPER), "10.00", unit="RUB"),
            _tariff(env.lab.id, species, str(PEROXIDASE), "10.00", unit="RUB"),
        ]
    )
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [
                ResearchValue.model_validate({"indicator_id": str(COPPER), "performed": True, "value": "NEGATIVE"}),
                ResearchValue.model_validate({"indicator_id": str(COPPER), "performed": True, "value": "POSITIVE"}),
                ResearchValue.model_validate({"indicator_id": str(PEROXIDASE), "performed": True, "value": "POSITIVE"}),
                ResearchValue.model_validate({"indicator_id": str(PEROXIDASE), "performed": True, "value": "NEGATIVE"}),
            ],
            quantity="1",
        ),
        None,
    )
    statuses = [line.evaluation["status"] for line in snapshot.lines]
    assert statuses == ["IN_NORM", "DEVIATION", "IN_NORM", "DEVIATION"]


@pytest.mark.integration
async def test_none_indicator_is_not_applicable(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_tariff(env.lab.id, species, str(BACTERIOSCOPY), "10.00", unit="RUB"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [
                ResearchValue.model_validate(
                    {"indicator_id": str(BACTERIOSCOPY), "performed": True, "value": "рост не обнаружен"}
                )
            ],
            quantity="1",
        ),
        None,
    )
    evaluation = snapshot.lines[0].evaluation
    assert evaluation["status"] == "NOT_APPLICABLE"
    assert evaluation["evaluation_mode"] == "NONE"


# --- §6.4: writes are refused for FIXED/NONE -------------------------------------------


@pytest.mark.integration
async def test_write_norm_for_fixed_and_none_is_refused(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    payload = MethodRuleWrite(
        laboratory_id=env.lab.id,
        code="VSE-F18",
        rule=QualitativeRule.model_validate({"type": "qualitative", "accepted_values": ["Соответствует"]}),
    )
    with pytest.raises(ProblemError) as problem:
        await _commands.create_method_rule(db_session, payload)
    assert problem.value.status == 422
    assert "фиксирована" in " ".join(item.message for item in problem.value.errors).lower()

    payload_none = MethodRuleWrite(
        laboratory_id=env.lab.id,
        code="VSE-F23",
        rule=QualitativeRule.model_validate({"type": "qualitative", "accepted_values": ["рост не обнаружен"]}),
    )
    with pytest.raises(ProblemError) as problem_none:
        await _commands.create_method_rule(db_session, payload_none)
    assert problem_none.value.status == 422

    # A configurable indicator keeps its write path.
    payload_ok = MethodRuleWrite(
        laboratory_id=env.lab.id,
        code="VSE-F24",
        rule={"type": "interval", "lower": "0", "upper": "5"},
    )
    row = await _commands.create_method_rule(db_session, payload_ok)
    assert row.indicator_id == MICROSCOPY

    # ТЗ DR53 Task 6: a NEW F21 norm is rejected as a FIXED indicator.
    payload_trich = MethodRuleWrite(
        laboratory_id=env.lab.id,
        code="VSE-F21",
        rule=QualitativeRule.model_validate({"type": "qualitative", "accepted_values": ["Не обнаружено"]}),
    )
    with pytest.raises(ProblemError) as problem_trich:
        await _commands.create_method_rule(db_session, payload_trich)
    assert problem_trich.value.status == 422


@pytest.mark.integration
async def test_trichinella_fixed_mapping_and_legacy_rule_ignored(db_session: AsyncSession) -> None:
    """ТЗ DR53 Task 6: the fixed mapping evaluates boolean wire values and
    accepts the legacy Russian labels; an old active F21 MethodRule does NOT
    override the fixed evaluation."""
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(_tariff(env.lab.id, species, str(TRICHINELLA), "8.00", unit="RUB"))
    # A legacy ACTIVE F21 MethodRule stays in the database (inserted directly:
    # the create command refuses FIXED indicators since DR53).
    db_session.add(
        _rule(
            env.lab.id,
            species,
            uuid.uuid4(),
            TRICHINELLA,
            version=1,
            result_schema="BOOLEAN_MATCH",
            unit_id="",
            rule={"type": "qualitative", "accepted_values": ["Не обнаружено"]},
        )
    )
    await db_session.commit()

    for value, expected in (("true", "IN_NORM"), ("false", "DEVIATION"), ("Обнаружено", "DEVIATION")):
        snapshot = await evaluate_and_price(
            UnitOfWork(db_session),
            _vse_request(
                env.lab.id,
                species,
                uuid.uuid4(),
                [ResearchValue.model_validate({"indicator_id": str(TRICHINELLA), "performed": True, "value": value})],
                quantity="1",
            ),
            None,
        )
        evaluation = snapshot.lines[0].evaluation
        assert evaluation["status"] == expected, value
        assert evaluation["evaluation_mode"] == "FIXED"
        assert evaluation["criterion"] == "норма: Не обнаружено"


# --- the review finding: legacy INTEGER norms stay honest ------------------------------


@pytest.mark.integration
async def test_legacy_integer_norm_fractional_value_is_honest_unknown(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    db_session.add(
        _rule(
            env.lab.id,
            species,
            uuid.uuid4(),
            MICROSCOPY,
            result_schema="INTEGER_NONNEGATIVE",
            unit_id="RUB",
            rule={"type": "interval", "lower": "0", "upper": "3"},
        )
    )
    db_session.add(_tariff(env.lab.id, species, str(MICROSCOPY), "10.00", unit="RUB"))
    await db_session.commit()

    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [ResearchValue.model_validate({"indicator_id": str(MICROSCOPY), "performed": True, "value": "2.5"})],
            quantity="1",
        ),
        None,
    )
    evaluation = snapshot.lines[0].evaluation
    # No fabricated verdict: a fractional value against a legacy INTEGER norm
    # stays UNKNOWN and carries the honest re-save hint.
    assert evaluation["status"] == "UNKNOWN"
    assert "пересохран" in str(evaluation.get("hint", "")).lower()


# --- DR41-B Important: pinned snapshots keep their provenance ---------------------------


@pytest.mark.integration
async def test_pinned_fixed_snapshot_keeps_provenance(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    species = uuid.uuid4()
    indicator = ORGANOLEPTIC
    previous = PricingSnapshot.model_validate(
        {
            "lines": [
                {
                    "service_code": str(indicator),
                    "name": "Прошлая формулировка",
                    "unit_id": "акция",
                    "quantity": "1",
                    "unit_price": "12.00",
                    "amount": "12.00",
                    "method_snapshot": {
                        "indicator_id": str(indicator),
                        "method_version": 7,
                        "result_schema": "TEXT",
                        "unit_id": "акция",
                        "rule": {"type": "fixed"},
                        "source": {"name": "Исходная методика, ред. 2019"},
                    },
                    "evaluation": {"status": "IN_NORM"},
                }
            ],
            "total": "12.00",
            "currency": "RUB",
            "fair": False,
        }
    )
    snapshot = await evaluate_and_price(
        UnitOfWork(db_session),
        _vse_request(
            env.lab.id,
            species,
            uuid.uuid4(),
            [ResearchValue.model_validate({"indicator_id": str(indicator), "performed": True, "value": "MATCH"})],
            quantity="1",
        ),
        previous,
    )
    line = snapshot.lines[0]
    assert line.method_snapshot is not None
    # The original snapshot provenance survives the re-evaluation: the generic
    # FIXED rebuild must not overwrite the saved source/version fields.
    assert line.method_snapshot["source"]["name"] == "Исходная методика, ред. 2019"
    assert line.method_snapshot["method_version"] == 7
    assert line.unit_id == "акция"
    # The pinned price is still kept (ADR-020) and the value is re-evaluated.
    assert line.unit_price == "12.00"
    assert line.evaluation["status"] == "IN_NORM"


# --- §6.4: context and readiness --------------------------------------------------------


@pytest.mark.integration
async def test_context_marks_evaluation_modes_and_missing_is_configurable_only(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    ctx = await context_module.methods_context(db_session, env.lab.id, "meat")
    modes = {item.code: item.evaluation_mode for item in ctx.indicators}
    assert modes["VSE-F18"] == "FIXED"
    assert modes["VSE-F23"] == "NONE"
    missing_codes = {_mandatory.INDICATOR_BY_ID[item].code for item in ctx.missing}
    assert missing_codes <= {"VSE-F20", "VSE-F21", "VSE-F24", "VSE-F25", "VSE-F26", "VSE-F29"}
    assert "VSE-F18" not in missing_codes
    assert "VSE-F23" not in missing_codes


@pytest.mark.integration
async def test_readiness_fixed_indicators_do_not_require_method_rule(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    report = await _queries.readiness(db_session, env.lab.id)
    ids = {item.input_id for item in report.missing}
    assert not any(item.startswith(f"method:{ORGANOLEPTIC}") for item in ids)
    assert not any(item.startswith(f"method:{IDENTIFICATION}") for item in ids)
    # The configurable mandatory temperature norm is still demanded.
    assert any(item.startswith(f"method:{TEMPERATURE}") for item in ids)
