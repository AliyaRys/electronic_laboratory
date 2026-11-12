"""Typed rule schemas and evaluation boundaries (Task C01, INPUT-02).

Named plan tests:

- interval boundaries below/on/above with inclusive/exclusive flags;
- qualitative accepted values;
- pH 0/14 and microscopy 0 input boundaries;
- no floats / NaN / Infinity / exponent / empty in the pricing path (SPEC-05);
- SQL constraints on real PostgreSQL: one active method version, unique
  non-negative tariff, the two CHECK service codes only.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from backend.src.modules.catalog_pricing.models import CheckServiceRule, MethodRule, Tariff
from backend.src.modules.catalog_pricing.schemas import (
    DECIMAL_SCHEMAS,
    DosimetryPair,
    IntervalRule,
    MethodRuleWrite,
    QualitativeRule,
    ResultSchema,
    TariffWrite,
    parse_decimal,
)
from backend.src.modules.catalog_pricing.service import evaluate_typed


def _interval(lower: str | None = None, upper: str | None = None, *, li: bool = True, ui: bool = True) -> IntervalRule:
    return IntervalRule.model_validate(
        {"type": "interval", "lower": lower, "upper": upper, "lower_inclusive": li, "upper_inclusive": ui}
    )


# --- DecimalString hygiene (SPEC-05) --------------------------------------------


def test_decimal_string_accepts_exact_dot_form() -> None:
    assert parse_decimal("100.10") == __import__("decimal").Decimal("100.10")
    assert parse_decimal("0") == __import__("decimal").Decimal("0")


@pytest.mark.parametrize("bad", ["1e2", "NaN", "Infinity", "-Infinity", "", " 1", "1,", "1.2.3", "0x1", "1.2e-3"])
def test_decimal_string_rejects_non_finite_and_exponent(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_decimal(bad)


def test_empty_is_not_zero_and_scale_limits_enforced() -> None:
    with pytest.raises(ValidationError):
        TariffWrite.model_validate(
            {
                "laboratory_id": str(uuid.uuid4()),
                "product_species_id": str(uuid.uuid4()),
                "service_code": "VSE",
                "unit_id": "kg",
                "price": "",
                "version": 1,
                "source": {"name": "прейскурант"},
            }
        )


def test_float_input_is_rejected_in_write_schemas() -> None:
    with pytest.raises(ValidationError):
        TariffWrite.model_validate(
            {
                "laboratory_id": str(uuid.uuid4()),
                "product_species_id": str(uuid.uuid4()),
                "service_code": "VSE",
                "unit_id": "kg",
                "price": 100.10,  # float must never enter the pricing path
                "version": 1,
                "source": {"name": "прейскурант"},
            }
        )


def test_price_negative_rejected_above_two_decimals_allowed() -> None:
    base = {
        "laboratory_id": str(uuid.uuid4()),
        "product_species_id": str(uuid.uuid4()),
        "service_code": "VSE",
        "unit_id": "kg",
        "version": 1,
        "source": {"name": "прейскурант"},
    }
    with pytest.raises(ValidationError):
        TariffWrite.model_validate({**base, "price": "-1.00"})
    assert TariffWrite.model_validate({**base, "price": "100.10"}).price == "100.10"
    with pytest.raises(ValidationError):
        # more than two decimals is above supported money precision
        TariffWrite.model_validate({**base, "price": "0.005"})


def test_mass_scale6_limit_in_quantity_input() -> None:
    from backend.src.modules.catalog_pricing.schemas import QuantityString

    assert QuantityString.validate("0.000001") == "0.000001"
    with pytest.raises(ValueError):
        QuantityString.validate("0.0000001")


# --- typed rule schema (INPUT-02) ------------------------------------------------


def test_rule_union_discriminates_interval_and_qualitative() -> None:
    assert _interval("0", "14").lower == "0"
    q = QualitativeRule.model_validate({"type": "qualitative", "accepted_values": ["MATCH"]})
    assert q.accepted_values == ["MATCH"]
    with pytest.raises(ValidationError):
        IntervalRule.model_validate({"type": "qualitative", "accepted_values": ["MATCH"]})


def test_interval_requires_lower_le_upper() -> None:
    with pytest.raises(ValidationError):
        _interval("14", "0")


def test_method_rule_write_rejects_extra_fields() -> None:
    payload = {
        "laboratory_id": str(uuid.uuid4()),
        "product_species_id": str(uuid.uuid4()),
        "product_state_id": str(uuid.uuid4()),
        "indicator_id": str(uuid.uuid4()),
        "result_schema": "DECIMAL",
        "unit_id": "kg",
        "rule": {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True},
        "source": {"name": "методика", "edition": "2023", "reference": "п.4"},
        "version": 1,
    }
    assert MethodRuleWrite.model_validate(payload).unit_id == "kg"
    with pytest.raises(ValidationError):
        MethodRuleWrite.model_validate({**payload, "price": "10.00"})


def test_result_schema_enum_is_typed() -> None:
    assert {s.value for s in ResultSchema} == DECIMAL_SCHEMAS | {"TEXT", "ENUM", "BOOLEAN_MATCH", "DOSIMETRY_PAIR"}


def test_mandatory_registry_is_fail_loud(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty ФТ mandatory registry refuses startup instead of silently no-op."""
    from backend.src.modules.catalog_pricing import mandatory
    from backend.src.modules.catalog_pricing.mandatory import (
        MANDATORY_INDICATOR_IDS,
        TRICHINELLA_INDICATOR_ID,
        ensure_mandatory_registry_configured,
    )

    assert MANDATORY_INDICATOR_IDS, "the meat-MVP mandatory set must ship populated"
    assert len(MANDATORY_INDICATOR_IDS) == 3
    assert TRICHINELLA_INDICATOR_ID not in MANDATORY_INDICATOR_IDS
    monkeypatch.setattr(mandatory, "MANDATORY_INDICATOR_IDS", frozenset())
    with pytest.raises(RuntimeError):
        ensure_mandatory_registry_configured()


