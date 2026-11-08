"""ORM models for one saved examination per confirmed party."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = ["Examination", "ExaminationSample", "ExaminationStatus", "ExaminationTombstone"]


class ExaminationStatus(StrEnum):
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"


class Examination(Base):
    """The medical card; physical sample facts remain independent."""

    __tablename__ = "examinations"
    __table_args__ = (
        UniqueConstraint("party_id", name="uq_examination_party"),
        UniqueConstraint("laboratory_id", "number", name="uq_examination_lab_number"),
        CheckConstraint("status IN ('WAITING','COMPLETED')", name="examination_status_valid"),
        CheckConstraint("btrim(number) <> ''", name="examination_number_nonblank"),
        CheckConstraint("btrim(stamp) <> ''", name="examination_stamp_nonblank"),
        CheckConstraint("rev >= 1", name="examination_rev_positive"),
        CheckConstraint(
            "(status = 'WAITING' AND first_completed_at IS NULL) OR "
            "(status = 'COMPLETED' AND first_completed_at IS NOT NULL)",
            name="examination_completion_consistent",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    party_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("parties.id", ondelete="RESTRICT"), nullable=False
    )
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT"), nullable=False
    )
    number: Mapped[str] = mapped_column(String(128), nullable=False)
    stamp: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    sent_to_lab: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    research_snapshot: Mapped[list[object]] = mapped_column(JSONB, nullable=False)
    findings_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    pricing_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    direction: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    first_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rev: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("1"))


class ExaminationSample(Base):
    """Link from a card to an independent physical collection fact."""

    __tablename__ = "examination_samples"

    examination_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("examinations.id", ondelete="CASCADE"), primary_key=True
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sample_collections.id", ondelete="RESTRICT"), nullable=False
    )


class ExaminationTombstone(Base):
    """Minimal deletion fact: deliberately contains no medical payload."""

    __tablename__ = "examination_tombstones"

    examination_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT"), nullable=False
    )
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    command_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
