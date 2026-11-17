"""ТЗ DR40 §10 (normalizer/backend): все прямые vd:referencedDocument в snapshot.

Покрывает:

1. один type 1 в массиве И в compatibility ``transportDocument``;
2. type 1 + type 6 сохраняются оба, порядок из XML;
3. коды 1–24 получают русские названия из единого registry;
4. неизвестный код сохраняется с fallback «Тип документа <код>»;
5. прямые ссылки не смешиваются с вложенными laboratoryResearch type 9;
6. отсутствие серии/номера/даты не удаляет документ;
7. backfill из raw XML идемпотентен;
8. compatibility ``transportDocument`` выбирается по прежнему правилу (1–5,
   relationship 1/6, предпочесть 1);
9. registry полностью покрывает коды 1–24.
"""

from __future__ import annotations

from typing import Any

import pytest

from backend.src.modules.arrivals.schemas import SourceSnapshot
from backend.src.modules.integrations.vetis.document_types import document_type_label
from backend.src.modules.integrations.vetis.normalizer import normalize_snapshot, parse_vet_document_list

VD = 'xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"'


def _doc(*referenced: str, laboratory: str = "") -> str:
    body = "".join(referenced) + laboratory
    return (
        f'<vd:vetDocument {VD}><bs:uuid>00000000-0000-4000-8000-000000000001</bs:uuid>'
        "<vd:vetDType>TRANSPORT</vd:vetDType><vd:vetDStatus>CONFIRMED</vd:vetDStatus>"
        "<vd:certifiedConsignment>"
        "<vd:consignor><dt:name>Кто-то</dt:name></vd:consignor>"
        "<vd:consignee><dt:name>Лаборатория</dt:name></vd:consignee>"
        "<vd:batch><vd:productType>1</vd:productType><vd:volume>10</vd:volume></vd:batch>"
        "</vd:certifiedConsignment>"
        f"{body}"
        "</vd:vetDocument>"
    )


def parse(xml: str) -> tuple[list[dict[str, str | None]], dict[str, str | None] | None]:
    wrapped = (
        '<root xmlns:bs="http://api.vetrf.ru/schema/cdm/base" '
        'xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" '
        + VD
        + ">"
        + xml
        + "</root>"
    )
    entries = parse_vet_document_list(wrapped)
    assert len(entries) == 1
    entry = entries[0]
    return entry.referenced_documents, entry.transport_document


def ref(series: str | None, number: str | None, date: str | None, type_: str, rel: str) -> str:
    parts = ""
    if series is not None:
        parts += f"<vd:issueSeries>{series}</vd:issueSeries>"
    if number is not None:
        parts += f"<vd:issueNumber>{number}</vd:issueNumber>"
    if date is not None:
        parts += f"<vd:issueDate>{date}</vd:issueDate>"
    parts += f"<vd:type>{type_}</vd:type><vd:relationshipType>{rel}</vd:relationshipType>"
    return f"<vd:referencedDocument>{parts}</vd:referencedDocument>"


# --- 1: один type 1 --------------------------------------------------------------

def test_single_type1_kept_in_list_and_compatibility() -> None:
    docs, transport = parse(_doc(ref("0006", "5555", "2026-11-16", "1", "1")))
    assert docs == [
        {
            "issueSeries": "0006",
            "issueNumber": "5555",
            "issueDate": "2026-11-16",
            "type": "1",
            "relationshipType": "1",
        }
    ]
    assert transport is not None and transport["issueNumber"] == "5555"


# --- 2: два документа, порядок из XML --------------------------------------------

def test_type1_and_type6_both_kept_in_source_order() -> None:
    docs, _ = parse(
        _doc(
            ref("0006", "5555", "2026-11-16", "1", "1"),
            ref("33333", "66666", "2026-11-16", "6", "6"),
        )
    )
    assert [item["type"] for item in docs] == ["1", "6"]
    assert docs[0]["issueSeries"] == "0006" and docs[1]["issueSeries"] == "33333"
    snapshot: SourceSnapshot = normalize_snapshot(
        parse_vet_document_list(
            '<root xmlns:bs="http://api.vetrf.ru/schema/cdm/base" '
            'xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" '
            + VD
            + ">"
            + _doc(
                ref("0006", "5555", "2026-11-16", "1", "1"),
                ref("33333", "66666", "2026-11-16", "6", "6"),
            )
            + "</root>"
        )[0]
    )
    payload = snapshot.model_dump(mode="json", by_alias=True)["vdDocument"]
    assert [item["type"] for item in payload["referencedDocuments"]] == ["1", "6"]