# --- evaluation boundaries --------------------------------------------------------


def test_interval_below_on_above() -> None:
    rule = _interval("1", "5")
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "2.5")["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "1")["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "5")["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "0.9")["status"] == "DEVIATION"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "5.1")["status"] == "DEVIATION"


def test_interval_exclusive_boundaries() -> None:
    rule = _interval("1", "5", li=False, ui=False)
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "1")["status"] == "DEVIATION"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "5")["status"] == "DEVIATION"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "3")["status"] == "IN_NORM"


def test_qualitative_accepts_only_listed_values() -> None:
    rule = QualitativeRule.model_validate({"type": "qualitative", "accepted_values": ["MATCH", "NORM"]})
    assert evaluate_typed(ResultSchema.ENUM, rule, "MATCH")["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.ENUM, rule, "MISMATCH")["status"] == "DEVIATION"
    assert evaluate_typed(ResultSchema.TEXT, rule, "бактериоскопия: чистый мазок")["status"] == "UNKNOWN"


def test_boolean_match_semantics() -> None:
    rule = QualitativeRule.model_validate({"type": "qualitative", "accepted_values": ["MATCH"]})
    assert evaluate_typed(ResultSchema.BOOLEAN_MATCH, rule, True)["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.BOOLEAN_MATCH, rule, False)["status"] == "DEVIATION"


def test_ph_boundary_0_and_14() -> None:
    rule = _interval("0", "14")
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "0")["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "14")["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "-0.1")["status"] == "DEVIATION"


def test_microscopy_zero_integer_nonnegative() -> None:
    rule = _interval("0", None)
    assert evaluate_typed(ResultSchema.INTEGER_NONNEGATIVE, rule, 0)["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.INTEGER_NONNEGATIVE, rule, 3)["status"] == "IN_NORM"
    assert evaluate_typed(ResultSchema.INTEGER_NONNEGATIVE, rule, -1)["status"] == "DEVIATION"
    assert evaluate_typed(ResultSchema.INTEGER_NONNEGATIVE, rule, "1.5")["status"] == "UNKNOWN"


def test_dosimetry_pair_both_values_evaluated() -> None:
    pair = DosimetryPair.model_validate({"first": "0.10", "last": "0.20"})
    rule = _interval("0", "0.3")
    result = evaluate_typed(ResultSchema.DOSIMETRY_PAIR, rule, pair)
    assert result["status"] == "IN_NORM"
    hot = DosimetryPair.model_validate({"first": "0.10", "last": "0.50"})
    assert evaluate_typed(ResultSchema.DOSIMETRY_PAIR, rule, hot)["status"] == "DEVIATION"


def test_unknown_typed_value_maps_to_unknown_not_error() -> None:
    rule = _interval("0", "14")
    assert evaluate_typed(ResultSchema.DECIMAL, rule, None)["status"] == "UNKNOWN"
    assert evaluate_typed(ResultSchema.DECIMAL, rule, "abc")["status"] == "UNKNOWN"


# --- SQL constraints on real PostgreSQL (DATA-04) --------------------------------


@pytest.mark.integration
async def test_one_active_method_version(db_session) -> None:
    from sqlalchemy.exc import IntegrityError

    lab = uuid.uuid4()
    species = uuid.uuid4()
    state = uuid.uuid4()
    indicator = uuid.uuid4()
    rule = {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True}
    db_session.add(
        MethodRule(
            laboratory_id=lab,
            product_species_id=species,
            product_state_id=state,
            indicator_id=indicator,
            version=1,
            result_schema="DECIMAL",
            unit_id="kg",
            rule=rule,
            source={"name": "методика"},
            active=True,
        )
    )
    await db_session.flush()
    db_session.add(
        MethodRule(
            laboratory_id=lab,
            product_species_id=species,
            product_state_id=state,
            indicator_id=indicator,
            version=2,
            result_schema="DECIMAL",
            unit_id="kg",
            rule=rule,
            source={"name": "методика"},
            active=True,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.integration
async def test_tariff_unique_scope_and_nonnegative_price(db_session) -> None:
    from sqlalchemy.exc import IntegrityError

    lab = uuid.uuid4()
    species = uuid.uuid4()
    db_session.add(
        Tariff(
            laboratory_id=lab,
            product_species_id=species,
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="piece",
            price="50.00",
            version=1,
            source={"name": "прейскурант"},
        )
    )
    await db_session.flush()
    db_session.add(
        Tariff(
            laboratory_id=lab,
            product_species_id=species,
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="piece",
            price="60.00",
            version=1,
            source={"name": "прейскурант"},
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
    db_session.add(
        Tariff(
            laboratory_id=lab,
            product_species_id=species,
            service_code="PRODUCT_IDENTIFICATION",
            unit_id="piece",
            price="-1.00",
            version=1,
            source={"name": "прейскурант"},
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.integration
async def test_check_service_rules_only_two_codes(db_session) -> None:
    from sqlalchemy.exc import IntegrityError

    db_session.add(
        CheckServiceRule(
            service_code="VSE_MYSTERY",
            unit_id="piece",
            multiplier_basis="ONE_SERVICE",
            applicable_decisions=["ACCEPT_ALL"],
            version=1,
            source={"name": "прейскурант"},
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.integration
async def test_method_rules_are_lab_scoped(db_session) -> None:
    lab = uuid.uuid4()
    species = uuid.uuid4()
    state = uuid.uuid4()
    indicator = uuid.uuid4()
    rule = {"type": "interval", "lower": "0", "upper": "14", "lower_inclusive": True, "upper_inclusive": True}
    db_session.add(
        MethodRule(
            laboratory_id=lab,
            product_species_id=species,
            product_state_id=state,
            indicator_id=indicator,
            version=1,
            result_schema="DECIMAL",
            unit_id="kg",
            rule=rule,
            source={"name": "методика"},
            active=True,
        )
    )
    await db_session.flush()
    other = (await db_session.execute(select(MethodRule).where(MethodRule.laboratory_id == lab))).scalar_one()
    assert other.laboratory_id == lab
    assert other.indicator_id == indicator


# --- ТЗ DR13: a laboratory UUID is never a product species (tariff scope) --------


@pytest.mark.integration
async def test_tariff_commands_reject_laboratory_uuid_as_species(db_session) -> None:
    from backend.src.core.problems import ProblemError
    from backend.src.modules.catalog_pricing import commands
    from backend.src.modules.catalog_pricing.schemas import TariffWrite

    lab = uuid.uuid4()
    payload = TariffWrite.model_validate(
        {
            "laboratory_id": str(lab),
            "product_species_id": str(lab),
            "service_code": "PRODUCT_IDENTIFICATION",
            "unit_id": "RUB",
            "price": "110.00",
            "version": 1,
            "source": {"name": "Ручная настройка справочника"},
        }
    )
    with pytest.raises(ProblemError) as created:
        await commands.create_tariff(db_session, payload)
    assert created.value.status == 422
    assert created.value.code == "VALIDATION_ERROR"
    assert any("Вид продукции" in item.message for item in created.value.errors)

    row = Tariff(
        laboratory_id=lab,
        product_species_id=uuid.uuid4(),
        service_code="PRODUCT_IDENTIFICATION",
        unit_id="RUB",
        price=parse_decimal("110.00"),
        version=1,
        source={"name": "Ручная настройка справочника"},
    )
    db_session.add(row)
    await db_session.flush()
    with pytest.raises(ProblemError) as updated:
        await commands.update_tariff(
            db_session,
            row,
            payload.model_copy(update={"product_species_id": lab}),
        )
    assert updated.value.status == 422
    assert any("Вид продукции" in item.message for item in updated.value.errors)
