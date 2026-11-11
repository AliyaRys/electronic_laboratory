"""``build_conclusion`` (API-07): derive the conclusion view-model from the
currently valid basis — never store it, never substitute a missing requisite.

The two basis routes (FT-DOC-03, ФТ 04 route table):

- previous ВСЭ present AND the frozen confirmation says repeat is not
  required → basis PREVIOUS: the slaughter-point stamp and requisites come
  from the incoming eVSD CHK record; no local ВСЭ is demanded;
- otherwise the basis is LOCAL: the party's own completed, suitable (FIT)
  examination supplies the laboratory stamp. A waiting, unfit or deleted
  local ВСЭ is never substituted by the previous one (no fallback), and a
  full return never produces a document.

Missing requisites are enumerated in the 422 problem (FT-DOC-04,
INPUT-04): demo terms, numbers, signatures or foreign requisites are never
fabricated. The manual signature space is an always-blank mandatory place.

Every call re-checks the actor's live authorization against the actual
tables, so a correction is visible on the next view and the deletion of the
basis closes the previously served URL (FT-DOC-06).
"""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import moscow_date
from backend.src.core.commands import UnitOfWork
from backend.src.core.problems import ProblemError, ProblemItem, not_found
from backend.src.modules.arrivals.confirmation import ensure_confirmed
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.arrivals.queries import party_view, previous_vse_fields
from backend.src.modules.documents.schemas import ConclusionView
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.authz import Authorizer, ScopeTarget, get_authorizer
from backend.src.modules.identity.models import Laboratory

__all__ = ["REQUIRED_FIELD_SPACES", "SIGNATURE_SPACE", "build_conclusion", "basis_problem"]

# The manifest spaces of INPUT-04 that must carry real data. The manual
# signature space is mandatory as a blank place and is always rendered — it is
# never part of the "missing data" enumeration.
REQUIRED_FIELD_SPACES: tuple[str, ...] = (
    "organization",
    "laboratory",
    "date",
    "basis",
    "evsd",
    "owner",
    "product",
    "mass",
    "count",
    "unit",
    "stamp",
)
SIGNATURE_SPACE = "signature"

FORM_ID: dict[str, str] = {"LOCAL": "conclusion-local", "PREVIOUS": "conclusion-previous"}
FORM_VERSION = "1"
PRELIMINARY_WARNING = "Предварительная форма"


def basis_problem(missing: list[str]) -> ProblemError:
    """422 DOCUMENT_BASIS_INCOMPLETE with the enumerated missing requisites."""
    items = [
        ProblemItem(path=f"fields.{name}", message=f"Отсутствует обязательный реквизит: {name}.") for name in missing
    ]
    listed = "; ".join(missing)
    return ProblemError(
        status=422,
        code="DOCUMENT_BASIS_INCOMPLETE",
        title="Conclusion basis incomplete",
        detail=(f"Основание заключения непригодно или неполно; документ не формируется. Отсутствует: {listed}."),
        errors=items,
    )


def _number(value: object) -> Decimal | None:
    try:
        parsed = Decimal(str(value)) if value is not None else None
    except InvalidOperation:
        return None
    return parsed if parsed is None or parsed.is_finite() else None


