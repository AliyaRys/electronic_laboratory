"""API-07 ``ConclusionView`` — the view-model of one printable conclusion."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

__all__ = ["ConclusionView"]


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
