"""Controlled form resources (INPUT-04): manifests, templates, fonts.

The renderer is only ever fed resources from ``backend/resources/forms/`` and
``backend/resources/fonts/``. Every path goes through :func:`_resolve_within`,
which rejects URL schemes, absolute paths, drive letters and parent escapes;
external network fetches are additionally blocked at the PDF engine level
(``pdf.py`` installs a denying link callback). A missing or tampered
template/font raises :class:`RendererUnavailable` → the route answers
503 Problem and never a file built from unverified resources.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from backend.src.core.problems import ProblemError

__all__ = [
    "FormManifest",
    "FontEntry",
    "Margins",
    "RendererUnavailable",
    "load_manifest",
    "read_manifest_document",
    "read_template",
    "font_file",
    "resolve_within",
    "RESOURCES_DIR",
]

RESOURCES_DIR = Path(__file__).resolve().parents[3] / "resources"
FORMS_DIR = RESOURCES_DIR / "forms"
FONTS_DIR = RESOURCES_DIR / "fonts"

_FORBIDDEN = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")  # any URL scheme (http:, file:, …)


class RendererUnavailable(ProblemError):
    """503 RENDERER_UNAVAILABLE — the form resources are unusable, no file."""

    def __init__(self, detail: str) -> None:
        super().__init__(
            status=503,
            code="RENDERER_UNAVAILABLE",
            title="Renderer unavailable",
            detail=detail,
        )


def _plain_name(relative: str) -> bool:
    if not relative or relative != relative.strip():
        return False
    if "\\" in relative or relative in (".", ".."):
        return False
    if relative.startswith(("/", "~")) or Path(relative).is_absolute():
        return False
    if _FORBIDDEN.match(relative):
        return False
    return ":" not in relative and not any(part in ("", ".", "..") for part in relative.split("/"))


def resolve_within(base: Path, relative: str) -> Path:
    """Resolve ``relative`` strictly inside ``base`` or raise RendererUnavailable.

    External URLs, arbitrary file paths and traversal escapes are refused —
    the renderer can never be pointed at resources outside the controlled
    directories (SPEC-05).
    """
    if not _plain_name(relative):
        raise RendererUnavailable(f"Недопустимый ресурс формы: {relative!r}.")
    resolved = (base / relative).resolve()
    if resolved.parent != base.resolve() and base.resolve() not in resolved.parents:
        raise RendererUnavailable(f"Ресурс формы выходит за пределы каталога: {relative!r}.")
    return resolved


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


class Margins(BaseModel):
    top: float
    right: float
    bottom: float
    left: float


class FontEntry(BaseModel):
    resource: str
    sha256: str
    license: str


class FormManifest(BaseModel):
    """One printable form manifest (INPUT-04)."""

    model_config = ConfigDict(frozen=True)

    form_id: str
    version: str
    date: str
    template: str
    template_sha256: str
    official: bool
    title: str
    required_fields: list[str]
    paper: str = "A4"
    margins_mm: Margins
    repeat_headers: bool
    noncalculated_cells: list[str] = Field(default_factory=list)
    ton_precision: int = 6
    fonts: list[FontEntry]


def read_manifest_document() -> dict[str, Any]:
    """The raw manifest document (forms manifest lives only in resources)."""
    path = resolve_within(FORMS_DIR, "manifest.json")
    if not path.is_file():
        raise RendererUnavailable("Манифест форм недоступен.")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RendererUnavailable(f"Манифест форм нечитаем: {error}.") from error
    if not isinstance(document, dict) or not isinstance(document.get("forms"), list):
        raise RendererUnavailable("Манифест форм повреждён.")
    return document


def load_manifest(form_id: str) -> FormManifest:
    """The manifest of one form; template integrity is verified by SHA-256."""
    document = read_manifest_document()
    raw = next((entry for entry in document["forms"] if entry.get("form_id") == form_id), None)
    if raw is None:
        raise RendererUnavailable(f"Форма {form_id!r} не зарегистрирована в манифесте.")
    try:
        manifest = FormManifest.model_validate(raw)
    except ValueError as error:
        raise RendererUnavailable(f"Манифест формы {form_id!r} повреждён: {error}.") from error
    template = resolve_within(FORMS_DIR, manifest.template)
    if not template.is_file():
        raise RendererUnavailable(f"Шаблон формы {form_id!r} недоступен.")
    digest = _sha256(template.read_bytes())
    if digest != manifest.template_sha256.upper():
        raise RendererUnavailable(f"Шаблон формы {form_id!r} не совпадает с манифестом (sha256).")
    return manifest


def read_template(manifest: FormManifest) -> str:
    """The template as UTF-8 text; existence and integrity are re-verified."""
    path = resolve_within(FORMS_DIR, manifest.template)
    if not path.is_file():
        raise RendererUnavailable(f"Шаблон формы {manifest.form_id!r} недоступен.")
    if _sha256(path.read_bytes()) != manifest.template_sha256.upper():
        raise RendererUnavailable(f"Шаблон формы {manifest.form_id!r} не совпадает с манифестом (sha256).")
    return path.read_text(encoding="utf-8")


def font_file(manifest: FormManifest) -> Path:
    """The verified font file of the manifest (fonts dir only)."""
    if not manifest.fonts:
        raise RendererUnavailable(f"Форма {manifest.form_id!r} не объявляет шрифт.")
    entry = manifest.fonts[0]
    path = resolve_within(FONTS_DIR, entry.resource)
    if not path.is_file():
        raise RendererUnavailable(f"Шрифт формы {manifest.form_id!r} недоступен.")
    if _sha256(path.read_bytes()) != entry.sha256.upper():
        raise RendererUnavailable(f"Шрифт формы {manifest.form_id!r} не совпадает с манифестом (sha256).")
    return path
