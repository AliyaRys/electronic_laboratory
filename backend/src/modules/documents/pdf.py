"""PDF renderer (D02): one controlled HTML template → one A4 PDF.

``render_pdf`` consumes a :class:`DocumentView` (API-07 conclusion or API-08
report projection) together with its verified :class:`FormManifest`. The rules
that make the output trustworthy:

- every text value is HTML-escaped before substitution — markup never
  reaches the engine (SPEC-05);
- the only font is registered from ``backend/resources/fonts/`` with a
  manifest-checked SHA-256; the template comes from
  ``backend/resources/forms/`` with an integrity hash;
- the PDF engine gets a denying link callback, so no external URL (image,
  stylesheet, script) can be fetched while rendering;
- a broken engine or an unavailable resource raises :class:`RendererUnavailable`
  (→ 503 Problem, never a partial file);
- ``official=False`` forms always carry the visible «Предварительная форма»
  label of INPUT-04.
"""

from __future__ import annotations

import io
import re
from html import escape
from typing import Any

from pypdf import PdfReader

from backend.src.modules.documents.resources import (
    FONTS_DIR,
    FormManifest,
    RendererUnavailable,
    font_file,
    read_template,
    resolve_within,
)
from backend.src.modules.documents.schemas import ConclusionView, DocumentView

__all__ = ["PRELIMINARY_LABEL", "pdf_filename", "render_pdf"]

TOKEN = re.compile(r"\{\{(\w+)\}\}")
PRELIMINARY_LABEL = "Предварительная форма"
A4_PT = (595.28, 841.89)


def pdf_filename(view: ConclusionView) -> str:
    """A Content-Disposition-safe name: no path, control or device characters."""
    unsafe = str(view.fields.get("evsd") or "документ")
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", unsafe).strip().strip(".")
    cleaned = cleaned or "документ"
    return f"Ветеринарное_заключение_{cleaned}.pdf"


def _escape(value: Any) -> str:
    if value is None:
        return ""
    return escape(str(value), quote=False)


def _register_fonts(form: FormManifest) -> None:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    name = "DejaVuSans"
    if name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(name, str(font_file(form))))


def _strict_link_callback(uri: str, *args: Any) -> str | None:  # noqa: ARG001 - engine signature
    """Resolve only controlled resources; deny everything else (SPEC-05).

    The template may reference fonts by bare file name — the callback resolves
    them strictly inside ``backend/resources/fonts/``. Any other URI (external
    URL, arbitrary file path) is refused and aborts the render with 503.
    """
    try:
        return str(resolve_within(FONTS_DIR, uri))
    except RendererUnavailable as error:
        raise RendererUnavailable(f"Внешний или недопустимый ресурс запрещён при рендере формы: {uri!r}.") from error


def _conclusion_mapping(view: ConclusionView) -> dict[str, str]:
    mapping = {name: _escape(value) for name, value in view.fields.items()}
    mapping["form_id"] = _escape(view.form_id)
    mapping["form_version"] = _escape(view.form_version)
    mapping["preliminary"] = PRELIMINARY_LABEL if not view.official else ""
    return mapping


def _report_fragments(view: Any) -> dict[str, str]:
    codes = (
        ("ОКУД", view.codes.okud),
        ("ОКПО", view.codes.okpo),
        ("ОКВЭД", view.codes.okved),
        ("ОКТМО", view.codes.oktmo),
        ("ОКОГУ", view.codes.okogu),
        ("ОКОПФ", view.codes.okopf),
        ("ОКФС", view.codes.okfs),
    )
    codes_html = "".join(
        f'<tr><th scope="row">{_escape(label)}</th><td>{_escape(value)}</td></tr>' for label, value in codes
    )
    columns_html = "".join(f'<th scope="col">{_escape(name)}</th>' for name in view.columns)
    rows_html = []
    for row in view.matrix:
        cells = [f'<th scope="row">{_escape(row.code)} {_escape(row.name)}</th>']
        for column in view.columns:
            value = row.values.get(column)
            if not row.automatic:
                shown = "Не рассчитывается"
            elif value is None:
                shown = "—"
            else:
                shown = f"{float(value):.{view.ton_precision}f}".rstrip("0").rstrip(".")
            cells.append(f"<td>{_escape(shown)}</td>")
        rows_html.append("<tr>" + "".join(cells) + "</tr>")
    versions = "; ".join(f"{_escape(key)} {_escape(value)}" for key, value in view.versions.items())
    return {
        "laboratory": _escape(view.laboratory),
        "period": _escape(view.period),
        "form_id": _escape(view.form_id),
        "codes": codes_html,
        "columns": columns_html,
        "rows": "".join(rows_html),
        "versions": versions,
        "preliminary": PRELIMINARY_LABEL if not view.official else "",
    }


def _fill(template: str, mapping: dict[str, str]) -> str:
    return TOKEN.sub(lambda match: mapping.get(match.group(1), ""), template)


def _run_engine(html: str) -> bytes:
    from xhtml2pdf import pisa

    destination = io.BytesIO()
    try:
        result = pisa.CreatePDF(
            html,
            dest=destination,
            encoding="utf-8",
            link_callback=_strict_link_callback,
        )
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001 - the engine failure is a 503 by contract
        raise RendererUnavailable(f"Движок рендера формы недоступен: {error}.") from error
    if getattr(result, "err", 0):
        raise RendererUnavailable(f"Движок рендера формы вернул ошибки: {result.err}.")
    data = destination.getvalue()
    if not data.startswith(b"%PDF-"):
        raise RendererUnavailable("Движок рендера формы не вернул PDF-файл.")
    return data


def render_pdf(model: DocumentView, form: FormManifest) -> bytes:
    """Render one verified view-model through its manifest template to A4 PDF."""
    template = read_template(form)
    try:
        _register_fonts(form)
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001
        raise RendererUnavailable(f"Шрифт формы недоступен: {error}.") from error

    mapping = _conclusion_mapping(model) if isinstance(model, ConclusionView) else _report_fragments(model)
    mapping["form_version"] = _escape(form.version)
    html = _fill(template, mapping)

    data = _run_engine(html)
    try:
        reader = PdfReader(io.BytesIO(data))
        box = reader.pages[0].mediabox
        if len(reader.pages) == 0 or abs(float(box.width) - A4_PT[0]) > 3 or abs(float(box.height) - A4_PT[1]) > 3:
            raise RendererUnavailable("Движок рендера вернул страницу не формата A4.")
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001
        raise RendererUnavailable(f"Результат рендера нечитаем: {error}.") from error
    return data
