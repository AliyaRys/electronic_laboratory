"""Samples ORM models (DATA-03).

The migration ``0008_samples`` is the source of truth for DDL; these models
mirror it. ``examination_samples`` arrives in E01, after the examination FK
exists; ``sample_disposals`` is created here because collections reference it,
while the disposal command itself lands in S02.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Numeric, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = ["SampleBasket", "SampleCollection", "SampleDisposal"]


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )


class SampleBasket(Base):
    """The serialization point of one laboratory/species pair (DATA-03).

    Every collection write (selection, correction, disposal) happens under the
    basket row lock, so two concurrent writers of the same species can never
    interleave their balance changes.
    """

    __tablename__ = "sample_baskets"
    __table_args__ = (CheckConstraint("rev >= 1", name="sample_basket_rev_positive"),)

    laboratory_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    product_species_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class SampleCollection(Base):
    """One physical sample fact — independent of any ВСЭ (FT-SMP-01/02).

    A collection owns its classification snapshot, date, weight and author, so
    deleting or renumbering the examination never erases it. ``disposal_id``
    marks the full disposal that consumed it (S02); the disposed fact becomes
    immutable. The balance is the SUM of rows with ``disposal_id IS NULL``.
    """

    __tablename__ = "sample_collections"
    __table_args__ = (
        CheckConstraint("mass_kg > 0", name="sample_collection_mass_positive"),
        CheckConstraint("rev >= 1", name="sample_collection_rev_positive"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    party_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("parties.id", ondelete="RESTRICT"))
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT")
    )
    product_species_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    classification_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB)
    collected_on: Mapped[date] = mapped_column(Date)
    mass_kg: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    collected_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    disposal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_disposals.id", ondelete="RESTRICT"), nullable=True
    )
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))


class SampleDisposal(Base):
    """The immutable full-disposal fact of one species (S02 writes it).

    A disposal consumes the whole actual balance of its basket: every
    collection of the species is attached exactly once, and the row is never
    edited or undone by an ordinary operation (O-07).
    """

    __tablename__ = "sample_disposals"
    __table_args__ = (
        CheckConstraint("mass_kg > 0", name="sample_disposal_mass_positive"),
        CheckConstraint("btrim(external_vsd_number) <> ''", name="sample_disposal_vsd_nonblank"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT")
    )
    product_species_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    disposed_on: Mapped[date] = mapped_column(Date)
    mass_kg: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    external_vsd_number: Mapped[str] = mapped_column()  # manually entered fact, not an API-verified one
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