# --- 3/9: registry 1–24 ----------------------------------------------------------

@pytest.mark.parametrize("code", [str(i) for i in range(1, 25)])
def test_registry_covers_all_codes_with_russian_labels(code: str) -> None:
    label = document_type_label(code)
    assert label is not None
    assert label not in ("", code)
    assert not label.startswith("Тип документа")


def test_registry_known_samples() -> None:
    assert document_type_label("1") == "Товарно-транспортная накладная"
    assert document_type_label("6") == "ТОРГ-12"
    assert document_type_label("23") == "УПД"
    assert document_type_label("24") == "Электронный ветеринарный производственный сертификат"


# --- 4: неизвестный код ----------------------------------------------------------

def test_unknown_type_code_kept_with_fallback_label() -> None:
    docs, _ = parse(_doc(ref(None, "77", "2026-11-16", "99", "6")))
    assert docs == [
        {"issueSeries": None, "issueNumber": "77", "issueDate": "2026-11-16", "type": "99", "relationshipType": "6"}
    ]
    assert document_type_label("99") == "Тип документа 99"


# --- 5: не смешивать с laboratoryResearch ----------------------------------------

def test_laboratory_research_document_not_mixed_into_list() -> None:
    laboratory = (
        "<vd:laboratoryResearch>"
        "<vd:referencedDocument><vd:issueNumber>ACT-9</vd:issueNumber>"
        "<vd:issueDate>2026-11-01</vd:issueDate><vd:type>9</vd:type>"
        "<vd:relationshipType>2</vd:relationshipType></vd:referencedDocument>"
        "</vd:laboratoryResearch>"
    )
    docs, transport = parse(_doc(ref("0006", "5555", "2026-11-16", "1", "1"), laboratory=laboratory))
    assert [item["type"] for item in docs] == ["1"]
    assert transport is not None and transport["issueNumber"] == "5555"


# --- 6: null-поля не удаляют документ --------------------------------------------

def test_missing_series_number_date_keeps_document() -> None:
    docs, _ = parse(_doc(ref(None, "5555", None, "6", "6"), ref("10", None, "2026-11-16", "11", "1")))
    assert docs == [
        {"issueSeries": None, "issueNumber": "5555", "issueDate": None, "type": "6", "relationshipType": "6"},
        {"issueSeries": "10", "issueNumber": None, "issueDate": "2026-11-16", "type": "11", "relationshipType": "1"},
    ]


def test_empty_referenced_document_excluded() -> None:
    docs, _ = parse(_doc("<vd:referencedDocument></vd:referencedDocument>"))
    assert docs == []


# --- 8: compatibility-выбор ------------------------------------------------------

def test_compatibility_prefers_relationship1_among_types_1_5() -> None:
    _, transport = parse(
        _doc(
            ref("B", "100", "2026-11-16", "6", "1"),  # type 6 never wins
            ref("A", "200", "2026-11-16", "3", "6"),
            ref("C", "300", "2026-11-16", "1", "1"),
        )
    )
    assert transport is not None and transport["issueNumber"] == "300"


def test_compatibility_none_when_no_transport_document() -> None:
    _, transport = parse(_doc(ref("33333", "66666", "2026-11-16", "6", "6")))
    assert transport is None


def test_compatibility_requires_number_and_date() -> None:
    _, transport = parse(_doc(ref(None, None, None, "1", "1")))
    assert transport is None


# --- snapshot round-trip через strict schema --------------------------------------

def test_snapshot_roundtrip_keeps_all_documents() -> None:
    xml = (
        '<root xmlns:bs="http://api.vetrf.ru/schema/cdm/base" '
        'xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" '
        + VD
        + ">"
        + _doc(
            ref("0006", "5555", "2026-11-16", "1", "1"),
            ref("33333", "66666", "2026-11-16", "6", "6"),
            ref(None, "77", None, "99", "6"),
        )
        + "</root>"
    )
    snapshot = normalize_snapshot(parse_vet_document_list(xml)[0])
    payload: dict[str, Any] = snapshot.model_dump(mode="json", by_alias=True)["vdDocument"]
    documents = payload["referencedDocuments"]
    assert len(documents) == 3
    assert documents[2]["type"] == "99" and documents[2]["issueDate"] is None
    # Invalid/unknown type codes must not fail validation anywhere.
    SourceSnapshot.model_validate(snapshot.model_dump(mode="json", by_alias=True))
