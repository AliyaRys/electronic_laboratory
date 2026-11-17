"""ТЗ DR40 §10 (API/reconciliation): typed accompanyingDocuments + documentChecks.

Покрывает:

1. ``IncomingView``/``_external_fields`` отдаёт typed ``accompanyingDocuments``
   с key/order/label;
2. новый ``documentChecks`` валидируется и сохраняется атомарно со сверкой;
3. mismatch документа требует структурированный actual и reason;
4. документы с одинаковыми полями получают разные occurrence keys;
5. перестановка source list не переносит отметки на другой документ;
6. старые ``CHK-F25/26/27`` читаются без миграции и не копируются на все
   документы;
7. ActPreview показывает конкретный документ (stability key, source, actual,
   reason), а не только общий CHK-F25.
"""

from __future__ import annotations

import uuid
from dataclasses import replace

import pytest

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.models import Reconciliation
from backend.src.modules.arrivals.queries import accompanying_documents_of
from backend.src.modules.arrivals.reconciliation import (
    save_reconciliation,
    source_projection,
)
from backend.src.modules.arrivals.schemas import (
    AccompanyingDocumentView,
    Comparison,
    QuantitySet,
    ReconciliationWrite,
    Transaction,
)
from backend.src.modules.arrivals.validation import (
    IncomingDocument,
    ReceiptCapabilities,
    validate_receipt,
)
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_import_and_queues import (
    UNIT_KG as KG_GUID,
)
from backend.tests.arrivals.test_import_and_queues import (
    document,
    lab,  # noqa: F401
    snapshot,
)
from backend.tests.arrivals.test_reconciliation import source

CAPS = ReceiptCapabilities()
KG = str(KG_GUID)


def write_payload(**overrides: object) -> ReconciliationWrite:
    base: dict[str, object] = {
        "checks": {
            "CHK-F05": Comparison(matches=True),
            "CHK-F06": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=True),
        },
        "documentChecks": {},
        "inspection": {"compartment": "COMPLIANT", "jointCarriage": "NONE"},
        "delivered": QuantitySet(mass_kg="120.0", quantity="4", unit_id=KG),
        "accepted": QuantitySet(mass_kg="120.0", quantity="4", unit_id=KG),
        "returned": QuantitySet(mass_kg="0", quantity="0", unit_id=KG),
        "decision": "ACCEPT_ALL",
        "repeat": None,
        "transaction": Transaction(planned=False, type=None),
        "fair": False,
        "services": [],
    }
    base.update(overrides)
    return ReconciliationWrite.model_validate(base)  # type: ignore[arg-type]


TWO_DOCUMENTS = [
    {"issueSeries": "0006", "issueNumber": "5555", "issueDate": "2026-11-16", "type": "1", "relationshipType": "1"},
    {"issueSeries": "33333", "issueNumber": "66666", "issueDate": "2026-11-16", "type": "6", "relationshipType": "6"},
]


def source_with_documents(
    documents: list[dict[str, object]] | None = TWO_DOCUMENTS,
    transport_document: dict[str, object] | None = None,
    **fields: object,
) -> IncomingDocument:
    """The validator's source projection carrying typed accompanying documents."""
    if documents is None:
        documents = []
    if transport_document is None:
        transport_document = documents[0] if documents else None
    docs = accompanying_documents_of({"referencedDocuments": documents})
    return replace(
        source(**fields),
        accompanying_documents=tuple(docs),  # type: ignore[arg-type]
        primary_document_key=(
            AccompanyingDocumentView  # placeholder replaced below
            and _primary_key(transport_document, docs)
        ),
    )


def _primary_key(transport: dict[str, object] | None, docs: tuple[AccompanyingDocumentView, ...]) -> str | None:
    if not transport:
        return None

    def as_text(value: object) -> str | None:
        return None if value is None else str(value)

    from backend.src.modules.arrivals.queries import accompanying_document_key

    expected = accompanying_document_key(
        type_code=as_text(transport.get("type")),
        relationship_type=as_text(transport.get("relationshipType")),
        series=as_text(transport.get("issueSeries")),
        number=as_text(transport.get("issueNumber")),
        created_on=as_text(transport.get("issueDate")),
    )
    for item in docs:
        if item.key.split("#", 1)[0] == expected:
            return item.key
    return None


def blocking_ids(result: object) -> set[str]:
    return {item.field_id or "" for item in result.blocking}  # type: ignore[attr-defined]


