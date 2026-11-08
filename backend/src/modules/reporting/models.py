"""Immutable saved 5-vet report snapshots (DATA-05, ADR-021)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base


class ReportSnapshot(Base):
    __tablename__ = "report_snapshots"
    __table_args__ = (
        UniqueConstraint("report_type", "laboratory_id", "year", "half", name="uq_report_snapshot_period"),
        CheckConstraint("half IN (1, 2)", name="half_valid"),
        CheckConstraint("source_count >= 0", name="source_count_nonnegative"),
        CheckConstraint("rev = 1", name="immutable_revision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    report_type: Mapped[str] = mapped_column(String(32))
    laboratory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("laboratories.id", ondelete="RESTRICT")
    )
    year: Mapped[int] = mapped_column(Integer)
    half: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB)
    codes: Mapped[dict[str, str]] = mapped_column(JSONB)
    source_count: Mapped[int] = mapped_column(Integer)
    preview_generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=text("now()")
    )
    saved_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    key_id: Mapped[str] = mapped_column(String(128))
    signature: Mapped[str] = mapped_column(String(64))
    rev: Mapped[int] = mapped_column(BigInteger, default=1, server_default=text("1"))
