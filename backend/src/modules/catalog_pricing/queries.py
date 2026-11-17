"""Catalog reads: stable pages, views and readiness (API-03).

Lists are ordered deterministically and scoped to the requested laboratory;
``readiness`` reports the missing configuration inputs for one laboratory and
product species without ever guessing values.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.mandatory import MEAT_AREA_CODE
from backend.src.modules.catalog_pricing.models import (
    CheckServiceRule,
    MethodRule,
    ReportClassification,
    Tariff,
)
from backend.src.modules.catalog_pricing.schemas import (
    CheckServiceRuleView,
    ClassificationItemView,
    MethodRuleView,
    Readiness,
    ReadinessMissing,
    TariffView,
)

__all__ = [
    "PAGE_SIZE",
    "method_rule_page",
    "tariff_page",
    "check_service_rule_page",
    "classification_page",
    "method_rule_view",
    "tariff_view",
    "check_service_rule_view",
    "classification_view",
    "readiness",
]

PAGE_SIZE = 20


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def method_rule_view(row: MethodRule) -> MethodRuleView:
    return MethodRuleView.model_validate(
        {
            "id": row.id,
            "laboratory_id": row.laboratory_id,
            "product_area_code": row.product_area_code,
            "indicator_id": row.indicator_id,
            "version": row.version,
            "result_schema": row.result_schema,
            "unit_id": row.unit_id,
            "rule": row.rule,
            "source": row.source,
            "effective_from": _iso(row.effective_from),
            "active": row.active,
            "revision": row.rev,
            "product_species_id": row.product_species_id,
            "product_state_id": row.product_state_id,
        }
    )


def tariff_view(row: Tariff) -> TariffView:
    return TariffView.model_validate(
        {
            "id": row.id,
            "laboratory_id": row.laboratory_id,
            "product_species_id": row.product_species_id,
            "product_area_code": row.product_area_code,
            "service_code": row.service_code,
            "unit_id": row.unit_id,
            "price": str(row.price),
            "version": row.version,
            "source": row.source,
            "revision": row.rev,
        }
    )


def check_service_rule_view(row: CheckServiceRule) -> CheckServiceRuleView:
    return CheckServiceRuleView.model_validate(
        {
            "id": row.id,
            "service_code": row.service_code,
            "unit_id": row.unit_id,
            "multiplier_basis": row.multiplier_basis,
            "applicable_decisions": row.applicable_decisions,
            "version": row.version,
            "source": row.source,
            "revision": row.rev,
        }
    )


def classification_view(row: ReportClassification) -> ClassificationItemView:
    return ClassificationItemView.model_validate(
        {
            "id": row.id,
            "version": row.version,
            "mercury_species_id": row.mercury_species_id,
            "product_type_id": row.product_type_id,
            "product_state_id": row.product_state_id,
            "supported": row.supported,
            "animal_column": row.animal_column,
            "material_kind": row.material_kind,
            "revision": row.rev,
        }
    )


def _page(items: list[Any], total: int, page: int) -> tuple[list[Any], int, int, int]:
    return items, total, page, PAGE_SIZE


async def method_rule_page(db: AsyncSession, laboratory_id: UUID, page: int) -> tuple[list[MethodRuleView], int]:
    """The method-rule page of one laboratory's meat catalog (DR31 §9).

    The scope is the laboratory and the product area only: species/state GUIDs
    are not part of the key and are never used to filter or group the rows.
    """
    meat_term = (MethodRule.laboratory_id == laboratory_id) & (MethodRule.product_area_code == MEAT_AREA_CODE)
    scope = select(func.count()).select_from(MethodRule).where(meat_term)
    total = int((await db.execute(scope)).scalar_one())
    rows = (
        (
            await db.execute(
                select(MethodRule)
                .where(meat_term)
                .order_by(MethodRule.active.desc(), MethodRule.indicator_id, MethodRule.version.desc(), MethodRule.id)
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            )
        )
        .scalars()
        .all()
    )
    return [method_rule_view(row) for row in rows], total


async def tariff_page(
    db: AsyncSession, laboratory_id: UUID, product_area_code: str | None, page: int
) -> tuple[list[TariffView], int]:
    """Tariff page of one scope (API-03, owner decision DR43).

    ``product_area_code`` selects the VSE tariffs of that product area (one
    price per category — no species term exists any more); ``None`` keeps
    listing the laboratory-scoped CHECK tariffs (species NULL, area NULL) of
    the «Платные услуги» directory.
    """
    area_term = (
        Tariff.product_area_code.is_(None)
        if product_area_code is None
        else (Tariff.product_area_code == product_area_code)
    )
    scope = select(func.count()).select_from(Tariff).where(Tariff.laboratory_id == laboratory_id, area_term)
    total = int((await db.execute(scope)).scalar_one())
    rows = (
        (
            await db.execute(
                select(Tariff)
                .where(Tariff.laboratory_id == laboratory_id, area_term)
                .order_by(Tariff.service_code, Tariff.unit_id, Tariff.id)
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            )
        )
        .scalars()
        .all()
    )
    return [tariff_view(row) for row in rows], total


async def check_service_rule_page(db: AsyncSession, page: int) -> tuple[list[CheckServiceRuleView], int]:
    total = int((await db.execute(select(func.count()).select_from(CheckServiceRule))).scalar_one())
    rows = (
        (
            await db.execute(
                select(CheckServiceRule)
                .order_by(CheckServiceRule.service_code)
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            )
        )
        .scalars()
        .all()
    )
    return [check_service_rule_view(row) for row in rows], total


async def classification_page(
    db: AsyncSession, version: str | None, page: int
) -> tuple[list[ClassificationItemView], int]:
    scope = select(func.count()).select_from(ReportClassification)
    if version is not None:
        scope = scope.where(ReportClassification.version == version)
    total = int((await db.execute(scope)).scalar_one())
    statement = select(ReportClassification).order_by(
        ReportClassification.version, ReportClassification.mercury_species_id
    )
    if version is not None:
        statement = statement.where(ReportClassification.version == version)
    rows = (await db.execute(statement.offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE))).scalars().all()
    return [classification_view(row) for row in rows], total


async def readiness(db: AsyncSession, laboratory_id: UUID, product_species_id: UUID | None = None) -> Readiness:
    """Report missing configuration inputs for the single meat set (DR31 §8.6).

    The mandatory F18–F20 researches need one active norm of the
    ``laboratory + meat`` scope — never one per species. The conditional F21
    (trichinelloscopy) is a PARTY-level rule decided by the four exact GUID
    groups during the examination evaluation; it is never demanded here for
    every species. A species (when the caller has one) only narrows the tariff
    checks, which stay outside this task's scope change.
    """
    missing: list[ReadinessMissing] = []

    for indicator in sorted(_mandatory.MANDATORY_INDICATOR_IDS, key=str):
        # ТЗ DR41-B §6.4: FIXED/NONE mandatory indicators do not require an
        # active MethodRule in readiness; the tariff check stays.
        definition = _mandatory.INDICATOR_BY_ID.get(indicator)
        requires_rule = definition is None or definition.evaluation_mode == "CONFIGURABLE"
        if requires_rule:
            rule = (
                await db.execute(
                    select(MethodRule.id).where(
                        MethodRule.laboratory_id == laboratory_id,
                        MethodRule.product_area_code == MEAT_AREA_CODE,
                        MethodRule.indicator_id == indicator,
                        MethodRule.active,
                    )
                )
            ).scalar_one_or_none()
            if rule is None:
                missing.append(
                    ReadinessMissing(
                        input_id=f"method:{indicator}",
                        field="method_rules",
                        message="Отсутствует действующая методика и норма обязательного показателя.",
                    )
                )
        # Price is independent from the clinical norm and its measurement
        # unit, and independent from the party species (DR43): the area tariff
        # of the laboratory covers every «Мясо и мясопродукты» position.
        tariff = (
            await db.execute(
                select(Tariff.id)
                .where(
                    Tariff.laboratory_id == laboratory_id,
                    Tariff.product_area_code == MEAT_AREA_CODE,
                    Tariff.service_code == str(indicator),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if tariff is None:
            missing.append(
                ReadinessMissing(
                    input_id=f"tariff:{indicator}",
                    field="tariffs",
                    message="Отсутствует тариф обязательного показателя.",
                )
            )

    # CHECK applicability rules are global single-row configuration; their
    # coverage is asserted by the C02 editor tests, not per-laboratory readiness.
    return Readiness(ready=not missing, missing=missing)
