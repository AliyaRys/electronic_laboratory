"""Medical field validation that is independent from editable catalog flags."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.problems import ProblemItem, validation_error
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.catalog_pricing.mandatory import (
    MANDATORY_INDICATOR_IDS,
    TRICHINELLA_INDICATOR_ID,
    indicator_by_code,
)
from backend.src.modules.examinations.schemas import ExaminationWrite
from backend.src.modules.integrations.vetis.models import MercuryProductGuidLvl2

__all__ = ["field_id", "validate_researches"]

_NAMESPACE = uuid.UUID("7e21a0f6-4b1a-4e8d-9c2f-0a5b3d7e1c44")


def field_id(code: str) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, f"elab-vse://field/{code}")


BACTERIOSCOPY = field_id("VSE-F23")
MICROSCOPY = field_id("VSE-F24")
PH = field_id("VSE-F25")
COOKING = field_id("VSE-F26")
COPPER = field_id("VSE-F27")
PEROXIDASE = field_id("VSE-F28")
DOSIMETRY = field_id("VSE-F29")


async def _requires_trichinelloscopy(db: AsyncSession, party: Party) -> bool:
    product = party.classification_snapshot.get("product")
    product_id = product.get("id") if isinstance(product, dict) else None
    if product_id is None:
        return False
    contour = (
        await db.execute(select(IncomingDocument.contour).where(IncomingDocument.id == party.incoming_document_id))
    ).scalar_one()
    return bool(
        await db.scalar(
            select(MercuryProductGuidLvl2.requires_trichinelloscopy).where(
                MercuryProductGuidLvl2.contour == contour,
                MercuryProductGuidLvl2.guid == uuid.UUID(str(product_id)),
            )
        )
    )


async def validate_researches(db: AsyncSession, party: Party, payload: ExaminationWrite) -> None:
    """Validate completeness, duplicate indicators and fixed FT field shapes."""
    errors: list[ProblemItem] = []
    by_id: dict[uuid.UUID, Any] = {}
    for index, result in enumerate(payload.researches):
        if result.indicator_id in by_id:
            errors.append(
                ProblemItem(
                    path=f"researches.{index}.indicatorId",
                    field_id="VSE",
                    message="Один показатель нельзя сохранить дважды для одной партии.",
                )
            )
        by_id[result.indicator_id] = result

    mandatory = set(MANDATORY_INDICATOR_IDS)
    if await _requires_trichinelloscopy(db, party):
        mandatory.add(TRICHINELLA_INDICATOR_ID)
    for indicator in mandatory:
        if indicator not in by_id:
            errors.append(
                ProblemItem(
                    path=f"researches.{indicator}",
                    field_id="VSE",
                    message="Обязательное исследование не выполнено.",
                )
            )

    expected_kinds = {
        BACTERIOSCOPY: "TEXT",
        # ТЗ DR42 §5.1: the microscopy field is a nonnegative decimal; saved
        # INTEGER snapshots keep reading (the write contract accepts DECIMAL).
        MICROSCOPY: "DECIMAL",
        PH: "DECIMAL",
        COOKING: "ENUM",
        COPPER: "ENUM",
        PEROXIDASE: "ENUM",
        DOSIMETRY: "DOSIMETRY",
    }
    for indicator, kind in expected_kinds.items():
        checked = by_id.get(indicator)
        if checked is not None and checked.kind != kind:
            errors.append(
                ProblemItem(
                    path=f"researches.{indicator}.kind",
                    field_id="VSE",
                    message=f"Для этого исследования требуется тип {kind}.",
                )
            )

    # DR52 §2: pH вне настроенной нормы — это оценка DEVIATION, а не блокирующая
    # структурная ошибка; save не препятствуется выходом за справочник.

    # ТЗ DR42 §5.1: the microscopy field is a nonnegative decimal; the wire
    # grammar alone still admits a sign, so the FT bound is enforced here.
    micro = by_id.get(MICROSCOPY)
    if micro is not None and micro.kind == "DECIMAL" and Decimal(str(micro.value)) < 0:
        errors.append(
            ProblemItem(
                path=f"researches.{MICROSCOPY}.value",
                field_id="VSE-F24",
                message="Микроскопия — неотрицательное десятичное число.",
            )
        )

    allowed_reactions = {"POSITIVE", "NEGATIVE", "ПОЛОЖИТЕЛЬНАЯ", "ОТРИЦАТЕЛЬНАЯ"}
    for indicator in (COPPER, PEROXIDASE):
        reaction = by_id.get(indicator)
        if (
            reaction is not None
            and reaction.kind == "ENUM"
            and str(reaction.value).strip().upper() not in allowed_reactions
        ):
            errors.append(
                ProblemItem(
                    path=f"researches.{indicator}.value",
                    field_id="VSE",
                    message="Допустима только положительная или отрицательная реакция.",
                )
            )

    # ТЗ DR54 Task 6: «Иное (указать)» was removed from the cooking test —
    # a NEW result is accepted only as one of the five subject-defined
    # variants (a typed validation error, not just a missing UI option).
    allowed_cooking = indicator_by_code("VSE-F26").options or ()
    cooking = by_id.get(COOKING)
    if cooking is not None and cooking.kind == "ENUM" and str(cooking.value) not in allowed_cooking:
        errors.append(
            ProblemItem(
                path=f"researches.{COOKING}.value",
                field_id="VSE-F26",
                message="Допустим один из пяти вариантов пробы варки; вариант «Иное» больше не поддерживается.",
            )
        )
    if errors:
        raise validation_error(errors)