def error_ids(result: object) -> set[str]:
    return {item.field_id or "" for item in result.errors}  # type: ignore[attr-defined]


def act_fields(result: object) -> set[str]:
    return {item.field_id for item in result.act.items}  # type: ignore[attr-defined]


def key_of(type_code: str, series: str, number: str, relationship_type: str = "1") -> str:
    docs = accompanying_documents_of(
        {
            "referencedDocuments": [
                {
                    "issueSeries": series,
                    "issueNumber": number,
                    "issueDate": "2026-11-16",
                    "type": type_code,
                    "relationshipType": relationship_type,
                }
            ]
        }
    )
    assert len(docs) == 1
    return docs[0].key


# --- 1: read model -------------------------------------------------------------


def test_accompanying_documents_projection() -> None:
    docs = accompanying_documents_of({"referencedDocuments": TWO_DOCUMENTS})
    assert [item.source_order for item in docs] == [0, 1]
    assert [item.type_label for item in docs] == [
        "Товарно-транспортная накладная",
        "ТОРГ-12",
    ]
    assert docs[0].series_and_number == "0006 5555"
    assert docs[0].created_on == "2026-11-16"
    assert docs[0].key != docs[1].key


def test_accompanying_documents_empty_and_none_payload() -> None:
    assert accompanying_documents_of({}) == []
    assert accompanying_documents_of({"referencedDocuments": []}) == []


async def test_incoming_view_publishes_accompanying_documents(vet_env: object) -> None:
    """API test: build_incoming_view exposes the typed array with labels."""
    from backend.src.modules.arrivals.queries import build_incoming_view

    env = vet_env  # type: ignore[assignment]
    snap = snapshot().model_copy(deep=True)
    payload = snap.vd_document
    snap = snap.model_copy(
        update={
            "vd_document": payload.model_copy(
                update={
                    "referenced_documents": [
                        {
                            "issueSeries": "0006",
                            "issueNumber": "5555",
                            "issueDate": "2026-11-16",
                            "type": "1",
                            "relationshipType": "1",
                        },
                        {"issueNumber": "66666", "issueDate": "2026-11-16", "type": "6"},
                    ],
                    "transport_document": {
                        "issueSeries": "0006",
                        "issueNumber": "5555",
                        "issueDate": "2026-11-16",
                        "type": "1",
                        "relationshipType": "1",
                    },
                }
            )
        }
    )
    doc_input = document(uuid.uuid4(), env.own.id)
    doc_input = doc_input.model_copy(update={"snapshot": snap})
    party = await commands.upsert_incoming(env.db, doc_input)  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    from sqlalchemy import select as _select

    from backend.src.modules.arrivals.models import IncomingDocument as _Row

    row = (await env.db.execute(_select(_Row).where(_Row.id == party.incoming_document_id))).scalar_one()  # type: ignore[attr-defined]
    view = await build_incoming_view(env.db, party, row)  # type: ignore[attr-defined]
    documents = view.external.accompanying_documents
    assert [item.type_label for item in documents] == ["Товарно-транспортная накладная", "ТОРГ-12"]
    assert documents[0].series_and_number == "0006 5555"
    assert documents[1].series is None and documents[1].series_and_number == "66666"
    # The legacy flat fields stay (compatibility, §6.2).
    assert view.external.fields["transportDocumentNumber"] == "5555"


# --- 4: occurrence keys ----------------------------------------------------------


def test_identical_documents_get_distinct_occurrence_keys() -> None:
    docs = accompanying_documents_of({"referencedDocuments": [TWO_DOCUMENTS[0], TWO_DOCUMENTS[0]]})
    assert docs[0].key != docs[1].key
    assert docs[0].key == docs[1].key.split("#", 1)[0]


def test_key_is_deterministic_and_field_based() -> None:
    assert key_of("1", "0006", "5555") == key_of("1", "0006", "5555")
    assert key_of("1", "0006", "5555") != key_of("6", "0006", "5555")


def test_reordering_keeps_keys_with_documents() -> None:
    """Перестановка списка не переносит отметку на другой документ."""
    straight = accompanying_documents_of({"referencedDocuments": TWO_DOCUMENTS})
    reversed_order = accompanying_documents_of({"referencedDocuments": list(reversed(TWO_DOCUMENTS))})
    assert {item.key for item in straight} == {item.key for item in reversed_order}


# --- 2/3: documentChecks validation ---------------------------------------------


