"""PDF «Учёт проб» (DR49 §8): one controlled projection → one A4 PDF.

``render_sample_accounting_pdf`` consumes a :class:`SampleAccountingDocumentView`
built from the server read snapshot and the verified ``sample-accounting``
form manifest. The engine rules are the shared ones (SPEC-05): escaped text
values only, a manifest-checked DejaVu font, a denying link callback and an
honest :class:`RendererUnavailable` (→ 503) on any engine failure — never a
partial file.
"""

from __future__ import annotations

import io
import re
from datetime import datetime
from html import escape
from typing import Any

from pypdf import PdfReader
from zoneinfo import ZoneInfo

from backend.src.modules.documents.resources import (
    FormManifest,
    RendererUnavailable,
    read_template,
)
from backend.src.modules.samples.export_schemas import SampleAccountingDocumentView
from backend.src.modules.samples.export_service import format_day, format_mass

__all__ = ["MOSCOW_TZ", "render_sample_accounting_pdf", "sample_accounting_pdf_filename"]

MOSCOW_TZ = ZoneInfo("Europe/Moscow")


def sample_accounting_pdf_filename(view: SampleAccountingDocumentView) -> str:
    from backend.src.modules.samples.export_service import export_filename

    return export_filename("pdf", view.laboratory_name, view.date_from, view.date_to)


def _escape(value: Any) -> str:
    return escape(str(value), quote=False)


def _moscow_stamp(moment: datetime) -> str:
    local = moment.astimezone(MOSCOW_TZ)
    return f"{local.strftime('%d.%m.%Y %H:%M')} (МСК)"


def _balances_rows(view: SampleAccountingDocumentView) -> str:
    if not view.balances:
        return (
            '<tr class="empty"><td colspan="2">Положительных остатков нет.</td></tr>'
        )
    return "".join(
        f"<tr><td>{_escape(row.product_name)}</td><td class='num'>{_escape(format_mass(row.mass_kg))}</td></tr>"
        for row in view.balances
    )


def _disposals_rows(view: SampleAccountingDocumentView) -> str:
    if not view.disposals:
        return (
            f"<tr class=\"empty\"><td colspan=\"5\">{_escape(view.empty_history_text())}</td></tr>"
        )
    return "".join(
        "<tr>"
        f"<td>{_escape(format_day(row.disposed_on))}</td>"
        f"<td>{_escape(row.product_name)}</td>"
        f"<td class='num'>{_escape(format_mass(row.mass_kg))}</td>"
        f"<td>{_escape(row.external_vsd_number)}</td>"
        f"<td>{_escape(row.actor_name)}</td>"
        "</tr>"
        for row in view.disposals
    )


_TOKEN = re.compile(r"\{\{(\w+)\}\}")


def render_sample_accounting_pdf(
    view: SampleAccountingDocumentView, form: FormManifest
) -> bytes:
    """Render the accounting document to A4 PDF through the verified template."""
    from backend.src.modules.documents.pdf import _register_fonts, _run_engine

    template = read_template(form)
    try:
        _register_fonts(form)
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001
        raise RendererUnavailable(f"Шрифт формы недоступен: {error}.") from error

    mapping = {
        "laboratory": _escape(view.laboratory_name),
        "period": _escape(view.period_label()),
        "generated_at": _escape(_moscow_stamp(view.generated_at)),
        "balances_rows": _balances_rows(view),
        "disposals_rows": _disposals_rows(view),
    }
    html = _TOKEN.sub(lambda match: mapping.get(match.group(1), ""), template)

    data = _run_engine(html)
    try:
        reader = PdfReader(io.BytesIO(data))
        box = reader.pages[0].mediabox
        if len(reader.pages) == 0 or abs(float(box.width) - 595.28) > 3 or abs(float(box.height) - 841.89) > 3:
            raise RendererUnavailable("Движок рендера вернул страницу не формата A4.")
    except RendererUnavailable:
        raise
    except Exception as error:  # noqa: BLE001
        raise RendererUnavailable(f"Результат рендера нечитаем: {error}.") from error
    return data
