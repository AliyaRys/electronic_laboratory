import io
import re
from html import escape
from typing import Any

from pypdf import PdfReader

from backend.src.modules.documents.resources import (
    FONTS_DIR,
    FORMS_DIR,
    FormManifest,
    RendererUnavailable,
    asset_file,
    font_file,
    read_template,
    resolve_within,
)
from backend.src.modules.documents.schemas import ConclusionView, DocumentView

__all__ = ["PRELIMINARY_LABEL", "pdf_filename", "render_pdf"]

TOKEN = re.compile(r"\{\{(\w+)\}\}")
PRELIMINARY_LABEL = "Предварительная форма"
A4_PT = (595.28, 841.89)
SVG_W, SVG_H = 820.0, 1160.0

# ТЗ DR56 §5.3: the wrap zones of the composition. ``max_lines`` bounds the
# wrapped value; an objectively longer value is a managed renderer error, never
# a clipped line or an overlay onto the neighbouring one. ``max_chars`` is the
# conservative width of the zone at the token's font size (DejaVu ≈ 0.62·fs).
SVG_WRAP_TOKENS: dict[str, tuple[int, int]] = {
    # token: (max_chars, max_lines)
    "organization": (30, 2),
    "laboratory": (30, 2),
    "address_head": (55, 2),
    "owner": (55, 3),
    "address": (55, 3),
    "product_line": (42, 3),
    "expiry_line": (55, 2),
    "place_line": (55, 3),
    "specialist": (55, 2),
}
SVG_LINE_HEIGHT = 24


def _wrap(value: str, max_chars: int, max_lines: int, token: str) -> list[str]:
    words = value.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        raise RendererUnavailable(
            f"Длинное значение не помещается в отведённую зону формы: {token}; сократите данные."
        )
    return lines or [""]


def _wrap_long_tokens(svg: str, mapping: dict[str, str]) -> str:
    """Replace ``<text ...>{{token}}</text>`` with wrapped <text> lines.

    Only the wrap-capable composition zones are wrapped; every other token
    stays a single short value. The offset keeps the same style attributes and
    shifts each following line down by one line height inside the zone.
    """
    for token, (max_chars, max_lines) in SVG_WRAP_TOKENS.items():
        match = re.search(rf'<text ([^>]*?)y="(\d+)"([^>]*)>\s*\{{\{{{token}\}}\}}\s*</text>', svg)
        if match is None:
            continue
        before_y, y, after_y = match.group(1), int(match.group(2)), match.group(3)
        lines = _wrap(mapping.get(token, ""), max_chars, max_lines, token)
        replacement = "".join(
            f'<text {before_y}y="{y + index * SVG_LINE_HEIGHT}"{after_y}>{line}</text>'
            for index, line in enumerate(lines)
        )
        svg = svg[: match.start()] + replacement + svg[match.end() :]
    return svg


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


def _strict_link_callback(manifest: FormManifest) -> Any:
    """Resolve only controlled resources; deny everything else (SPEC-05).

    The template may reference fonts by bare file name (resolved inside
    ``backend/resources/fonts/``) and manifest-approved binary assets
    (resolved inside ``backend/resources/forms/assets/``). Any other URI
    (external URL, arbitrary file path) is refused and aborts the render
    with 503 (ТЗ DR55 §5.8: only the manifest-approved coat is allowed).
    """

    def callback(uri: str, *args: Any) -> str | None:  # noqa: ARG001 - engine signature
        fonts_candidate = resolve_within(FONTS_DIR, uri)
        if fonts_candidate.is_file():
            return str(fonts_candidate)
        try:
            return str(asset_file(manifest, uri))
        except RendererUnavailable as error:
            raise RendererUnavailable(
                f"Внешний или недопустимый ресурс запрещён при рендере формы: {uri!r}."
            ) from error

    return callback


def _conclusion_mapping(view: ConclusionView) -> dict[str, str]:
    mapping = {name: _escape(value) for name, value in view.fields.items()}
    mapping["form_id"] = _escape(view.form_id)
    mapping["form_version"] = _escape(view.form_version)
    mapping["preliminary"] = PRELIMINARY_LABEL if not view.official else ""
    return mapping


def _report_fragments(view: Any) -> dict[str, str]:
    """The full-form report fragments (DR51 §8): a simplified header (title,
    creation date, period, laboratory) and the 47×8 matrix with the exact
    two-level thead hardcoded in the template. BLANK cells print empty; a
    calculated zero prints ``0``; no codes, versions or formal heading."""
    columns_html = "".join(f'<th scope="col">{_escape(name)}</th>' for name in view.columns)
    rows_html = []
    for row in view.matrix:
        cells = [f'<th scope="row">{_escape(row.name)}</th>', f"<td>{_escape(row.code)}</td>"]
        for column in view.columns:
            value = row.values.get(column)
            if not row.automatic or value is None:
                cells.append("<td></td>")
            else:
                shown = f"{float(value):.{view.ton_precision}f}".rstrip("0").rstrip(".")
                cells.append(f"<td>{_escape(shown)}</td>")
        rows_html.append("<tr>" + "".join(cells) + "</tr>")
    return {
        "laboratory": _escape(view.laboratory),
        "period": _escape(view.period),
        "created_label": _escape(view.created_label),
        "created_at": _escape(view.created_at),
        "title": _escape(view.title),
        "columns": columns_html,
        "rows": "".join(rows_html),
        "preliminary": PRELIMINARY_LABEL if not view.official else "",
    }


