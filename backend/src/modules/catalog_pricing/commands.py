"""Catalog mutation commands: strictly scoped editors (API-03).

Commands receive an open session and never commit (the router coordinates the
transaction). Revision discipline follows SPEC-04/API-01: create claims an
idempotency record, update enforces If-Match, delete is idempotent. A new
method version deactivates the previous active row for the same applicability
key вЂ” exactly one active version (DATA-04); deleting an active catalog row
never touches saved working snapshots (ADR-020).
"""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError, ProblemItem, validation_error
from backend.src.modules.catalog_pricing.models import (
    CheckServiceRule,
    MethodRule,
    ReportClassification,
    Tariff,
)
from backend.src.modules.catalog_pricing.schemas import (
    CheckServiceRuleWrite,
    ClassificationWrite,
    MethodRuleWrite,
    TariffWrite,
    parse_decimal,
)

__all__ = [
    "create_method_rule",
    "update_method_rule",
    "delete_method_rule",
    "load_method_rule",
    "create_tariff",
    "update_tariff",
    "delete_tariff",
    "load_tariff",
    "create_check_service_rule",
    "update_check_service_rule",
    "delete_check_service_rule",
    "load_check_service_rule",
    "create_classification_version",
    "delete_classification_version",
]


def _already_exists(detail: str) -> ProblemError:
    return ProblemError(status=409, code="ALREADY_EXISTS", title="Already exists", detail=detail)


def _species_scope_problem() -> ProblemError:
    """ТЗ DR13: a laboratory UUID is never a product species.

    The scope fallback of legacy assignments could seed ``product_species_id``
    with the laboratory id; a tariff saved into that scope can never match a
    real party species, so the write is refused honestly instead of storing a
    price that is unreachable for pricing.
    """
    return validation_error(
        [
            ProblemItem(
                path="product_species_id",
                field_id="CHECK",
                message=(
                    "Вид продукции не может совпадать с лабораторией: выберите реальный вид продукции "
                    "в контексте справочника."
                ),
            )
        ]
    )


def _validate_species_scope(payload: TariffWrite | MethodRuleWrite) -> None:
    if payload.product_species_id == payload.laboratory_id:
        raise _species_scope_problem()


async def create_method_rule(db: AsyncSession, payload: MethodRuleWrite) -> MethodRule:
    """Insert a new active version, retiring the previous active one."""
    _validate_species_scope(payload)
    previous = await db.execute(
        select(MethodRule).where(
            MethodRule.laboratory_id == payload.laboratory_id,
            MethodRule.product_species_id == payload.product_species_id,
            MethodRule.product_state_id == payload.product_state_id,
            MethodRule.indicator_id == payload.indicator_id,
            MethodRule.active,
        )
    )
    for row in previous.scalars():
        row.active = False
    row = MethodRule(
        laboratory_id=payload.laboratory_id,
        product_species_id=payload.product_species_id,
        product_state_id=payload.product_state_id,
        indicator_id=payload.indicator_id,
        version=payload.version,
        result_schema=payload.result_schema.value,
        unit_id=payload.unit_id,
        rule=dict(payload.rule.model_dump()),
        source=dict(payload.source.model_dump()),
        active=True,
    )
    db.add(row)
    await db.flush()
    return row


async def load_method_rule(db: AsyncSession, rule_id: object, *, lock: bool = False) -> MethodRule | None:
    statement = select(MethodRule).where(MethodRule.id == rule_id)
    if lock:
        statement = statement.with_for_update()  # SPEC-04: lock before revision check
    return (await db.execute(statement)).scalar_one_or_none()


async def update_method_rule(db: AsyncSession, row: MethodRule, payload: MethodRuleWrite) -> MethodRule:
    """Edit the row in place; the version history stays intact."""
    _validate_species_scope(payload)
    row.result_schema = payload.result_schema.value
    row.unit_id = payload.unit_id
    row.rule = dict(payload.rule.model_dump())
    row.source = dict(payload.source.model_dump())
    row.effective_from = None
    row.rev += 1
    await db.flush()
    return row


async def delete_method_rule(db: AsyncSession, row: MethodRule) -> None:
    await db.delete(row)
    await db.flush()


