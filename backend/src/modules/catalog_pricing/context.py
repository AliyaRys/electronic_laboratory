"""Scoped methods-catalog read model (DR28 §7, variant B).

The page never guesses the working scope: the backend resolves the honest
server-side mapping of one human-readable product area onto real internal
identifiers and returns the FULL VSE-F18–F29 indicator list together with the
active rules and the still-missing indicators.

Scope mapping (DATA SAFETY DR28 §3/§5.4/§11 — nothing is invented):

- area ``meat`` («Мясо и мясопродукты») covers the allowed classification read
  model rows ``MercuryProductGuidLvl2`` with ``product_type = 1`` (Meat and
  meat products), active and last per contour. The species GUID and its
  Russian name are real dictionary data — never the laboratory UUID, never a
  test scope, never the first incoming VSD.
- ``product_state_id`` is the stable ``subProduct`` level of the party
  classification: the distinct subProduct refs observed in the parties of the
  SAME laboratory for the chosen species. A state without real observations
  cannot be enumerated, so an empty list is an honest configuration screen,
  never a fabricated UUID.

No default values, no 0/empty/«Норма» placeholders and no norms are ever
created here — the module only reads.
"""

from __future__ import annotations

import uuid
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import Party
from backend.src.modules.catalog_pricing import mandatory as _mandatory
from backend.src.modules.catalog_pricing.models import MethodRule
from backend.src.modules.catalog_pricing.queries import method_rule_view
from backend.src.modules.catalog_pricing.schemas import MethodRuleView
from backend.src.modules.identity.models import Laboratory
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2

__all__ = [
    "MEAT_AREA_CODE",
    "MEAT_AREA_NAME",
    "AREAS",
    "MethodsContext",
    "methods_context",
    "meat_area_configured",
]

MEAT_AREA_CODE = "meat"
MEAT_AREA_NAME = "Мясо и мясопродукты"
# Mercury product type 1 is «Мясо и мясопродукты» (the supported MVP area).
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


