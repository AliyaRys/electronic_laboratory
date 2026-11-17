"""Catalog mutation commands: strictly scoped editors (API-03).

Commands receive an open session and never commit (the router coordinates the
transaction). Revision discipline follows SPEC-04/API-01: create claims an
idempotency record, update enforces If-Match, delete is idempotent. A new
method version deactivates the previous active row for the same applicability
key вЂ” exactly one active version (DATA-04); deleting an active catalog row
never touches saved working snapshots (ADR-020).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError, ProblemItem, validation_error
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.mandatory import (
    MANUAL_SOURCE_NAME,
    MEAT_AREA_CODE,
    CatalogIndicatorDef,
)
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
from backend.src.modules.catalog_pricing.service import CHECK_SERVICE_CODES

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


def _tariff_species_problem() -> ProblemError:
    """Owner decision DR14: VSE tariffs keep the species binding."""
    return validation_error(
        [
            ProblemItem(
                path="product_species_id",
                field_id="VSE",
                message="Тариф услуги ВСЭ требует вид продукции: выберите вид в контексте справочника.",
            )
        ]
    )


def _species_scope_problem() -> ProblemError:
    """ТЗ DR13: a laboratory UUID is never a product species (tariffs)."""
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


def _tariff_species(payload: TariffWrite) -> UUID | None:
    """Code-aware species scope of a tariff write (owner decision DR14).

    CHECK codes (the two paid reconciliation services) never carry a species:
    an absent one is accepted and any provided species is NORMALIZED to NULL —
    a species is never persisted for a CHECK tariff. Every other service code
    (VSE) requires the species as before, and the DR13 rule stays honest: a
    laboratory UUID is never a product species, so a VSE write with
    ``product_species_id == laboratory_id`` is refused.
    """
    if payload.service_code in CHECK_SERVICE_CODES:
        return None
    if payload.product_species_id is None:
        raise _tariff_species_problem()
    if payload.product_species_id == payload.laboratory_id:
        raise _species_scope_problem()
    return payload.product_species_id


def _method_definition(payload: MethodRuleWrite) -> CatalogIndicatorDef:
    """Resolve the canonical definition of a stable VSE-F code (DR31 §8.4).

    An unknown code is refused without creating an arbitrary indicator; the
    result schema and unit of the norm always come from the canonical
    registry, never from the client.
    """
    try:
        return _mandatory.indicator_by_code(payload.code)
    except LookupError as error:
        raise validation_error(
            [
                ProblemItem(
                    path="code",
                    field_id="CHECK",
                    message=str(error),
                )
            ]
        ) from None


def _refuse_fixed_or_none(definition: CatalogIndicatorDef) -> None:
    """ТЗ DR41-B §6.4: POST/PUT of a norm for a FIXED/NONE indicator is an
    honest 422 — the fixed FT rules are not catalog rows and a free-text
    research has no norm at all."""
    if definition.evaluation_mode == "FIXED":
        raise validation_error(
            [
                ProblemItem(
                    path="code",
                    field_id=definition.code,
                    message=(
                        f"Норма исследования «{definition.name}» ({definition.code}) фиксирована методикой ФТ "
                        "и не настраивается в справочнике."
                    ),
                )
            ]
        )
    if definition.evaluation_mode == "NONE":
        raise validation_error(
            [
                ProblemItem(
                    path="code",
                    field_id=definition.code,
                    message=(
                        f"Исследование «{definition.name}» ({definition.code}) не имеет нормы: "
                        "результат вводится текстом без оценки нормы."
                    ),
                )
            ]
        )


def _validate_rule_shape(definition: CatalogIndicatorDef, payload: MethodRuleWrite) -> None:
    """Server-side typed validation (DR31 §8.4): the rule shape must match the
    canonical result schema of the indicator — never the client's claim."""
    interval_schemas = {"DECIMAL", "INTEGER_NONNEGATIVE", "DOSIMETRY_PAIR"}
    qualitative_schemas = {"ENUM", "TEXT", "BOOLEAN_MATCH"}
    is_interval = payload.rule.type == "interval"
    expected_interval = definition.result_schema in interval_schemas
    expected_qualitative = definition.result_schema in qualitative_schemas
    if expected_interval and not is_interval or expected_qualitative and is_interval:
        raise validation_error(
            [
                ProblemItem(
                    path="rule.type",
                    field_id=definition.code,
                    message="Тип нормы не соответствует каноническому типу результата исследования.",
                )
            ]
        )


