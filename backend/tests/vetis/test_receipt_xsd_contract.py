"""ТЗ DR38 §7 Task 1: официальный офлайн XSD-gate для ProcessIncomingConsignment v2.

Схемы закреплены из промышленного набора ВетИС.API v2.0-last
(api.vetrf.ru/schema/platform/services/2.0-last) в
``backend/tests/fixtures/vetis/xsd/``. ``manifest.sha256`` хранит SHA-256
каждого файла; тест сверяет хеши, чтобы пиннинг не менялся незаметно.

Валидируются все шесть обезличенных contract fragments
``scenario-1.x.y.xml`` (namespace mercvu = mercury/vu/applications/v2)
официальной схемой ``mercury_vu_applications_v2.0.xsd`` и её импортами
(base_v1.1, application_v1.1, dictionary_v2.0, document_v2.0).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from lxml import etree

XSD_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "vetis" / "xsd"
SCENARIOS = Path(__file__).resolve().parents[1] / "fixtures" / "vetis" / "process_incoming_consignment"
OPERATION_SCHEMA = "mercury_vu_applications_v2.0.xsd"


def _load_schema() -> etree.XMLSchema:
    doc = etree.parse(str(XSD_DIR / OPERATION_SCHEMA))
    return etree.XMLSchema(doc)


def test_manifest_hashes_match_pinned_schema_files() -> None:
    """SHA-256 каждого закреплённого файла совпадает с manifest.sha256."""
    manifest_lines = [
        line.strip()
        for line in (XSD_DIR / "manifest.sha256").read_text(encoding="ascii").splitlines()
        if line.strip()
    ]
    assert manifest_lines, "manifest.sha256 must pin every schema file"
    pinned = set()
    for line in manifest_lines:
        digest, name = line.split("  ", 1)
        assert len(digest) == 64
        path = XSD_DIR / name
        assert path.is_file(), name
        import hashlib

        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, name
        pinned.add(name)
    assert "mercury_vu_applications_v2.0.xsd" in pinned
    assert "document_v2.0.xsd" in pinned


@pytest.mark.parametrize(
    "scenario", ["1.1.1", "1.1.2", "1.1.3", "1.2.1", "1.2.2", "1.2.3"]
)
def test_scenario_xml_is_valid_against_official_xsd(scenario: str) -> None:
    schema = _load_schema()
    doc = etree.parse(str(SCENARIOS / f"scenario-{scenario}.xml"))
    assert schema.validate(doc), str(schema.error_log)
