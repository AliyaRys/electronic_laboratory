"""API-07 ``ConclusionView`` — the view-model of one printable conclusion."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

__all__ = ["ConclusionView", "ReportDocumentView", "DocumentView", "ReportCodes", "ReportMatrixRow"]


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


class ReportCodes(BaseModel):
    """The header requisites of the 5-вет form (API-08 snapshot codes)."""

    okud: str
    okpo: str
    okved: str
    oktmo: str
    okogu: str
    okopf: str
    okfs: str


class ReportMatrixRow(BaseModel):
    """One row of the 5-вет matrix.

    ``automatic=False`` marks a cell that is not computed by the system
    (INPUT-04): the renderer prints «Не рассчитывается» instead of inventing
    a number. ``values`` keys are the column keys of the projection.
    """

    code: str
    name: str
    automatic: bool
    values: dict[str, str | float | None]


class ReportDocumentView(BaseModel):
    """The printable projection of one saved report snapshot (API-08).

    It is built exclusively from the stored snapshot — no current ВСЭ query
    ever contributes to it, so an export re-renders the very snapshot that was
    signed, never a silent recomputation.
    """

    form_id: Literal["report-5vet"]
    laboratory: str
    year: int
    half: int
    period: str
    codes: ReportCodes
    columns: list[str]
    matrix: list[ReportMatrixRow]
    versions: dict[str, str]
    ton_precision: int = 6
    official: bool
    warnings: list[str]


#: A renderer consumes exactly one printable view-model (API-07/API-08).
#: The union is discriminated by ``form_id``: every ``form_id`` belongs to
#: exactly one view kind, so the renderer can never mix the two shapes.
DocumentView = ConclusionView | ReportDocumentView