async def create_method_rule(db: AsyncSession, payload: MethodRuleWrite) -> MethodRule:
    """Insert a new active meat-area version, retiring the previous active one.

    The applicability key is ``laboratory + meat + indicator``: the species and
    state columns are left NULL and are never written as scope (DR31 §8.1).
    The version and the provenance source are server-side data.
    """
    definition = _method_definition(payload)
    _refuse_fixed_or_none(definition)
    _validate_rule_shape(definition, payload)
    previous = (
        (
            await db.execute(
                select(MethodRule)
                .where(
                    MethodRule.laboratory_id == payload.laboratory_id,
                    MethodRule.product_area_code == MEAT_AREA_CODE,
                    MethodRule.indicator_id == definition.id,
                    MethodRule.active,
                )
                .order_by(MethodRule.version.desc())
            )
        )
        .scalars()
        .all()
    )
    version = (previous[0].version + 1) if previous else 1
    for row in previous:
        row.active = False
    row = MethodRule(
        laboratory_id=payload.laboratory_id,
        product_area_code=MEAT_AREA_CODE,
        indicator_id=definition.id,
        version=version,
        result_schema=definition.result_schema,
        unit_id=definition.unit or "",
        rule=dict(payload.rule.model_dump()),
        source={"name": MANUAL_SOURCE_NAME},
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
    """Edit the row in place; the version history stays intact (DR31 §8.4).

    The result schema and unit are re-resolved from the canonical registry; a
    code switch that would move the row to another indicator is refused — a
    norm row stays the norm of its indicator.
    """
    definition = _method_definition(payload)
    _refuse_fixed_or_none(definition)
    _validate_rule_shape(definition, payload)
    if definition.id != row.indicator_id:
        raise validation_error(
            [
                ProblemItem(
                    path="code",
                    field_id=definition.code,
                    message="Норма остаётся нормой своего показателя: код исследования менять нельзя.",
                )
            ]
        )
    row.result_schema = definition.result_schema
    row.unit_id = definition.unit or ""
    row.rule = dict(payload.rule.model_dump())
    row.source = {"name": MANUAL_SOURCE_NAME}
    row.effective_from = None
    row.rev += 1
    await db.flush()
    return row


async def delete_method_rule(db: AsyncSession, row: MethodRule) -> None:
    await db.delete(row)
    await db.flush()


def _species_filter(species: UUID | None):  # noqa: ANN201 - column expression
    """The species term of a tariff scope: NULL for CHECK, the id for VSE."""
    return Tariff.product_species_id.is_(None) if species is None else (Tariff.product_species_id == species)


async def create_tariff(db: AsyncSession, payload: TariffWrite) -> Tariff:
    species = _tariff_species(payload)
    existing = (
        await db.execute(
            select(Tariff).where(
                Tariff.laboratory_id == payload.laboratory_id,
                _species_filter(species),
                Tariff.service_code == payload.service_code,
                Tariff.unit_id == payload.unit_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise _already_exists("Тариф для этой области, кода и единицы уже существует.")
    row = Tariff(
        laboratory_id=payload.laboratory_id,
        product_species_id=species,
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
    species = _tariff_species(payload)
    conflict = (
        await db.execute(
            select(Tariff).where(
                Tariff.laboratory_id == payload.laboratory_id,
                _species_filter(species),
                Tariff.service_code == payload.service_code,
                Tariff.unit_id == payload.unit_id,
                Tariff.id != row.id,
            )
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise _already_exists("Тариф для этой области, кода и единицы уже существует.")
    row.product_species_id = species
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
