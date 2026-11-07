"""Locally mirrored VetIS reference data used without per-view SOAP calls."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Integer, SmallInteger, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.src.core.database import Base

__all__ = ["MercuryProductGuidLvl2", "VetisContour"]


class VetisContour(StrEnum):
    """VetIS contours must never share dictionary identities implicitly."""

    PILOT = "PILOT"
    PRODUCTION = "PRODUCTION"


class MercuryProductGuidLvl2(Base):
    """Current second-level Mercury product record for one VetIS contour.

    ``guid`` is the stable product identity received in an incoming VSD;
    ``current_uuid`` identifies the current version of that external record.
    The Russian name is resolved locally for API/UI output. The mandatory
    trichinelloscopy flag is an owner-approved local rule and is never inferred
    from a substring of ``name``.
    """

    __tablename__ = "mercury_product_guid_lvl_2"
    __table_args__ = (
        UniqueConstraint("contour", "current_uuid", name="uq_mercury_product_lvl2_contour_uuid"),
        CheckConstraint("contour IN ('PILOT','PRODUCTION')", name="mercury_product_lvl2_contour_valid"),
        CheckConstraint("product_type BETWEEN 1 AND 8", name="mercury_product_lvl2_type_valid"),
        Index("ix_mercury_product_lvl2_name", "contour", "name"),
    )

    contour: Mapped[str] = mapped_column(String(16), primary_key=True)
    guid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    current_uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    english_name: Mapped[str | None] = mapped_column(String(255))
    tnved_codes: Mapped[str] = mapped_column(String(255), nullable=False)
    product_type: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_last: Mapped[bool] = mapped_column(Boolean, nullable=False)
    external_status: Mapped[int] = mapped_column(Integer, nullable=False)
    requires_trichinelloscopy: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    synchronized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