def _fill(template: str, mapping: dict[str, str]) -> str:
    return TOKEN.sub(lambda match: mapping.get(match.group(1), ""), template)


def _run_engine(html: str, callback: Any) -> bytes:
    from xhtml2pdf import pisa

    destination = io.BytesIO()
    try:
        result = pisa.CreatePDF(
            html,
            dest=destination,
            encoding="utf-8",
            link_callback=callback,
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


def _check_a4(data: bytes, *, landscape_allowed: bool) -> None:
    try:
        reader = PdfReader(io.BytesIO(data))
        box = reader.pages[0].mediabox
        portrait = abs(float(box.width) - A4_PT[0]) <= 3 and abs(float(box.height) - A4_PT[1]) <= 3
        landscape = abs(float(box.width) - A4_PT[1]) <= 3 and abs(float(box.height) - A4_PT[0]) <= 3
        ok = portrait or (landscape_allowed and landscape)
        if len(reader.pages) == 0 or not ok:
            raise RendererUnavailable("Движок рендера вернул страницу не формата A4.")
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001
        raise RendererUnavailable(f"Результат рендера нечитаем: {error}.") from error


def _render_conclusion_svg(template: str, mapping: dict[str, str], form: FormManifest) -> bytes:
    """ТЗ DR56 §5: fill the controlled SVG and convert it to one A4 PDF.

    The filled SVG is written next to its approved assets (``assets/``) so the
    relative coat reference resolves inside the controlled resources only;
    the file is ephemeral. Every string node gets the manifest-registered
    Cyrillic font (svglib has no @font-face), and the coat image is swapped
    onto the hash-verified asset before rendering (fail-closed).
    """
    import os
    import tempfile

    from reportlab.graphics import renderPDF
    from reportlab.graphics.shapes import Group, Image, String
    from reportlab.pdfgen import canvas as pdfcanvas
    from svglib.svglib import svg2rlg

    filled = _wrap_long_tokens(template, mapping)
    filled = _fill(filled, mapping)
    drawing = None
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".svg", encoding="utf-8", dir=FORMS_DIR, delete=False) as handle:
            tmp_path = handle.name
            handle.write(filled)
        drawing = svg2rlg(tmp_path)
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001 - engine failures stay 503
        raise RendererUnavailable(f"Движок рендера формы недоступен: {error}.") from error
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    if drawing is None:
        raise RendererUnavailable("Движок рендера формы не вернул графику SVG.")

    font_name = form.fonts[0].resource.rsplit(".", 1)[0]

    def restyle(group: object) -> None:
        for node in getattr(group, "contents", []):
            if isinstance(node, Group):
                restyle(node)
            elif isinstance(node, String):
                node.fontName = font_name

    def swap_images(group: object) -> None:
        for node in getattr(group, "contents", []):
            if isinstance(node, Image):
                # svglib resolved the relative href at parse time; the real
                # image data is swapped onto the hash-verified asset here.
                node.path = str(asset_file(form, "russia-coat-small.png"))
            elif isinstance(node, Group):
                swap_images(node)

    restyle(drawing)
    swap_images(drawing)

    scale = min(A4_PT[0] / SVG_W, A4_PT[1] / SVG_H)

    class _SvgCanvas(pdfcanvas.Canvas):
        def __init__(self, destination: Any) -> None:
            super().__init__(destination, pagesize=A4_PT)
            self.scale(scale, scale)

    destination = io.BytesIO()
    svg_canvas = _SvgCanvas(destination)
    try:
        renderPDF.draw(drawing, svg_canvas, 0, 0)
        svg_canvas.showPage()
        svg_canvas.save()
    except Exception as error:  # noqa: BLE001
        raise RendererUnavailable(f"Движок рендера формы недоступен: {error}.") from error
    data = destination.getvalue()
    if not data.startswith(b"%PDF-"):
        raise RendererUnavailable("Движок рендера формы не вернул PDF-файл.")
    _check_a4(data, landscape_allowed=False)
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

    if form.template.endswith(".svg"):
        # ТЗ DR56 §5: the dynamic SVG composition of the reference form is
        # filled with escaped values and converted to one A4 PDF by the
        # declared svglib/reportlab pipeline.
        return _render_conclusion_svg(template, mapping, form)
    html = _fill(template, mapping)

    data = _run_engine(html, _strict_link_callback(form))
    _check_a4(data, landscape_allowed=True)
    return data
