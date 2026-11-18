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
    """DR43: a VSE tariff is area-scoped; no species input is honoured."""
    return validation_error(
        [
            ProblemItem(
                path="product_species_id",
                field_id="VSE",
                message=(
                    "Тариф услуги ВСЭ настраивается на всю категорию «Мясо и мясопродукты»: "
                    "вид продукции в тариф не входит и не сохраняется."
                ),
            )
        ]
    )


def _tariff_scope(payload: TariffWrite) -> tuple[UUID | None, str | None]:
    """Code-aware scope of a tariff write (owner decision DR43).

    CHECK codes (the two paid reconciliation services) keep the laboratory
    scope: species NULL, area NULL — any provided species is NORMALIZED to
    NULL. Every other service code (VSE) is saved in EXACTLY the area scope:
    ``product_area_code = 'meat'``, species NULL — the party species never
    enters the pricing key, so a species input is never persisted (and the old
    DR13 rule «вид продукции не может совпадать с лабораторией» cannot even
    arise: no species is stored for a VSE tariff).
    """
    if payload.service_code in CHECK_SERVICE_CODES:
        return None, None
    return None, MEAT_AREA_CODE


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


def _area_filter(area: str | None):  # noqa: ANN201 - column expression
    """The area term of a tariff scope: NULL for CHECK, the code for VSE."""
    return Tariff.product_area_code.is_(None) if area is None else (Tariff.product_area_code == area)


async def create_tariff(db: AsyncSession, payload: TariffWrite) -> Tariff:
    species, area = _tariff_scope(payload)
    existing = (
        await db.execute(
            select(Tariff).where(
                Tariff.laboratory_id == payload.laboratory_id,
                _species_filter(species),
                _area_filter(area),
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
        product_area_code=area,
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
    species, area = _tariff_scope(payload)
    conflict = (
        await db.execute(
            select(Tariff).where(
                Tariff.laboratory_id == payload.laboratory_id,
                _species_filter(species),
                _area_filter(area),
                Tariff.service_code == payload.service_code,
                Tariff.unit_id == payload.unit_id,
                Tariff.id != row.id,
            )
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise _already_exists("Тариф для этой области, кода и единицы уже существует.")
    row.product_species_id = species
    row.product_area_code = area
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


_CLASSIFICATION_LOCK_KEY = 49_2026_11_18


async def create_classification_version(db: AsyncSession, payload: ClassificationWrite) -> list[ReportClassification]:
    """Write the whole classification map atomically as the ONLY version.

    DR49 §2.6: under one transaction-scoped advisory lock the whole new set is
    validated, ALL rows of ALL previous versions are deleted and the new set is
    inserted — readers never observe an intermediate «0 versions» state, and
    two concurrent POSTs serialize (after commit exactly one whole version
    exists, never a mix of rows). The runtime key stays the stable GUID; the
    Russian name never enters the mapping (only the write DTO validation).
    """
    await db.execute(
        select(func.pg_advisory_xact_lock(_CLASSIFICATION_LOCK_KEY))  # type: ignore[attr-defined]
    )
    await db.execute(delete(ReportClassification))
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


async def load_classification_row(db: AsyncSession, row_id: object) -> ReportClassification | None:
    statement = select(ReportClassification).where(ReportClassification.id == row_id)
    return (await db.execute(statement)).scalar_one_or_none()


async def classification_rows(db: AsyncSession, version: str) -> list[ReportClassification]:
    """The ordered rows of one stored version (replay projection)."""
    return list(
        (
            await db.execute(
                select(ReportClassification)
                .where(ReportClassification.version == version)
                .order_by(ReportClassification.mercury_species_id)
            )
        ).scalars()
    )


async def delete_classification_version(db: AsyncSession, version: str) -> int:
    counted = await db.execute(
        select(func.count()).select_from(ReportClassification).where(ReportClassification.version == version)
    )
    count = int(counted.scalar_one())
    if count:
        await db.execute(delete(ReportClassification).where(ReportClassification.version == version))
    return count
