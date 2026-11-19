"""API-07 ``ConclusionView`` — the view-model of one printable conclusion."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

__all__ = ["ConclusionView", "ConclusionFlagView", "ReportDocumentView", "DocumentView", "ReportMatrixRow"]


class ConclusionFlagView(BaseModel):
    """The compact conclusion availability of one row (ТЗ DR55 §5.4).

    A display convenience of the read model only: the preview/PDF routes
    always re-derive the live basis and re-check the rights. ``basis_kind``
    is ``LOCAL``/``PREVIOUS`` when a basis exists, ``None`` when none does.
    """

    available: bool
    basis_kind: Literal["LOCAL", "PREVIOUS"] | None


class ConclusionView(BaseModel):
    """One derived view of the currently valid basis (API-07).

    ``fields`` carries every manifest space of INPUT-04: the real requisites
    plus the always-blank manual ``signature`` space. The view is derived per
    request from live state — it is never stored and never cached.
    """

    basis_kind: Literal["LOCAL", "PREVIOUS"]
    basis_id: str
    fields: dict[str, str | None]
    form_id: str
    form_version: str
    official: bool
    warnings: list[str]


class ReportMatrixRow(BaseModel):
    """One printed row of the 5-вет section III form (DR51 §2.2).

    ``automatic=False`` marks a BLANK row: the system never computes it and
    the renderer prints an EMPTY cell — never «Не рассчитывается», «—» or a
    forged zero (owner decision 2026-11-18). ``values`` keys are the column
    keys of the projection.
    """

    code: str
    name: str
    automatic: bool
    values: dict[str, str | float | None]


class ReportDocumentView(BaseModel):
    """The printable projection of one saved report snapshot (API-08, DR51 §2/§8).

    It is built exclusively from the stored snapshot — no current ВСЭ query
    ever contributes to it, so an export re-renders the very snapshot that
    was signed, never a silent recomputation. The header is the simplified
    user header: title, creation date, period and laboratory — the seven
    organizational codes and the formal half-year heading are cancelled.
    """

    form_id: Literal["report-5vet"]
    title: str = "5-вет, раздел III"
    created_label: str = "Дата создания"
    created_at: str
    laboratory: str
    period: str
    columns: list[str]
    matrix: list[ReportMatrixRow]
    ton_precision: int = 6
    official: bool
    warnings: list[str]


#: A renderer consumes exactly one printable view-model (API-07/API-08).
#: The union is discriminated by ``form_id``: every ``form_id`` belongs to
#: exactly one view kind, so the renderer can never mix the two shapes.
DocumentView = ConclusionView | ReportDocumentView