class CatalogScopeId(BaseModel):
    """One internal scope id with its human-readable label (never a bare GUID)."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    label: str
    requires_trichinelloscopy: bool = False


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
    species_options: list[CatalogScopeId]
    states: list[CatalogScopeId]
    product_species: CatalogScopeId | None = None
    product_state: CatalogScopeId | None = None
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


def _sub_product_label(name: Any) -> str:
    """Honest human-readable label of one subProduct ref (never a bare GUID)."""
    if isinstance(name, str) and name.strip():
        return name.strip()
    return "Название состояния продукции недоступно"


async def meat_area_configured(db: AsyncSession) -> bool:
    """The meat area exists when the allowed classification read model has
    real meat dictionary rows; nothing is ever fabricated as a fallback."""
    row = (
        await db.execute(
            select(MercuryProductGuidLvl2.guid)
            .where(
                MercuryProductGuidLvl2.product_type == MEAT_PRODUCT_TYPE,
                MercuryProductGuidLvl2.active.is_(True),
                MercuryProductGuidLvl2.is_last.is_(True),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


async def _species_options(db: AsyncSession) -> list[CatalogScopeId]:
    """Allowed meat species of the classification read model, named in Russian."""
    rows = (
        await db.execute(
            select(
                MercuryProductGuidLvl2.guid,
                MercuryProductGuidLvl2.name,
                MercuryProductGuidLvl2.requires_trichinelloscopy,
            )
            .where(
                MercuryProductGuidLvl2.product_type == MEAT_PRODUCT_TYPE,
                MercuryProductGuidLvl2.active.is_(True),
                MercuryProductGuidLvl2.is_last.is_(True),
            )
            .order_by(MercuryProductGuidLvl2.name)
        )
    ).all()
    by_guid: dict[UUID, CatalogScopeId] = {}
    for guid, name, trichinella in rows:
        if guid in by_guid:
            continue
        by_guid[guid] = CatalogScopeId(id=guid, label=name.strip(), requires_trichinelloscopy=bool(trichinella))
    return sorted(by_guid.values(), key=lambda item: item.label)


async def _observed_states(db: AsyncSession, laboratory_id: UUID, species_id: UUID) -> list[CatalogScopeId]:
    """The distinct subProduct refs of THIS laboratory's parties for the species.

    Party data is the only real state source: a state id that no real party
    carries is never invented, and ids of other laboratories or the test scope
    are never reused (DR28 §5.4).
    """
    snapshots = (
        (
            await db.execute(
                select(Party.classification_snapshot).where(
                    Party.laboratory_id == laboratory_id,
                    Party.classification_snapshot["product"]["id"].astext == str(species_id),
                )
            )
        )
        .scalars()
        .all()
    )
    by_id: dict[UUID, CatalogScopeId] = {}
    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            continue
        sub = snapshot.get("subProduct")
        if not isinstance(sub, dict):
            continue
        raw_id = sub.get("id")
        if raw_id is None:
            continue
        try:
            state_id = uuid.UUID(str(raw_id))
        except ValueError:
            continue
        if state_id in by_id:
            continue
        by_id[state_id] = CatalogScopeId(id=state_id, label=_sub_product_label(sub.get("name")))
    return sorted(by_id.values(), key=lambda item: item.label)


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
    product_species_id: UUID | None,
    product_state_id: UUID | None,
) -> MethodsContext:
    """Build the scoped editor context for one laboratory and product area.

    An unknown or unconfigured area, an unknown species and an empty observed
    state set are honest 409 CONFIGURATION_MISSING answers: the frontend never
    mistakes them for an empty catalog and never falls back to the laboratory
    UUID or another scope's data.
    """
    if area_code not in AREAS:
        raise configuration_missing("Область продукции не поддерживается системой.")
    laboratory = (await db.execute(select(Laboratory).where(Laboratory.id == laboratory_id))).scalar_one_or_none()
    if laboratory is None:
        raise configuration_missing("Лаборатория не найдена в системе.")
    if product_species_id == laboratory_id:
        # The legacy DR13 fallback: a laboratory UUID is NEVER a product
        # species (§5.1, mirror of the commands.py write guard).
        raise configuration_missing("Вид продукции не относится к назначенным областям лаборатории.")

    configured = await meat_area_configured(db)
    areas = [CatalogAreaOption(code=code, name=name, configured=configured) for code, name in AREAS.items()]
    species_options = await _species_options(db) if configured else []
    if not species_options:
        # No real dictionary mapping: the honest blocking configuration state —
        # never an empty catalog and never a fabricated species (§5.4/§11).
        raise configuration_missing(
            "Вид продукции и состояние продукции не настроены для этой лаборатории. "
            "Требуется назначение рабочей области продукции ответственным администратором."
        )

    product_species: CatalogScopeId | None = None
    states: list[CatalogScopeId] = []
    product_state: CatalogScopeId | None = None
    if product_species_id is not None:
        product_species = next((item for item in species_options if item.id == product_species_id), None)
        if product_species is None:
            raise configuration_missing("Вид продукции не относится к назначенным областям лаборатории.")
        states = await _observed_states(db, laboratory_id, product_species.id)
        if not states:
            # A state without real observations cannot be enumerated — the
            # honest configuration screen, never a fabricated UUID (§5.3).
            raise configuration_missing(
                "Состояние продукции не настроено: для выбранного вида нет наблюдаемых состояний. "
                "Требуется назначение рабочей области продукции ответственным администратором."
            )
        if product_state_id is not None:
            product_state = next((item for item in states if item.id == product_state_id), None)
            if product_state is None:
                raise configuration_missing(
                    "Состояние продукции не относится к наблюдаемым состояниям этой лаборатории."
                )
        elif len(states) == 1:
            product_state = states[0]
    elif len(species_options) == 1:
        # Exactly one species: it is selected automatically, its Russian name
        # is still shown (DR28 §5.2).
        product_species = species_options[0]
        states = await _observed_states(db, laboratory_id, product_species.id)
        if not states:
            raise configuration_missing(
                "Состояние продукции не настроено: для выбранного вида нет наблюдаемых состояний. "
                "Требуется назначение рабочей области продукции ответственным администратором."
            )
        if len(states) == 1:
            product_state = states[0]

    rules: list[MethodRuleView] = []
    missing: list[UUID] = []
    if product_species is not None and product_state is not None:
        rows = (
            (
                await db.execute(
                    select(MethodRule)
                    .where(
                        MethodRule.laboratory_id == laboratory_id,
                        MethodRule.product_species_id == product_species.id,
                        MethodRule.product_state_id == product_state.id,
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
        areas=areas,
        species_options=species_options,
        states=states,
        product_species=product_species,
        product_state=product_state,
        indicators=_indicator_catalog(),
        active_rules=rules,
        missing=missing,
    )
