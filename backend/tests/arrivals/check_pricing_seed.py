"""Shared ТЗ DR11/DR14 seeding: tariffs of an exact scope + CheckServiceRule rows.

Every helper is idempotent: the shared fixtures (``vet_env``, ``lab``) seed
the default scope once, and a test may refine it further without violating
the tariff unique key or the global rule uniqueness.

Owner decision DR14: CHECK tariffs are scoped by the laboratory ONLY — the
seeded CHECK tariffs carry NO product species (NULL), so a price applies to
reconciliations of every species of the laboratory.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.catalog_pricing.models import CheckServiceRule, Tariff

CHECK_RULE_SOURCE = {"name": "Приказ о платных услугах сверки"}
TARIFF_SOURCE = {"name": "Прейскурант платных услуг"}

IDENTIFICATION_PRICE = "100.00"
TRANSPORT_PRICE = "130.00"


async def seed_check_pricing(
    db: AsyncSession,
    laboratory_id: uuid.UUID,
    species: uuid.UUID | None = None,
    *,
    identification_price: str | None = IDENTIFICATION_PRICE,
    transport_price: str | None = TRANSPORT_PRICE,
    rules: dict[str, dict[str, object]] | None = None,
) -> None:
    """Laboratory-scoped CHECK tariffs + the global CheckServiceRule rows.

    ``species`` is accepted for call-site compatibility and is NEVER persisted:
    the CHECK scope is laboratory + service code only (owner decision DR14).
    ``rules`` maps a service code to its ``multiplier_basis`` /
    ``applicable_decisions`` / ``unit_id``; when None the rules are left
    unconfigured (the live default — the honest ONE_SERVICE lineage mark).
    Existing rows of the same key are left untouched, so fixture-level and
    test-level seeding never conflict.
    """
    for code, price in (("PRODUCT_IDENTIFICATION", identification_price), ("TRANSPORT_INSPECTION", transport_price)):
        if price is None:
            continue
        existing = (
            await db.execute(
                select(Tariff).where(
                    Tariff.laboratory_id == laboratory_id,
                    Tariff.product_species_id.is_(None),
                    Tariff.service_code == code,
                    Tariff.unit_id == "RUB",
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                Tariff(
                    laboratory_id=laboratory_id,
                    product_species_id=None,
                    service_code=code,
                    unit_id="RUB",
                    price=Decimal(price),
                    version=1,
                    source=TARIFF_SOURCE,
                )
            )
    for code, rule in (rules or {}).items():
        existing = (
            await db.execute(select(CheckServiceRule).where(CheckServiceRule.service_code == code))
        ).scalar_one_or_none()
        if existing is not None:
            continue
        db.add(
            CheckServiceRule(
                service_code=code,
                unit_id=str(rule.get("unit_id", "kg")),
                multiplier_basis=str(rule.get("multiplier_basis", "ONE_SERVICE")),
                applicable_decisions=list(rule.get("applicable_decisions", ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"])),  # type: ignore[arg-type]
                version=1,
                source=CHECK_RULE_SOURCE,
            )
        )
