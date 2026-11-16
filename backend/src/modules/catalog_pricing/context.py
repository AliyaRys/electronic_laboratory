"""The single meat-scope methods-catalog read model (DR31 §8.3).

The context of the «Нормы исследований» editor is resolved by the laboratory
and the product area ONLY: ``laboratory_id + product_area_code('meat')``. It
never reads ``MercuryProductGuidLvl2``, never inspects the observed subProduct
refs of the laboratory's parties and never accepts or returns species/state
identifiers. The catalog opens even with an empty Mercury dictionary and no
parties at all: the area is a system-owned category, not a Mercury mapping.

No default values, no 0/empty/«Норма» placeholders and no norms are ever
created here — the module only reads.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.models import MethodRule
from backend.src.modules.catalog_pricing.queries import method_rule_view
from backend.src.modules.catalog_pricing.schemas import MethodRuleView
from backend.src.modules.identity.models import Laboratory

__all__ = [
    "MEAT_AREA_CODE",
    "MEAT_AREA_NAME",
    "MEAT_PRODUCT_TYPE",
    "AREAS",
    "MethodsContext",
    "methods_context",
]

MEAT_AREA_CODE = _mandatory.MEAT_AREA_CODE
MEAT_AREA_NAME = _mandatory.MEAT_AREA_NAME
# Mercury product type 1 is «Мясо и мясопродукты» (the supported MVP area);
# it stays a classification fact of the incoming VSD filter, never the scope
# of a norm row.
MEAT_PRODUCT_TYPE = 1
AREAS: dict[str, str] = {MEAT_AREA_CODE: MEAT_AREA_NAME}


class CatalogAreaOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    name: str
    configured: bool


class _LaboratoryRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    name: str


class CatalogIndicator(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    code: str
    name: str
    result_schema: str
    unit_id: str | None = None
    mandatory: bool
    conditional: bool = False
    options: list[str] | None = None


class MethodsContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    laboratory: _LaboratoryRef
    areas: list[CatalogAreaOption]
    product_area_code: str
    product_area_name: str
    indicators: list[CatalogIndicator]
    active_rules: list[MethodRuleView]
    missing: list[UUID]


def configuration_missing(detail: str) -> ProblemError:
    return ProblemError(
        status=409,
        code="CONFIGURATION_MISSING",
        title="Configuration missing",
        detail=detail,
    )


def _indicator_catalog() -> list[CatalogIndicator]:
    return [
        CatalogIndicator(
            id=item.id,
            code=item.code,
            name=item.name,
            result_schema=item.result_schema,
            unit_id=item.unit,
            mandatory=item.mandatory,
            conditional=item.conditional,
            options=list(item.options) if item.options is not None else None,
        )
        for item in _mandatory.CATALOG_INDICATORS
    ]


async def methods_context(
    db: AsyncSession,
    laboratory_id: UUID,
    area_code: str,
) -> MethodsContext:
    """Build the editor context for one laboratory and the product area.

    An unknown area and an unknown laboratory are honest 409 answers; an empty
    Mercury dictionary or the absence of parties NEVER blocks the catalog —
    the meat area is system-owned (ТЗ DR31 §8.3).
    """
    if area_code not in AREAS:
        raise configuration_missing("Область продукции не поддерживается системой.")
    laboratory = (await db.execute(select(Laboratory).where(Laboratory.id == laboratory_id))).scalar_one_or_none()
    if laboratory is None:
        raise configuration_missing("Лаборатория не найдена в системе.")

    rows = (
        (
            await db.execute(
                select(MethodRule)
                .where(
                    MethodRule.laboratory_id == laboratory_id,
                    MethodRule.product_area_code == area_code,
                    MethodRule.active.is_(True),
                )
                .order_by(MethodRule.indicator_id, MethodRule.version.desc(), MethodRule.id)
            )
        )
        .scalars()
        .all()
    )
    rules = [method_rule_view(row) for row in rows]
    configured_indicators = {row.indicator_id for row in rules}
    missing = [item.id for item in _mandatory.CATALOG_INDICATORS if item.id not in configured_indicators]

    return MethodsContext(
        laboratory=_LaboratoryRef(id=laboratory.id, name=laboratory.name),
        areas=[CatalogAreaOption(code=code, name=name, configured=True) for code, name in AREAS.items()],
        product_area_code=area_code,
        product_area_name=AREAS[area_code],
        indicators=_indicator_catalog(),
        active_rules=rules,
        missing=missing,
    )