async def create_tariff(db: AsyncSession, payload: TariffWrite) -> Tariff:
    _validate_species_scope(payload)
    existing = (
        await db.execute(
            select(Tariff).where(
                Tariff.laboratory_id == payload.laboratory_id,
                Tariff.product_species_id == payload.product_species_id,
                Tariff.service_code == payload.service_code,
                Tariff.unit_id == payload.unit_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise _already_exists("Тариф для этой области, кода и единицы уже существует.")
    row = Tariff(
        laboratory_id=payload.laboratory_id,
        product_species_id=payload.product_species_id,
        service_code=payload.service_code,
        unit_id=payload.unit_id,
        price=payload.price,
        version=payload.version,
        source=dict(payload.source.model_dump()),
    )
    db.add(row)
    await db.flush()
    return row


async def load_tariff(db: AsyncSession, tariff_id: object, *, lock: bool = False) -> Tariff | None:
    statement = select(Tariff).where(Tariff.id == tariff_id)
    if lock:
        statement = statement.with_for_update()  # SPEC-04: lock before revision check
    return (await db.execute(statement)).scalar_one_or_none()


async def update_tariff(db: AsyncSession, row: Tariff, payload: TariffWrite) -> Tariff:
    _validate_species_scope(payload)
    conflict = (
        await db.execute(
            select(Tariff).where(
                Tariff.laboratory_id == payload.laboratory_id,
                Tariff.product_species_id == payload.product_species_id,
                Tariff.service_code == payload.service_code,
                Tariff.unit_id == payload.unit_id,
                Tariff.id != row.id,
            )
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise _already_exists("Тариф для этой области, кода и единицы уже существует.")
    row.service_code = payload.service_code
    row.unit_id = payload.unit_id
    row.price = parse_decimal(payload.price)
    row.version = payload.version
    row.source = dict(payload.source.model_dump())
    row.rev += 1
    await db.flush()
    return row


async def delete_tariff(db: AsyncSession, row: Tariff) -> None:
    await db.delete(row)
    await db.flush()


async def create_check_service_rule(db: AsyncSession, payload: CheckServiceRuleWrite) -> CheckServiceRule:
    existing = (
        await db.execute(select(CheckServiceRule).where(CheckServiceRule.service_code == payload.service_code))
    ).scalar_one_or_none()
    if existing is not None:
        raise _already_exists("Правило для этой услуги уже существует.")
    row = CheckServiceRule(
        service_code=payload.service_code,
        unit_id=payload.unit_id,
        multiplier_basis=payload.multiplier_basis,
        applicable_decisions=list(payload.applicable_decisions),
        version=payload.version,
        source=dict(payload.source.model_dump()),
    )
    db.add(row)
    await db.flush()
    return row


async def load_check_service_rule(db: AsyncSession, rule_id: object, *, lock: bool = False) -> CheckServiceRule | None:
    statement = select(CheckServiceRule).where(CheckServiceRule.id == rule_id)
    if lock:
        statement = statement.with_for_update()  # SPEC-04: lock before revision check
    return (await db.execute(statement)).scalar_one_or_none()


async def update_check_service_rule(
    db: AsyncSession, row: CheckServiceRule, payload: CheckServiceRuleWrite
) -> CheckServiceRule:
    conflict = (
        await db.execute(
            select(CheckServiceRule).where(
                CheckServiceRule.service_code == payload.service_code, CheckServiceRule.id != row.id
            )
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise _already_exists("Правило для этой услуги уже существует.")
    row.service_code = payload.service_code
    row.unit_id = payload.unit_id
    row.multiplier_basis = payload.multiplier_basis
    row.applicable_decisions = list(payload.applicable_decisions)
    row.version = payload.version
    row.source = dict(payload.source.model_dump())
    row.rev += 1
    await db.flush()
    return row


async def delete_check_service_rule(db: AsyncSession, row: CheckServiceRule) -> None:
    await db.delete(row)
    await db.flush()


async def create_classification_version(db: AsyncSession, payload: ClassificationWrite) -> list[ReportClassification]:
    """Write a whole classification map version atomically (INPUT-05).

    Existing rows of the version are locked first, so a concurrent rewrite of
    the same version serializes instead of silently overwriting (SPEC-04).
    """
    await db.execute(
        select(ReportClassification).where(ReportClassification.version == payload.version).with_for_update()
    )
    await db.execute(delete(ReportClassification).where(ReportClassification.version == payload.version))
    rows = [
        ReportClassification(
            version=payload.version,
            mercury_species_id=item.mercury_species_id,
            product_type_id=item.product_type_id,
            product_state_id=item.product_state_id,
            supported=item.supported,
            animal_column=item.animal_column,
            material_kind=item.material_kind,
        )
        for item in payload.items
    ]
    db.add_all(rows)
    await db.flush()
    return rows


async def delete_classification_version(db: AsyncSession, version: str) -> int:
    counted = await db.execute(
        select(func.count()).select_from(ReportClassification).where(ReportClassification.version == version)
    )
    count = int(counted.scalar_one())
    if count:
        await db.execute(delete(ReportClassification).where(ReportClassification.version == version))
    return count