def test_document_check_unknown_key_is_blocked() -> None:
    payload = write_payload(documentChecks={"no-such-key": {"matches": True}})
    result = validate_receipt(payload, source_with_documents(), CAPS)
    assert blocking_ids(result) != set()
    assert any("не существует" in item.message or "нет в текущем" in item.message for item in result.blocking)


def test_document_check_removed_document_key_is_blocked() -> None:
    payload = write_payload(documentChecks={key_of("9", "", "123"): {"matches": True}})
    result = validate_receipt(payload, source_with_documents(), CAPS)
    assert blocking_ids(result) != set()


def test_document_mismatch_requires_actual_and_reason() -> None:
    key = key_of("6", "33333", "66666", "6")
    payload = write_payload(documentChecks={key: {"matches": False}})
    result = validate_receipt(payload, source_with_documents(), CAPS)
    assert "CHK-F42" in error_ids(result)
    assert "CHK-F43" in error_ids(result)


def test_document_mismatch_with_actual_and_reason_is_valid() -> None:
    key = key_of("6", "33333", "66666", "6")
    payload = write_payload(
        documentChecks={
            key: {
                "matches": False,
                "actual": {"typeCode": "6", "series": "33333", "number": "66666", "createdOn": "2026-11-16"},
                "reason": "Номер не совпадает",
            }
        }
    )
    result = validate_receipt(payload, source_with_documents(), CAPS)
    assert blocking_ids(result) == set()
    assert "CHK-F42" not in error_ids(result) and "CHK-F43" not in error_ids(result)


def test_document_matches_needs_no_facts() -> None:
    key = key_of("1", "0006", "5555")
    payload = write_payload(documentChecks={key: {"matches": True}})
    result = validate_receipt(payload, source_with_documents(), CAPS)
    assert blocking_ids(result) == set()
    assert "CHK-F42" not in error_ids(result)


# --- 6: legacy CHK-F25/26/27 ------------------------------------------------------


def test_legacy_transport_marks_still_required_without_document_checks() -> None:
    transport = {
        "issueSeries": "0006",
        "issueNumber": "5555",
        "issueDate": "2026-11-16",
        "type": "1",
        "relationshipType": "1",
    }
    legacy_source = source_with_documents(
        transport_document=transport,
        transportDocumentType="Товарно-транспортная накладная",
        transportDocumentNumber="5555",
        transportDocumentIssuedOn="2026-11-16",
    )
    payload = write_payload()
    result = validate_receipt(payload, legacy_source, CAPS)
    assert "CHK-F25" in error_ids(result)
    assert "CHK-F26" in error_ids(result)
    assert "CHK-F27" in error_ids(result)


def test_primary_document_mark_satisfies_legacy_fields() -> None:
    transport = {
        "issueSeries": "0006",
        "issueNumber": "5555",
        "issueDate": "2026-11-16",
        "type": "1",
        "relationshipType": "1",
    }
    marked_source = source_with_documents(
        transport_document=transport,
        transportDocumentType="Товарно-транспортная накладная",
        transportDocumentNumber="5555",
        transportDocumentIssuedOn="2026-11-16",
    )
    payload = write_payload(documentChecks={marked_source.primary_document_key: {"matches": True}})  # type: ignore[dict-item]
    result = validate_receipt(payload, marked_source, CAPS)
    assert "CHK-F25" not in error_ids(result)
    assert "CHK-F26" not in error_ids(result)
    assert "CHK-F27" not in error_ids(result)


def test_primary_mismatch_does_not_satisfy_legacy_fields() -> None:
    transport = {
        "issueSeries": "0006",
        "issueNumber": "5555",
        "issueDate": "2026-11-16",
        "type": "1",
        "relationshipType": "1",
    }
    marked_source = source_with_documents(
        transport_document=transport,
        transportDocumentType="Товарно-транспортная накладная",
        transportDocumentNumber="5555",
        transportDocumentIssuedOn="2026-11-16",
    )
    key = marked_source.primary_document_key
    assert key is not None
    payload = write_payload(
        documentChecks={key: {"matches": False, "actual": {"typeCode": "1"}, "reason": "Другой документ"}}
    )
    result = validate_receipt(payload, marked_source, CAPS)
    # The document is marked «не соответствует»: the legacy per-field marks are
    # not silently auto-satisfied.
    assert "CHK-F25" in error_ids(result)


# --- 7: act preview shows the concrete document -----------------------------------