def _format(value: Decimal) -> str:
    """A plain decimal string without insignificant trailing zeros."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _text(value: object) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _product_scope(party: Party) -> uuid.UUID | None:
    product = party.classification_snapshot.get("product")
    value = product.get("id") if isinstance(product, dict) else None
    return uuid.UUID(str(value)) if value is not None else None


def _document_fields(document: IncomingDocument) -> dict[str, str | None]:
    payload = document.source_snapshot.get("vdDocument")
    payload = payload if isinstance(payload, dict) else {}
    consignee = payload.get("consignee")
    batch = payload.get("batch")
    product_item = batch.get("productItem") if isinstance(batch, dict) else None
    return {
        # DR5: the printed conclusion shows the top-level eVSD UUID (bs:uuid);
        # issueNumber stays in the source snapshot but is never displayed as the
        # document requisition (interface term: «UUID ВСД»).
        "evsd": str(document.evsd_uuid),
        "owner": _text(consignee.get("name")) if isinstance(consignee, dict) else None,
        "product": _text(product_item.get("name")) if isinstance(product_item, dict) else None,
    }


async def _laboratory_fields(db: AsyncSession, party: Party) -> dict[str, str | None]:
    lab = (await db.execute(select(Laboratory).where(Laboratory.id == party.laboratory_id))).scalar_one_or_none()
    return {
        "organization": _text(lab.organization) if lab is not None else None,
        "laboratory": _text(lab.name) if lab is not None else None,
    }


def _previous_fields(snapshot: dict[str, object]) -> tuple[dict[str, str | None], list[str]]:
    """The PREVIOUS-basis spaces from the CHK record; every gap is reported."""
    source = previous_vse_fields(snapshot)
    label = {
        "previousStamp": "previousStamp",
        "previousNumber": "previousNumber",
        "previousPerformedOn": "previousPerformedOn",
        "previousOrganization": "previousOrganization",
        "previousResult": "previousResult",
        "previousConclusion": "previousConclusion",
    }
    fields: dict[str, str | None] = {
        "stamp": _text(source["previousStamp"]),
        "date": _text(source["previousPerformedOn"]),
        "basis": None,
    }
    number = _text(source["previousNumber"])
    if number is not None and fields["date"] is not None:
        fields["basis"] = f"Прежняя ВСЭ № {number} от {fields['date']}"
    missing = [name for name in label if _text(source[name]) is None]
    return fields, missing


def _local_fields(row: Examination) -> dict[str, str | None]:
    date = moscow_date(row.first_completed_at).isoformat() if row.first_completed_at is not None else None
    return {
        "stamp": _text(row.stamp),
        "date": date,
        "basis": f"Местная ВСЭ № {row.number} от {date}" if date is not None else None,
    }


async def build_conclusion(
    actor_id: uuid.UUID,
    party_id: uuid.UUID,
    *,
    uow: AsyncSession | UnitOfWork,
    authorizer: Authorizer | None = None,
) -> ConclusionView:
    """Derive the conclusion view-model of one party from its live basis."""
    db = uow.session if isinstance(uow, UnitOfWork) else uow

    resolved = await party_view(db, party_id)
    if resolved is None:
        raise not_found("Партия не найдена.")
    party, document = resolved

    # Authorization is re-evaluated against the live tables on every call:
    # viewing (and, in ТЗ D02, exporting) never bypasses a fresh access check.
    await (authorizer or get_authorizer()).authorize(
        db,
        actor_id,
        "conclusion:preview",
        ScopeTarget(laboratory_id=party.laboratory_id, product_scope_id=_product_scope(party)),
        hide_foreign=True,
    )

    # The frozen verified receipt fact is the gate of every dependent read.
    confirmation = await ensure_confirmed(db, party_id)
    accepted_mass = _number(confirmation.accepted_mass_kg) or Decimal("0")
    accepted_quantity = _number(confirmation.accepted_quantity) or Decimal("0")
    returned_quantity = _number(confirmation.returned_quantity) or Decimal("0")
    if accepted_quantity == 0 and returned_quantity > 0:
        raise basis_problem(["партия возвращена полностью: заключение о реализации недоступно"])

    missing: list[str] = []
    if confirmation.previous_sufficient:
        basis_kind: Literal["LOCAL", "PREVIOUS"] = "PREVIOUS"
        basis_id = str(confirmation.id)
        fields, gaps = _previous_fields(dict(document.source_snapshot))
        missing.extend(gaps)
    else:
        basis_kind = "LOCAL"
        row = (await db.execute(select(Examination).where(Examination.party_id == party.id))).scalar_one_or_none()
        if row is None:
            # A deleted (or never created) locally-required ВСЭ is never
            # substituted by the previous basis.
            raise basis_problem(["местная ВСЭ не найдена (удалена или не создана)"])
        if row.status != "COMPLETED" or row.first_completed_at is None:
            raise basis_problem(["местная ВСЭ в состоянии ожидания: документ недоступен"])
        if row.outcome != "FIT":
            raise basis_problem(["итог местной ВСЭ непригоден: заключение о реализации недоступно"])
        basis_id = str(row.id)
        fields = _local_fields(row)
        for name, value in fields.items():
            if value is None:
                missing.append(name)

    fields.update(_document_fields(document))
    fields.update(await _laboratory_fields(db, party))
    fields["mass"] = _format(accepted_mass)
    fields["count"] = _format(accepted_quantity)
    fields["unit"] = _text(confirmation.accepted_unit_id)
    fields[SIGNATURE_SPACE] = ""  # the mandatory blank manual-signature space

    missing.extend(name for name in REQUIRED_FIELD_SPACES if not (fields.get(name) or "").strip())
    if missing:
        raise basis_problem(missing)

    return ConclusionView(
        basis_kind=basis_kind,
        basis_id=basis_id,
        fields=fields,
        form_id=FORM_ID[basis_kind],
        form_version=FORM_VERSION,
        official=False,
        warnings=[PRELIMINARY_WARNING],
    )
