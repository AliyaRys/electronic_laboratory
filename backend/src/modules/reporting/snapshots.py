"""Short REPEATABLE READ report preview and session-bound HMAC verification."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.src.core.clock import utcnow
from backend.src.core.keyring import PreviewKeyring, get_preview_keyring
from backend.src.core.problems import ProblemError
from backend.src.modules.catalog_pricing.models import ReportClassification
from backend.src.modules.identity.models import Laboratory
from backend.src.modules.reporting.calculator import build_classification_map, calculate_5vet
from backend.src.modules.reporting.queries import list_report_sources
from backend.src.modules.reporting.schemas import (
    COLUMNS,
    SECTION_III_ROW_CODES,
    SECTION_III_ROWS,
    ClassificationMap,
    ReportMatrix,
    ReportPreviewParams,
    ReportSource,
    SignedPreview,
    SpeciesClassification,
)

MAX_PAYLOAD_BYTES = 32 * 1024 * 1024
# The signed payload schema version this server builds and verifies.
SUPPORTED_PAYLOAD_VERSION = 2
# The printed-form catalogue version carried by every v2 payload (DR51 §4):
# the full 47-row/8-column section III matrix lives inside the payload.
SUPPORTED_FORM_VERSION = "2"


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _problem(code: str, detail: str, *, status: int = 422) -> ProblemError:
    return ProblemError(status=status, code=code, title=code.replace("_", " ").title(), detail=detail)


def _plain(value: Decimal) -> str:
    result = format(value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def _full_matrix(matrix: ReportMatrix) -> list[list[object]]:
    """The 47×8 payload matrix: AUTO numbers (incl. ``0``), BLANK ``null``.

    The calculator fills only the automatic rows (166–172, 210, 240–242);
    every BLANK row of the canonical catalogue stays ``null`` — an honest
    empty cell, never «Не рассчитывается», «—» or a forged zero (DR51 §2.3).
    """
    result: list[list[object]] = []
    for row in SECTION_III_ROWS:
        if row.mode == "AUTO":
            values = matrix.rows[row.code]
            result.append([_plain(values[column]) for column in matrix.columns])
        else:
            result.append([None] * len(matrix.columns))
    return result


def _signature_input(payload: dict[str, object], key_id: str, session_id: str, actor_id: uuid.UUID) -> bytes:
    return canonical_json(
        {
            "payload": payload,
            "key_id": key_id,
            "session_id": session_id,
            "actor_id": str(actor_id),
            "laboratory_id": payload.get("laboratory_id"),
            "report_type": payload.get("report_type"),
            "date_from": payload.get("date_from"),
            "date_to": payload.get("date_to"),
        }
    )


async def _load_facts(
    db: AsyncSession, params: ReportPreviewParams
) -> tuple[dict[str, str], ClassificationMap, list[ReportSource]]:
    """Read every mutable fact inside the short consistent transaction."""
    lab = (await db.execute(select(Laboratory).where(Laboratory.id == params.laboratory_id))).scalar_one_or_none()
    if lab is None:
        raise _problem("NOT_FOUND", "Лаборатория не найдена.", status=404)

    versions = sorted((await db.execute(select(distinct(ReportClassification.version)))).scalars())
    # DR49 §2.6: the honest reasons differ — 0 versions is an unseeded
    # installation, >1 is a configuration error; neither silently proceeds.
    if len(versions) != 1:
        if not versions:
            raise _problem("REPORT_MAPPING_INVALID", "Классификация продукции для отчёта не настроена.")
        raise _problem(
            "REPORT_MAPPING_INVALID",
            "Обнаружено несколько версий классификации; требуется исправление конфигурации.",
        )
    version = versions[0]
    rows = list(
        (
            await db.execute(
                select(ReportClassification)
                .where(ReportClassification.version == version)
                .order_by(ReportClassification.mercury_species_id)
            )
        ).scalars()
    )
    # Runtime lookup is by GUID only; the (nullable) animal column and material
    # kind are honest data of the row — never cast() into validity.
    mapping = build_classification_map(
        version,
        [
            SpeciesClassification(
                mercury_species_id=row.mercury_species_id,
                animal_column=row.animal_column,  # type: ignore[arg-type]
                material_kind=row.material_kind,  # type: ignore[arg-type]
                supported=row.supported,
            )
            for row in rows
        ],
    )
    sources = await list_report_sources(db, params.laboratory_id, params.date_from, params.date_to)
    if not sources:
        raise _problem("REPORT_NO_DATA", "За выбранный период нет завершённых источников отчёта.")
    return {"name": lab.name, "address": lab.address, "organization": lab.organization}, mapping, sources


def _build_payload(
    laboratory: dict[str, str],
    mapping: ClassificationMap,
    sources: list[ReportSource],
    actor_id: uuid.UUID,
    params: ReportPreviewParams,
    now: datetime,
) -> dict[str, object]:
    """Calculate and compact detached facts after releasing the DB snapshot."""
    matrix = calculate_5vet(sources, mapping)
    compact_sources: list[list[object]] = []
    for source in sources:
        contribution = calculate_5vet([source], mapping)
        nonzero: list[list[object]] = []
        for row_index, row_code in enumerate(SECTION_III_ROW_CODES):
            if row_code not in contribution.rows:  # pragma: no cover - catalogue guard
                continue
            for column_index, column in enumerate(COLUMNS):
                value = contribution.rows[row_code][column]
                if value:
                    nonzero.append([row_index, column_index, _plain(value)])
        compact_sources.append([source.id.hex, source.revision, nonzero])

    return {
        "version": 2,
        "form_version": SUPPORTED_FORM_VERSION,
        "report_type": params.report_type,
        "laboratory_id": str(params.laboratory_id),
        "laboratory": laboratory,
        "date_from": params.date_from.isoformat(),
        "date_to": params.date_to.isoformat(),
        "generated_at": now.isoformat(),
        "actor_id": str(actor_id),
        "classification_version": mapping.version,
        "columns": list(COLUMNS),
        "rows": [{"code": row.code, "name": row.name, "mode": row.mode} for row in SECTION_III_ROWS],
        "row_codes": list(SECTION_III_ROW_CODES),
        "matrix": _full_matrix(matrix),
        "sources": compact_sources,
        "source_count": len(sources),
        "ton_precision": 6,
        "official": False,
    }


def _corrupt(detail: str) -> ProblemError:
    return ProblemError(
        status=422,
        code="REPORT_SNAPSHOT_INVALID",
        title="Report snapshot invalid",
        detail=detail,
    )


def adapt_payload(payload: dict[str, object]) -> dict[str, object]:
    """Read-only full-form adapter of any stored snapshot payload (DR51 §4).

    A v2 full-form payload (``form_version == "2"`` with the 47-row
    catalogue) is validated and returned as stored. A legacy compact payload
    (ten ``row_codes``, no ``rows``) is mapped onto the full printed form by
    the SAVED ``row_codes`` — never by position, never recomputed from live
    ВСЭ: missing rows stay ``null`` (row 210 of a legacy report is empty and
    the two bird columns are kept separate exactly as they were saved).
    """
    columns_raw = payload.get("columns")
    if not isinstance(columns_raw, list) or len(columns_raw) != len(COLUMNS) or list(columns_raw) != list(COLUMNS):
        raise _corrupt("Снимок отчёта повреждён: неверный набор колонок животных.")
    matrix_raw = payload.get("matrix")
    if not isinstance(matrix_raw, list):
        raise _corrupt("Снимок отчёта повреждён: матрица отсутствует.")
    if payload.get("form_version") == SUPPORTED_FORM_VERSION and isinstance(payload.get("rows"), list):
        rows = payload["rows"]
        codes = payload.get("row_codes")
        if not isinstance(codes, list) or len(codes) != len(SECTION_III_ROW_CODES) or list(codes) != list(
            SECTION_III_ROW_CODES
        ):
            raise _corrupt("Снимок отчёта повреждён: каталог строк не совпадает с формой.")
        if len(rows) != len(SECTION_III_ROWS) or len(matrix_raw) != len(SECTION_III_ROWS):
            raise _corrupt("Снимок отчёта повреждён: неполный каталог строк.")
        for row, values in zip(SECTION_III_ROWS, matrix_raw, strict=True):
            if not isinstance(values, list) or len(values) != len(COLUMNS):
                raise _corrupt("Снимок отчёта повреждён: неверная длина строки матрицы.")
            for value in values:
                if row.mode == "BLANK":
                    if value is not None:
                        raise _corrupt("Снимок отчёта повреждён: пустая строка содержит значение.")
                elif value is not None and not isinstance(value, str):
                    raise _corrupt("Снимок отчёта повреждён: автоматическая ячейка не число.")
        return payload

    row_codes = payload.get("row_codes")
    if not isinstance(row_codes, list):
        raise _corrupt("Снимок отчёта повреждён: каталог строк отсутствует.")
    if len(matrix_raw) != len(row_codes):
        raise _corrupt("Снимок отчёта повреждён: матрица не совпадает с каталогом строк.")
    saved: dict[str, list[object]] = {}
    for code, values in zip(row_codes, matrix_raw, strict=True):
        if not isinstance(values, list) or len(values) != len(COLUMNS):
            raise _corrupt("Снимок отчёта повреждён: неверная длина строки матрицы.")
        saved[str(code)] = values
    full_matrix: list[list[object]] = []
    for row in SECTION_III_ROWS:
        old = saved.get(row.code)
        # A legacy AUTO row keeps its exact saved numbers; a legacy BLANK row
        # (and any row the compact payload did not carry, incl. 210) is null.
        full_matrix.append(list(old) if row.mode == "AUTO" and old is not None else [None] * len(COLUMNS))
    adapted = dict(payload)
    adapted.update(
        form_version=SUPPORTED_FORM_VERSION,
        rows=[{"code": row.code, "name": row.name, "mode": row.mode} for row in SECTION_III_ROWS],
        row_codes=list(SECTION_III_ROW_CODES),
        matrix=full_matrix,
    )
    return adapted


async def preview_report(
    db: AsyncSession,
    actor_id: uuid.UUID,
    session_id: str,
    params: ReportPreviewParams,
    *,
    keyring: PreviewKeyring | None = None,
    now: datetime | None = None,
) -> SignedPreview:
    """Calculate a non-persistent preview in its own short consistent snapshot.

    DR48 §3.1: any calendar range is allowed — there is no «завершённое
    полугодие» gate; an empty range answers the honest REPORT_NO_DATA.
    """
    instant = now or utcnow()
    bind = db.bind
    if not isinstance(bind, AsyncEngine):
        raise RuntimeError("Preview requires an AsyncEngine-bound session.")
    async with bind.connect() as connection:
        connection = await connection.execution_options(isolation_level="REPEATABLE READ")
        async with AsyncSession(bind=connection, expire_on_commit=False) as snapshot_db, snapshot_db.begin():
            laboratory, mapping, sources = await _load_facts(snapshot_db, params)
    payload = _build_payload(laboratory, mapping, sources, actor_id, params, instant)

    size = len(canonical_json(payload))
    if size > MAX_PAYLOAD_BYTES:
        raise _problem("REPORT_PAYLOAD_TOO_LARGE", "Снимок отчёта превышает предельные 32 МиБ.", status=413)
    ring = keyring or get_preview_keyring()
    key = ring.signing_key(instant)
    signature = hmac.new(key.secret, _signature_input(payload, key.key_id, session_id, actor_id), hashlib.sha256)
    return SignedPreview(payload=payload, key_id=key.key_id, signature=signature.hexdigest(), byte_size=size)


def verify_preview(
    preview: SignedPreview,
    actor_id: uuid.UUID,
    session_id: str,
    *,
    keyring: PreviewKeyring | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    """Verify size, key lifetime and MAC for the current live server session."""
    payload = preview.payload
    if payload.get("version") != SUPPORTED_PAYLOAD_VERSION:
        raise _problem(
            "REPORT_PREVIEW_INVALID",
            f"Preview неподдерживаемой версии ({payload.get('version')}); "
            f"поддерживается версия {SUPPORTED_PAYLOAD_VERSION}.",
        )
    actual_size = len(canonical_json(payload))
    if actual_size > MAX_PAYLOAD_BYTES or preview.byte_size != actual_size:
        raise _problem("REPORT_PREVIEW_INVALID", "Размер preview не совпадает с подписанным содержимым.")
    ring = keyring or get_preview_keyring()
    key = ring.verification_key(preview.key_id, now or utcnow())
    if key is None:
        raise _problem("REPORT_PREVIEW_EXPIRED", "Ключ preview истёк; сформируйте отчёт заново.")
    expected = hmac.new(
        key.secret,
        _signature_input(payload, preview.key_id, session_id, actor_id),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, preview.signature):
        raise _problem("REPORT_PREVIEW_INVALID", "Preview изменён или принадлежит другой сессии.")
    if payload.get("actor_id") != str(actor_id):
        raise _problem("REPORT_PREVIEW_INVALID", "Preview принадлежит другому пользователю.")
    return payload
