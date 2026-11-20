"""``build_conclusion`` (API-07): derive the conclusion view-model from the
currently valid basis — never store it, never substitute a missing requisite.

The two basis routes (FT-DOC-03, ФТ 04 route table) and the eligibility
decision live in ONE place: :mod:`backend.src.modules.documents.basis`. The
same pure predicate answers the bulk read-model projection
(``conclusion.available``) and this per-request builder, so the list can
never show an action the live builder would refuse (ТЗ DR55 §5.4).

Missing requisites are enumerated in the 422 problem (FT-DOC-04,
INPUT-04): demo terms, numbers, signatures or foreign requisites are never
fabricated. The manual signature space is an always-blank mandatory place.

Every call re-checks the actor's live authorization against the actual
tables, so a correction is visible on the next view and the deletion of the
basis closes the previously served URL (FT-DOC-06).
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import UnitOfWork
from backend.src.core.problems import ProblemError, ProblemItem, not_found
from backend.src.modules.arrivals.confirmation import ensure_confirmed
from backend.src.modules.arrivals.models import IncomingDocument, Party
from backend.src.modules.arrivals.queries import party_view, previous_vse_fields
from backend.src.modules.documents.basis import (
    BLOCKER_TEXTS,
    BasisOutcome,
    conclusion_unit_names,
    evaluate_conclusion_basis,
    local_basis_fields,
    owner_display_name,
    previous_basis_fields,
)
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
FORM_VERSION = "2"
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
    except Exception:  # noqa: BLE001 - InvalidOperation/TypeError are the same "not a number"
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


def _document_fields(
    document: IncomingDocument, form_snapshot: object = None
) -> tuple[dict[str, str | None], dict[str, object]]:
    payload = document.source_snapshot.get("vdDocument")
    payload = payload if isinstance(payload, dict) else {}
    batch = payload.get("batch")
    batch = batch if isinstance(batch, dict) else {}
    product_item = batch.get("productItem") if isinstance(batch, dict) else None
    fields = {
        # DR5: the printed conclusion shows the top-level eVSD UUID (bs:uuid);
        # issueNumber stays in the source snapshot but is never displayed as the
        # document requisition (interface term: «UUID ВСД»).
        "evsd": str(document.evsd_uuid),
        # ТЗ DR55 §5.8 fix-loop: the SAVED read-model participant wins over the
        # raw consignee (the shared owner_display_name of the basis layer).
        "owner": owner_display_name(payload, form_snapshot),
        "product": _text(product_item.get("name")) if isinstance(product_item, dict) else None,
    }
    return fields, batch


async def _laboratory_fields(db: AsyncSession, party: Party) -> dict[str, str | None]:
    lab = (await db.execute(select(Laboratory).where(Laboratory.id == party.laboratory_id))).scalar_one_or_none()
    return {
        "organization": _text(lab.organization) if lab is not None else None,
        "laboratory": _text(lab.name) if lab is not None else None,
    }


def _raise_outcome_problems(outcome: BasisOutcome) -> None:
    """Map the typed predicate blockers/gaps to the 422 problem (one text map)."""
    if outcome.blockers:
        raise basis_problem([BLOCKER_TEXTS[blocker] for blocker in outcome.blockers])
    if outcome.missing:
        raise basis_problem(list(outcome.missing))


async def build_conclusion(
    actor_id: uuid.UUID,
    party_id: uuid.UUID,
    *,
    uow: AsyncSession | UnitOfWork,
    authorizer: Authorizer | None = None,
    capability: Literal["conclusion:preview", "conclusion:pdf"] = "conclusion:preview",
) -> ConclusionView:
    """Derive the conclusion view-model of one party from its live basis.

    ``capability`` is the single checked permission of the calling route
    (preview → ``conclusion:preview``, PDF → ``conclusion:pdf``, ТЗ DR55
    §3.5): the scope (laboratory + product area) check stays identical.
    """
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
        capability,
        ScopeTarget(laboratory_id=party.laboratory_id, product_scope_id=_product_scope(party)),
        hide_foreign=True,
    )

    # The frozen verified receipt fact is the gate of every dependent read.
    confirmation = await ensure_confirmed(db, party_id)
    accepted_mass = _number(confirmation.accepted_mass_kg) or Decimal("0")
    accepted_quantity = _number(confirmation.accepted_quantity) or Decimal("0")
    returned_quantity = _number(confirmation.returned_quantity) or Decimal("0")

    fields, batch = _document_fields(document, party.form_snapshot)
    if confirmation.previous_sufficient:
        basis_kind: Literal["LOCAL", "PREVIOUS"] = "PREVIOUS"
        basis_id = str(confirmation.id)
        basis_fields, previous_missing = previous_basis_fields(document.source_snapshot)
        local_fields, local_blockers = {}, ()
        # ТЗ DR55: the CHK requisites of the previous basis are enumerated
        # under their own CHK names, exactly as the fixture contract expects.
        source = previous_vse_fields(document.source_snapshot)
        for name, value in source.items():
            fields.setdefault(name, value)
    else:
        basis_kind = "LOCAL"
        row = (await db.execute(select(Examination).where(Examination.party_id == party.id))).scalar_one_or_none()
        basis_fields, local_blockers = local_basis_fields(row)
        local_fields = basis_fields
        # A deleted (or never created) locally-required ВСЭ is never
        # substituted by the previous basis — the blocker text stays honest.
        basis_id = str(row.id) if row is not None else ""

    laboratory_fields = await _laboratory_fields(db, party)
    # Fix-loop DR55: the unit name follows the shared conclusion_unit_name
    # source (batch name → frozen read-model name → resolved UNIT cache row),
    # the same helper the bulk projector uses.
    names = await conclusion_unit_names(
        db,
        document.contour,
        [party],
        {party.id: document},
        {party.id: confirmation},
    )
    unit_name = names[party.id]
    outcome = evaluate_conclusion_basis(
        confirmed=True,
        accepted_quantity=accepted_quantity,
        returned_quantity=returned_quantity,
        previous_sufficient=confirmation.previous_sufficient,
        laboratory=laboratory_fields,
        document=fields,
        local=local_fields if not confirmation.previous_sufficient else None,
        local_blockers=local_blockers,
        previous=basis_fields if confirmation.previous_sufficient else None,
        unit_name=unit_name,
    )
    _raise_outcome_problems(outcome)

    fields.update(basis_fields)
    fields.update(laboratory_fields)
    fields["mass"] = _format(accepted_mass)
    fields["count"] = _format(accepted_quantity)
    # ТЗ DR55 §5.8: a GUID/UUID is never printable as the unit — the
    # human-readable name of the frozen confirmed snapshot is required, its
    # absence is the honest 422 above.
    fields["unit"] = unit_name
    fields[SIGNATURE_SPACE] = ""  # the mandatory blank manual-signature space

    still_missing = [name for name in REQUIRED_FIELD_SPACES if not (fields.get(name) or "").strip()]
    if still_missing:
        raise basis_problem(still_missing)

    return ConclusionView(
        basis_kind=basis_kind,
        basis_id=basis_id,
        fields=fields,
        form_id=FORM_ID[basis_kind],
        form_version=FORM_VERSION,
        official=False,
        warnings=[PRELIMINARY_WARNING],
    )