def test_act_preview_carries_concrete_document() -> None:
    key = key_of("6", "33333", "66666", "6")
    payload = write_payload(
        documentChecks={
            key: {
                "matches": False,
                "actual": {"typeCode": "6", "series": "33333", "number": "66666", "createdOn": "2026-11-16"},
                "reason": "Данные накладной не совпадают",
            }
        }
    )
    result = validate_receipt(payload, source_with_documents(), CAPS)
    field_ids = act_fields(result)
    assert f"documents.{key}" in field_ids
    item = next(entry for entry in result.act.items if entry.field_id == f"documents.{key}")
    assert "ТОРГ-12" in (item.source or "")
    assert "66666" in item.actual
    assert item.reason == "Данные накладной не совпадают"


# --- 2: atomic save through the real command ---------------------------------------


@pytest.fixture(name="vet_env")
async def _vet_env_fixture(arrivals_vet_env: object) -> object:  # noqa: F811
    """Re-export the arrivals API fixture under this module's fixture scope."""
    return arrivals_vet_env


def _snapshot_with_documents() -> object:
    snap = snapshot().model_copy(deep=True)
    snap = snap.model_copy(
        update={
            "vd_document": snap.vd_document.model_copy(
                update={
                    "transport_document": {
                        "issueSeries": "0006",
                        "issueNumber": "5555",
                        "issueDate": "2026-11-16",
                        "type": "1",
                        "relationshipType": "1",
                    },
                    "referenced_documents": TWO_DOCUMENTS,
                }
            )
        }
    )
    return snap


async def test_document_checks_saved_with_reconciliation(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    doc_input = document(uuid.uuid4(), env.own.id).model_copy(update={"snapshot": _snapshot_with_documents()})  # type: ignore[attr-defined]
    party = await commands.upsert_incoming(env.db, doc_input)  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    from sqlalchemy import select

    from backend.src.modules.arrivals.models import IncomingDocument as Row

    incoming = (await env.db.execute(select(Row).where(Row.id == party.incoming_document_id))).scalar_one()  # type: ignore[attr-defined]
    projection = source_projection(incoming, party)
    assert projection.primary_document_key is not None
    key_primary = projection.primary_document_key
    docs = [item.key for item in projection.accompanying_documents]
    assert len(docs) == 2 and key_primary in docs

    other = next(key for key in docs if key != key_primary)
    payload = write_payload(
        documentChecks={
            key_primary: {"matches": True},
            other: {
                "matches": False,
                "actual": {"typeCode": "6", "series": "33333", "number": "66666", "createdOn": "2026-11-16"},
                "reason": "Номер в накладной другой",
            },
        }
    )
    # The snapshot fixture carries no subProduct/owner name: CHK-F06/F17 are
    # informational absences and take no fictitious marks.
    payload.checks.pop("CHK-F06")
    payload.checks.pop("CHK-F17")
    ctx = CommandContext(actor_id=env.vet.id, idempotency_key=str(uuid.uuid4()), expected_revision=1)  # type: ignore[attr-defined]
    view = await save_reconciliation(ctx, party.id, payload, uow=env.db)  # type: ignore[attr-defined]
    assert view.document_checks[key_primary].matches is True
    assert view.document_checks[other].reason == "Номер в накладной другой"
    stored = (await env.db.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))).scalar_one()  # type: ignore[attr-defined]
    assert "documentChecks" in stored.checks
    await env.db.rollback()  # type: ignore[attr-defined]


async def test_document_check_unknown_key_rejected_at_save(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    doc_input = document(uuid.uuid4(), env.own.id).model_copy(update={"snapshot": _snapshot_with_documents()})  # type: ignore[attr-defined]
    party = await commands.upsert_incoming(env.db, doc_input)  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    payload = write_payload(documentChecks={"deadbeef000000000000": {"matches": True}})
    ctx = CommandContext(actor_id=env.vet.id, idempotency_key=str(uuid.uuid4()), expected_revision=1)  # type: ignore[attr-defined]
    with pytest.raises(ProblemError) as raised:
        await save_reconciliation(ctx, party.id, payload, uow=env.db)  # type: ignore[attr-defined]
    assert raised.value.status == 422
    await env.db.rollback()  # type: ignore[attr-defined]


# --- 9 (from backend block): registry labels surface through the act source ----


def test_document_actual_renders_registry_label() -> None:
    docs = source_with_documents().accompanying_documents
    assert docs[1].type_label == "ТОРГ-12"
    assert docs[0].type_label == "Товарно-транспортная накладная"
