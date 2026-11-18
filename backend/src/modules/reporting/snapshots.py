"""Short REPEATABLE READ report preview and session-bound HMAC verification."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import cast

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
    ROW_CODES,
    AnimalColumn,
    ClassificationMap,
    MaterialKind,
    ReportPreviewParams,
    ReportSource,
    SignedPreview,
    SpeciesClassification,
)

MAX_PAYLOAD_BYTES = 32 * 1024 * 1024
# The signed payload schema version this server builds and verifies.
SUPPORTED_PAYLOAD_VERSION = 2


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _problem(code: str, detail: str, *, status: int = 422) -> ProblemError:
    return ProblemError(status=status, code=code, title=code.replace("_", " ").title(), detail=detail)


def _plain(value: Decimal) -> str:
    result = format(value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


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

    versions = list((await db.execute(select(distinct(ReportClassification.version)))).scalars())
    if len(versions) != 1:
        raise _problem(
            "REPORT_MAPPING_INVALID",
            "Для отчёта должна быть настроена ровно одна версия классификации продукции.",
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
    mapping = build_classification_map(
        version,
        [
            SpeciesClassification(
                mercury_species_id=row.mercury_species_id,
                animal_column=cast(AnimalColumn, row.animal_column),
                material_kind=cast(MaterialKind, row.material_kind),
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
        for row_index, row_code in enumerate(ROW_CODES):
            for column_index, column in enumerate(COLUMNS):
                value = contribution.rows[row_code][column]
                if value:
                    nonzero.append([row_index, column_index, _plain(value)])
        compact_sources.append([source.id.hex, source.revision, nonzero])

    return {
        "version": 2,
        "report_type": params.report_type,
        "laboratory_id": str(params.laboratory_id),
        "laboratory": laboratory,
        "date_from": params.date_from.isoformat(),
        "date_to": params.date_to.isoformat(),
        "generated_at": now.isoformat(),
        "actor_id": str(actor_id),
        "classification_version": mapping.version,
        "columns": list(COLUMNS),
        "row_codes": list(ROW_CODES),
        "matrix": [[_plain(matrix.rows[row][column]) for column in COLUMNS] for row in ROW_CODES],
        "sources": compact_sources,
        "source_count": len(sources),
        "ton_precision": 6,
        "official": False,
    }


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
