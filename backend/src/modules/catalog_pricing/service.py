"""Pricing engine: typed rules, exact decimal lines, snapshots (DATA-06).

``evaluate_and_price`` is a read-only calculation inside the caller's unit of
work: it never commits and never writes (API-03). Money follows ADR-020:

- line amount = tariff × accepted quantity, ``ROUND_HALF_UP`` to 0.01;
- the snapshot total is the sum of the rounded line amounts;
- fair mode stores only zeros and never includes an ordinary tariff;
- a missing price/norm is ``CONFIGURATION_MISSING``; an explicit zero price is
  allowed; the evaluation engine never assigns an outcome.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select

from backend.src.core.commands import UnitOfWork
from backend.src.core.problems import ProblemError, ProblemItem
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.models import CheckServiceRule, MethodRule, Tariff
from backend.src.modules.catalog_pricing.schemas import (
    DECIMAL_SCHEMAS,
    DosimetryPair,
    IntervalRule,
    PricingLine,
    PricingRequest,
    PricingSnapshot,
    QualitativeRule,
    ResultSchema,
    parse_decimal,
)

__all__ = [
    "MANDATORY_INDICATOR_IDS",
    "configuration_missing",
    "evaluate_typed",
    "evaluate_and_price",
    "CENT",
]

# The mandatory research set is fixed by the functional requirements (FT
# VSE-03–05), not by a catalog flag; the concrete deterministic ids and their
# provenance live in ``mandatory.py``. Reads go through the module attribute so
# a deployment override stays visible to every call site.
MANDATORY_INDICATOR_IDS = _mandatory.MANDATORY_INDICATOR_IDS

CENT = Decimal("0.01")

CHECK_SERVICE_NAMES = {
    "PRODUCT_IDENTIFICATION": "Идентификация продукции",
    "TRANSPORT_INSPECTION": "Транспортный осмотр",
}


def configuration_missing(message: str, *, path: str, field_id: str | None = None) -> ProblemError:
    """422 CONFIGURATION_MISSING — the catalog cannot support the calculation."""
    return ProblemError(
        status=422,
        code="CONFIGURATION_MISSING",
        title="Configuration missing",
        detail=message,
        errors=[ProblemItem(path=path, field_id=field_id, message=message)],
    )


def _quantize_money(value: Decimal) -> str:
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def _to_decimal(value: Any) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        return None
    try:
        return Decimal(str(value)) if not isinstance(value, str) else parse_decimal(value)
    except ValueError, ArithmeticError:
        return None


def evaluate_typed(result_schema: ResultSchema, rule: IntervalRule | QualitativeRule, value: Any) -> dict[str, Any]:
    """Evaluate one typed value against one typed rule (INPUT-02).

    Returns an evaluation snapshot dict with ``status`` ``IN_NORM`` /
    ``DEVIATION`` / ``UNKNOWN``. It never raises on bad input and never assigns
    an outcome: an unusable value is ``UNKNOWN`` (blocking only for mandatory
    indicators, decided by the caller).
    """
    if isinstance(value, DosimetryPair):
        first = _to_decimal(value.first)
        last = _to_decimal(value.last)
        if first is None or last is None:
            return {"status": "UNKNOWN", "rule_type": rule.type}
        statuses = {_interval_status(rule, first), _interval_status(rule, last)}
        return {"status": _combine(statuses), "rule_type": rule.type}

    if result_schema == ResultSchema.INTEGER_NONNEGATIVE:
        if isinstance(value, bool) or not isinstance(value, int):
            return {"status": "UNKNOWN", "rule_type": rule.type}
        if value < 0:
            return {"status": "DEVIATION", "rule_type": rule.type}
        return {"status": _interval_status(rule, Decimal(value)), "rule_type": rule.type}

    if result_schema in DECIMAL_SCHEMAS:
        number = _to_decimal(value)
        if number is None:
            return {"status": "UNKNOWN", "rule_type": rule.type}
        return {"status": _interval_status(rule, number), "rule_type": rule.type}

    if result_schema == ResultSchema.BOOLEAN_MATCH:
        if not isinstance(value, bool):
            return {"status": "UNKNOWN", "rule_type": rule.type}
        return {"status": "IN_NORM" if value else "DEVIATION", "rule_type": rule.type}

    if result_schema in (ResultSchema.ENUM, ResultSchema.TEXT):
        if not isinstance(value, str) or not isinstance(rule, QualitativeRule):
            return {"status": "UNKNOWN", "rule_type": rule.type}
        if result_schema == ResultSchema.TEXT:
            # Free text (e.g. бактериоскопия) has no clinical normality; the
            # value is recorded, but the engine does not invent a verdict.
            return {"status": "UNKNOWN", "rule_type": rule.type}
        return {"status": "IN_NORM" if value in rule.accepted_values else "DEVIATION", "rule_type": rule.type}

    return {"status": "UNKNOWN", "rule_type": rule.type}


def _interval_status(rule: IntervalRule | QualitativeRule, number: Decimal) -> str:
    if not isinstance(rule, IntervalRule):
        return "UNKNOWN"
    if rule.lower is not None:
        bound = parse_decimal(rule.lower)
        if number < bound or (number == bound and not rule.lower_inclusive):
            return "DEVIATION"
    if rule.upper is not None:
        bound = parse_decimal(rule.upper)
        if number > bound or (number == bound and not rule.upper_inclusive):
            return "DEVIATION"
    return "IN_NORM"


def _combine(statuses: set[str]) -> str:
    if "UNKNOWN" in statuses:
        return "UNKNOWN"
    if "DEVIATION" in statuses:
        return "DEVIATION"
    return "IN_NORM"


async def _active_rule(
    uow: UnitOfWork, laboratory_id: UUID, species: UUID, state: UUID, indicator: UUID
) -> MethodRule | None:
    statement = select(MethodRule).where(
        MethodRule.laboratory_id == laboratory_id,
        MethodRule.product_species_id == species,
        MethodRule.product_state_id == state,
        MethodRule.indicator_id == indicator,
        MethodRule.active,
    )
    return (await uow.session.execute(statement)).scalar_one_or_none()


async def _tariff_for(uow: UnitOfWork, laboratory_id: UUID, species: UUID, code: str, unit_id: str) -> Tariff | None:
    statement = select(Tariff).where(
        Tariff.laboratory_id == laboratory_id,
        Tariff.product_species_id == species,
        Tariff.service_code == code,
        Tariff.unit_id == unit_id,
    )
    return (await uow.session.execute(statement)).scalar_one_or_none()


def _method_snapshot(rule: MethodRule, indicator: UUID) -> dict[str, Any]:
    return {
        "indicator_id": str(indicator),
        "method_version": rule.version,
        "result_schema": rule.result_schema,
        "unit_id": rule.unit_id,
        "rule": rule.rule,
        "source": rule.source,
    }


def _evaluate_with_schema(snapshot_rule: MethodRule | None, value: Any) -> dict[str, Any]:
    if snapshot_rule is None:
        return {"status": "UNKNOWN", "rule_type": None}
    typed_rule: IntervalRule | QualitativeRule
    data = dict(snapshot_rule.rule)
    data.setdefault("type", "interval")
    typed_rule = (
        QualitativeRule.model_validate(data) if data["type"] == "qualitative" else IntervalRule.model_validate(data)
    )
    return evaluate_typed(ResultSchema(snapshot_rule.result_schema), typed_rule, value)


def _price_from_prev_or_tariff(
    previous: PricingLine | None,
    tariff: Tariff | None,
    *,
    fair: bool,
    indicator: UUID,
) -> str:
    if fair:
        return "0.00"  # every saved charge is 0; the ordinary tariff is not present
    if previous is not None:
        return previous.unit_price  # ADR-020: an existing result keeps its price
    if tariff is None:
        raise configuration_missing(
            "Для выполненного показателя нет тарифа; обратитесь к ответственному за прейскурант.",
            path=f"results.{indicator}",
            field_id="VSE",
        )
    return _quantize_money(tariff.price)


def _quantity(request: PricingRequest) -> str:
    if request.accepted_quantity is None:
        raise configuration_missing(
            "Расчёт требует принятого количества партии в исходной единице.",
            path="accepted_quantity",
            field_id="VSE",
        )
    return request.accepted_quantity


async def _price_vse(uow: UnitOfWork, request: PricingRequest, previous: PricingSnapshot | None) -> list[PricingLine]:
    species = request.product_species_id
    state = request.product_state_id
    if species is None or state is None:
        raise configuration_missing(
            "Расчёт ВСЭ требует вид и состояние продукции партии.", path="product_species_id", field_id="VSE"
        )
    previous_by_indicator = _previous_lines_by_indicator(previous)
    quantity = _quantity(request)
    laboratory_id = _lab_id(request)
    lines: list[PricingLine] = []
    for result in request.results:
        indicator = result.indicator_id
        mandatory = indicator in _mandatory.MANDATORY_INDICATOR_IDS
        if not result.performed:
            if mandatory:
                raise configuration_missing(
                    "Обязательный показатель методики не выполнен.", path=f"results.{indicator}", field_id="VSE"
                )
            continue
        pinned = previous_by_indicator.get(indicator)
        if pinned is not None:
            snapshot_rule = _rule_from_snapshot(pinned)
        else:
            snapshot_rule = await _active_rule(uow, laboratory_id, species, state, indicator)
        if snapshot_rule is None:
            # A missing norm blocks, including the fair calculation (INPUT-02).
            raise configuration_missing(
                "Отсутствует действующая методика и норма для показателя.",
                path=f"results.{indicator}",
                field_id="VSE",
            )
        evaluation = _evaluate_with_schema(snapshot_rule, result.value)
        if evaluation["status"] == "UNKNOWN" and mandatory:
            raise configuration_missing(
                "Значение обязательного показателя не соответствует типу методики.",
                path=f"results.{indicator}",
                field_id="VSE",
            )
        tariff = (
            None
            if pinned is not None or request.fair
            else await _tariff_for(uow, laboratory_id, species, str(indicator), snapshot_rule.unit_id)
        )
        unit_price = _price_from_prev_or_tariff(pinned, tariff, fair=request.fair, indicator=indicator)
        price_decimal = parse_decimal(unit_price) if unit_price != "0.00" else Decimal("0.00")
        amount = _quantize_money(price_decimal * parse_decimal(quantity)) if not request.fair else "0.00"
        lines.append(
            PricingLine.model_validate(
                {
                    "service_code": str(indicator),
                    "name": str(snapshot_rule.source.get("name", "Исследование")),
                    "unit_id": snapshot_rule.unit_id,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "amount": amount,
                    "method_snapshot": _method_snapshot(snapshot_rule, indicator),
                    "evaluation": evaluation,
                }
            )
        )
    return lines


def _lab_id(request: PricingRequest) -> UUID:
    # The laboratory scope of the party is resolved server-side in later tasks;
    # C01 carries it on the request because arrivals do not exist yet.
    lab = request.laboratory_id
    if lab is None:
        raise configuration_missing("Расчёт требует лабораторию партии.", path="laboratory_id", field_id="VSE")
    return lab


def _rule_from_snapshot(line: PricingLine) -> MethodRule | None:
    snapshot = line.method_snapshot
    if not snapshot:
        return None
    rule = MethodRule(
        laboratory_id=UUID(int=0),
        product_species_id=UUID(int=0),
        product_state_id=UUID(int=0),
        indicator_id=UUID(int=0),
        version=int(snapshot.get("method_version", 1)),
        result_schema=str(snapshot.get("result_schema", "DECIMAL")),
        unit_id=str(snapshot.get("unit_id", line.unit_id)),
        rule=dict(snapshot.get("rule", {})),
        source=dict(snapshot.get("source", {})),
        active=False,
    )
    return rule


def _previous_lines_by_indicator(previous: PricingSnapshot | None) -> dict[UUID, PricingLine]:
    if previous is None:
        return {}
    found: dict[UUID, PricingLine] = {}
    for line in previous.lines:
        snapshot = line.method_snapshot or {}
        indicator = snapshot.get("indicator_id")
        if isinstance(indicator, str):
            found[UUID(indicator)] = line
    return found


async def _price_check(uow: UnitOfWork, request: PricingRequest) -> list[PricingLine]:
    species = request.product_species_id
    if species is None:
        raise configuration_missing(
            "Расчёт услуг сверки требует вид продукции партии.", path="product_species_id", field_id="CHECK"
        )
    lines: list[PricingLine] = []
    for code in request.performed:
        rule = (
            await uow.session.execute(select(CheckServiceRule).where(CheckServiceRule.service_code == code))
        ).scalar_one_or_none()
        if rule is None:
            raise configuration_missing(
                "Отсутствует правило применимости услуги сверки.", path=f"performed.{code}", field_id="CHECK"
            )
        if request.decision is None or request.decision not in rule.applicable_decisions:
            raise configuration_missing(
                "Решение сверки не входит в применимые для услуги.", path=f"performed.{code}", field_id="CHECK"
            )
        quantity: Decimal
        unit_id: str | None
        if rule.multiplier_basis == "ONE_SERVICE":
            quantity, unit_id = Decimal("1"), rule.unit_id
        else:
            raw = (
                request.accepted_quantity
                if rule.multiplier_basis == "ACCEPTED_QUANTITY"
                else request.delivered_quantity
            )
            if raw is None:
                raise configuration_missing(
                    "Услуга сверки требует количество партии по её основе расчёта.",
                    path=f"performed.{code}",
                    field_id="CHECK",
                )
            unit_id = (
                request.accepted_unit_id if rule.multiplier_basis == "ACCEPTED_QUANTITY" else request.delivered_unit_id
            )
            quantity = parse_decimal(raw)
        if not isinstance(unit_id, str) or unit_id != rule.unit_id:
            raise configuration_missing(
                "Единица количества партии не совпадает с единицей услуги сверки.",
                path=f"performed.{code}",
                field_id="CHECK",
            )
        if request.fair:
            unit_price = "0.00"
            amount = "0.00"
        else:
            tariff = await _tariff_for(uow, _lab_id(request), species, code, rule.unit_id)
            if tariff is None:
                raise configuration_missing(
                    "Для услуги сверки нет тарифа в прейскуранте.",
                    path=f"performed.{code}",
                    field_id="CHECK",
                )
            unit_price = _quantize_money(tariff.price)
            amount = _quantize_money(tariff.price * quantity)
        lines.append(
            PricingLine.model_validate(
                {
                    "service_code": code,
                    "name": CHECK_SERVICE_NAMES.get(code, code),
                    "unit_id": rule.unit_id,
                    "quantity": str(quantity),
                    "unit_price": unit_price,
                    "amount": amount,
                    "method_snapshot": {
                        "service_code": code,
                        "method_version": rule.version,
                        "multiplier_basis": rule.multiplier_basis,
                        "source": rule.source,
                    },
                    "evaluation": {"status": "PERFORMED"},
                }
            )
        )
    return lines


async def evaluate_and_price(
    uow: UnitOfWork, request: PricingRequest, previous: PricingSnapshot | None
) -> PricingSnapshot:
    """Calculate the pricing snapshot of a working record (DATA-06).

    Pure read-only pricing: no writes, no commit. ``previous`` is the working
    record's saved snapshot; its lines keep their pinned norm/price, new results
    are priced by the current catalog.
    """
    if request.context == "CHECK":
        lines = await _price_check(uow, request)
    else:
        lines = await _price_vse(uow, request, previous)
    total = sum((parse_decimal(line.amount) for line in lines), Decimal("0.00"))
    return PricingSnapshot.model_validate(
        {"lines": lines, "total": _quantize_money(total), "currency": "RUB", "fair": request.fair}
    )
