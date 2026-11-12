"""Configuration ORM models (DATA-04).

Migration ``0004_catalog_pricing`` is the source of truth for the DDL; these
models mirror it. Configuration rows are referenced by no working record
directly: pricing produces independent JSONB snapshots, so deleting a catalog
row never cascades into a saved snapshot (ADR-020).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = [
    "MethodRule",
    "Tariff",
    "CheckServiceRule",
    "MultiplierBasis",
    "ReportClassification",
    "BulkPriceJob",
    "BulkPriceTarget",
    "BulkPriceState",
]


class MultiplierBasis(StrEnum):
    """INPUT-03 multiplier bases for the two CHECK services."""

    ACCEPTED_QUANTITY = "ACCEPTED_QUANTITY"
    DELIVERED_QUANTITY = "DELIVERED_QUANTITY"
    ONE_SERVICE = "ONE_SERVICE"


class BulkPriceState(StrEnum):
    """C02 job target states; the tables are created here for the contract."""

    PENDING = "PENDING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


class MethodRule(Base):
    """A versioned typed norm for one indicator in one product state.

    Exactly one *active* version per applicability key is enforced by a partial
    unique index; historical rows stay for audit and for snapshot provenance.
    Mandatory-ness of an indicator comes from the functional requirements, never
    from a catalog flag (ADR-020).
    """

    __tablename__ = "method_rules"
    __table_args__ = (
        Index(
            "uq_method_rule_active",
            "laboratory_id",
            "product_species_id",
            "product_state_id",
            "indicator_id",
            unique=True,
            postgresql_where=text("active"),
        ),
        CheckConstraint("rev >= 1", name="rev_positive"),
        CheckConstraint("version >= 1", name="version_positive"),
        Index("ix_method_rules_scope", "laboratory_id", "product_species_id", "indicator_id"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    laboratory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    product_species_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    product_state_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    indicator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    version: Mapped[int] = mapped_column(BigInteger)
    result_schema: Mapped[str] = mapped_column(String(32))
    unit_id: Mapped[str] = mapped_column(String(64))
    rule: Mapped[dict[str, object]] = mapped_column(JSONB)
    source: Mapped[dict[str, object]] = mapped_column(JSONB)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class Tariff(Base):
    """A priced service for one laboratory (and, for VSE, product species).

    Money is ``NUMERIC(20,2)`` (SPEC-05); the price may be explicitly zero but
    never negative. Owner decision DR14: the two CHECK services are scoped by
    the laboratory ONLY — their species is NULL, a price applies to every
    species. VSE tariffs keep the full pricing key (laboratory, species,
    service code, unit); the two partial unique indexes encode both scopes.
    """

    __tablename__ = "tariffs"
    __table_args__ = (
        Index(
            "uq_tariff_lab_code_unit_check",
            "laboratory_id",
            "service_code",
            "unit_id",
            unique=True,
            postgresql_where=text("product_species_id IS NULL"),
        ),
        Index(
            "uq_tariff_lab_species_code_unit",
            "laboratory_id",
            "product_species_id",
            "service_code",
            "unit_id",
            unique=True,
            postgresql_where=text("product_species_id IS NOT NULL"),
        ),
        CheckConstraint("price >= 0", name="price_nonnegative"),
        CheckConstraint("rev >= 1", name="rev_positive"),
        Index("ix_tariffs_lab", "laboratory_id", "product_species_id"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    laboratory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    product_species_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    service_code: Mapped[str] = mapped_column(String(128))
    unit_id: Mapped[str] = mapped_column(String(64))
    price: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    version: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[dict[str, object]] = mapped_column(JSONB)
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class CheckServiceRule(Base):
    """Global applicability/multiplier rule for the two CHECK services.

    Only ``PRODUCT_IDENTIFICATION`` and ``TRANSPORT_INSPECTION`` live here
    (enforced by a CHECK constraint); VSE pricing never reads this table.
    """

    __tablename__ = "check_service_rules"
    __table_args__ = (
        UniqueConstraint("service_code", name="uq_check_service_code"),
        CheckConstraint("service_code IN ('PRODUCT_IDENTIFICATION','TRANSPORT_INSPECTION')", name="service_code_valid"),
        CheckConstraint(
            "multiplier_basis IN ('ACCEPTED_QUANTITY','DELIVERED_QUANTITY','ONE_SERVICE')",
            name="multiplier_basis_valid",
        ),
        CheckConstraint("rev >= 1", name="rev_positive"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    service_code: Mapped[str] = mapped_column(String(64))
    unit_id: Mapped[str] = mapped_column(String(64))
    multiplier_basis: Mapped[str] = mapped_column(String(32))
    applicable_decisions: Mapped[list[object]] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[dict[str, object]] = mapped_column(JSONB)
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class ReportClassification(Base):
    """INPUT-05 classification map rows, versioned as a whole (R01/V01)."""

    __tablename__ = "report_classifications"
    __table_args__ = (
        UniqueConstraint("version", "mercury_species_id", name="uq_classification_species"),
        CheckConstraint("material_kind IN ('MEAT','OFFAL')", name="material_kind_valid"),
        CheckConstraint(
            "animal_column IN ('CATTLE','PIG','SHEEP_GOAT','RABBIT_NUTRIA','CHICKEN','OTHER_BIRDS','FISH',"
            "'OTHER_ANIMALS')",
            name="animal_column_valid",
        ),
        Index("ix_classification_version", "version"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    version: Mapped[str] = mapped_column(String(64))
    mercury_species_id: Mapped[str] = mapped_column(String(64))
    product_type_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_state_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supported: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    animal_column: Mapped[str] = mapped_column(String(32))
    material_kind: Mapped[str] = mapped_column(String(16))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class BulkPriceJob(Base):
    """The immutable intent of a bulk price operation (C02 uses the logic)."""

    __tablename__ = "bulk_price_jobs"
    __table_args__ = (CheckConstraint("price >= 0", name="price_nonnegative"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    product_species_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    service_code: Mapped[str] = mapped_column(String(128))
    unit_id: Mapped[str] = mapped_column(String(64))
    price: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    created_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class BulkPriceTarget(Base):
    """One laboratory target of a bulk price job with its own state."""

    __tablename__ = "bulk_price_targets"
    __table_args__ = (
        UniqueConstraint("job_id", "laboratory_id", name="uq_bulk_target_lab"),
        CheckConstraint("state IN ('PENDING','SUCCEEDED','FAILED')", name="state_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    laboratory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    state: Mapped[str] = mapped_column(String(16), default="PENDING", server_default=text("'PENDING'"))
    problem_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
