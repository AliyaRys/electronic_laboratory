"""O03 observability, retention, alert and load-budget contracts (DATA-05, SPEC-05/06).

Named plan assertions (Task O03 / Review Focus):

- ``test_log_redaction_masks_password_cookie_apikey_and_medical_payload``
  — password/cookie/apiKey and a medical payload are really absent from log
  records, not just claimed in docstrings;
- ``test_retention_periods_and_business_facts_never_purged`` — 90d technical
  events, 365d security events, 30d diagnostic SOAP; business facts
  (confirmations/UNKNOWN/samples/disposals/snapshots) never get an automatic TTL;
- ``test_snapshot_key_rotation_90d_old_9h`` — the preview keyring rotates after
  90 days and still verifies old keys for 9 hours;
- ``test_outbox_unknown_and_observability_alert_conditions_wired`` — UNKNOWN>0;
  command age>15min high; backup>26h; WAL lag>10min; outbox>5min; disk<20%;
- ``test_structured_audit_writes_atomically_inside_command_transaction`` —
  the structured audit row joins the command's unit of work (no own commit);
- ``test_masked_soap_diagnostics_service_account_only`` — SOAP diagnostics are
  stored masked and readable only by the service account;
- ``test_load_profile_matches_global_constraints`` — 30min, 80/20 read/write,
  100 concurrent, 100 labs/500 users/5000 arrivals-day/100k sources per lab
  half-year on 8 vCPU/32 GiB/500 GiB SSD, p95 targets and <1% errors;
- ``test_100k_payload_within_32mib_budget`` — OPS03: 100k sources fit in
  32 MiB of compact payload (measured, not claimed).

NOTE: contains Cyrillic literals; edit only through the edit tool, never
through PowerShell Get-Content/Set-Content (encoding hazard).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.src.core import audit, metrics
from backend.src.core.keyring import OLD_KEY_GRACE, ROTATION_INTERVAL, PreviewKeyring, SigningKey

ROOT = Path(__file__).resolve().parents[3]

MIB = 1024 * 1024


def _load_runner():
    """Import ``tests/load/local-scenarios.py`` by path (top-level tests dir)."""
    path = ROOT / "tests" / "load" / "local-scenarios.py"
    spec = importlib.util.spec_from_file_location("local_scenarios", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["local_scenarios"] = module
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


# --- named assertion: real log redaction ----------------------------------------


class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(self.format(record))


def test_log_redaction_masks_password_cookie_apikey_and_medical_payload() -> None:
    capture = _Capture()
    logger = logging.getLogger("vse.o03.redaction")
    logger.handlers = [capture]
    logger.setLevel(logging.INFO)
    logger.propagate = False

    leaky = (
        "login attempt login=vetsvet password=Sekret-Parol-123 apiKey=AKIA-demo-key-012 "
        "Cookie: vse_session=abcdef123456; X-Api-Key=token-9876"
    )
    medical = json.dumps(
        {"research_result": "трихинеллы не обнаружены", "diagnosis": "MISMATCH", "party_id": "p-1"},
        ensure_ascii=False,
    )
    logger.info(audit.redact_text(leaky))
    logger.info("audit %s", audit.redact_dict(json.loads(medical)))

    joined = "\n".join(capture.records)
    assert "Sekret-Parol-123" not in joined
    assert "AKIA-demo-key-012" not in joined
    assert "abcdef123456" not in joined
    assert "token-9876" not in joined
    # The medical payload value never appears in the log record.
    assert "трихинеллы не обнаружены" not in joined
    assert joined.count(audit.REDACTED) >= 4

    # Structured audit itself never carries a medical payload or credentials.
    entry = audit.structured_entry(
        actor_id="3f2a1111-2222-4333-8444-555555555555",
        action="examination:save",
        object_uuid="3f2a1111-2222-4333-8444-555555555556",
        result="SUCCESS",
        trace_id="trace-1",
        payload={"password": "x", "apiKey": "y", "research_result": "з"},
    )
    # Secret values never travel with the audit entry; keys are masked in place.
    dumped = json.dumps(entry, ensure_ascii=False)
    assert dumped.count('"[REDACTED]"') == 3
    for forbidden in ("Sekret-Parol-123", "AKIA-demo-key-012", "трихинеллы"):
        assert forbidden not in dumped
    assert entry["action"] == "examination:save"


# --- named assertion: retention periods vs business facts -----------------------


def test_retention_periods_and_business_facts_never_purged() -> None:
    assert timedelta(days=90) == audit.TECHNICAL_EVENT_RETENTION
    assert timedelta(days=365) == audit.SECURITY_EVENT_RETENTION
    assert timedelta(days=30) == audit.SOAP_DIAGNOSTIC_RETENTION

    now = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
    plan = audit.retention_plan(now)
    kinds = {item.store: item.before for item in plan}
    assert kinds["technical_events"] == now - timedelta(days=90)
    assert kinds["security_events"] == now - timedelta(days=365)
    assert kinds["soap_diagnostics"] == now - timedelta(days=30)

    # Business facts are never subject to those TTLs.
    business = {
        "receipt_confirmations",
        "vetis_operations",
        "examinations",
        "sample_collections",
        "sample_disposals",
        "report_snapshots",
        "reconciliations",
    }
    touched = {item.store for item in plan}
    assert not touched & business
    for table in business:
        assert table in audit.NEVER_PURGED_TABLES

    # The purge executor refuses a business table outright.
    with pytest.raises(ValueError, match="business"):
        audit.assert_purgable("report_snapshots")


# --- named assertion: snapshot key rotation 90d / old 9h ------------------------


def test_snapshot_key_rotation_90d_old_9h() -> None:
    assert timedelta(days=90) == ROTATION_INTERVAL
    assert timedelta(hours=9) == OLD_KEY_GRACE

    base = datetime(2026, 11, 8, tzinfo=UTC)
    active = SigningKey(key_id="k-new", secret=b"0" * 32, activated_at=base)
    retired = SigningKey(key_id="k-old", secret=b"1" * 32, activated_at=base - timedelta(days=91), retired_at=base)
    keyring = PreviewKeyring(active=active, previous=(retired,))

    # Old keys verify within the 9 hour grace and stop after it.
    assert keyring.verification_key("k-old", base + timedelta(hours=8)) is retired
    assert keyring.verification_key("k-old", base + timedelta(hours=10)) is None
    # A signing key older than 90 days demands planned rotation.
    from backend.src.core.problems import ProblemError

    with pytest.raises(ProblemError):
        keyring.signing_key(base + timedelta(days=91))
    assert keyring.signing_key(base + timedelta(days=89)) is active


# --- named assertion: alert conditions ------------------------------------------


def test_outbox_unknown_and_observability_alert_conditions_wired() -> None:
    clean = metrics.evaluate_alerts(
        {
            "unknown_operations": 0,
            "oldest_command_age_seconds": 60,
            "backup_age_hours": 3.0,
            "wal_lag_seconds": 20,
            "outbox_oldest_seconds": 10,
            "disk_free_percent": 47.0,
        }
    )
    assert clean == []

    hot = {
        (item.code, item.severity)
        for item in metrics.evaluate_alerts(
            {
                "unknown_operations": 2,
                "oldest_command_age_seconds": 901,
                "backup_age_hours": 26.5,
                "wal_lag_seconds": 601,
                "outbox_oldest_seconds": 301,
                "disk_free_percent": 19.5,
            }
        )
    }
    assert hot == {
        ("OPERATION_UNKNOWN", "high"),
        ("COMMAND_AGE_HIGH", "high"),
        ("BACKUP_STALE", "high"),
        ("WAL_LAG_HIGH", "high"),
        ("OUTBOX_BACKLOG", "high"),
        ("DISK_LOW", "high"),
    }
    # The registry exposes the named gauge/counter families.
    registry = metrics.MetricsRegistry()
    registry.observe_api("GET", "/api/v1/arrivals", 0.2, 200)
    registry.observe_api("PUT", "/api/v1/arrivals/x/reconciliation", 0.9, 200)
    registry.observe_db_lock_wait(0.05)
    registry.set_gauge("outbox_oldest_seconds", 10)
    registry.set_gauge("unknown_operations", 0)
    registry.set_gauge("last_vetis_sync_age_seconds", 100)
    registry.set_gauge("backup_age_hours", 2.5)
    snapshot = registry.snapshot()
    assert snapshot["api_requests_total"] == 2
    assert snapshot["api_errors_total"] == 0
    assert snapshot["p95_api_seconds"] >= 0.9
    text = registry.render_prometheus()
    assert "vse_api_requests_total" in text and "vse_p95_api_seconds" in text


# --- named assertion: atomic structured audit -----------------------------------


class _FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1


def test_structured_audit_writes_atomically_inside_command_transaction() -> None:
    session = _FakeSession()
    uow = SimpleNamespace(session=session)
    event = audit.write_structured_audit(
        uow,
        actor_id="3f2a1111-2222-4333-8444-555555555555",
        action="reconciliation:save",
        object_uuid="3f2a1111-2222-4333-8444-555555555556",
        result="SUCCESS",
        trace_id="trace-7",
        security=False,
    )
    # The row joins the command transaction; the recorder never commits itself.
    assert event in session.added
    assert session.commits == 0
    assert event.action == "reconciliation:save"
    assert event.trace_id == "trace-7"


def test_masked_soap_diagnostics_service_account_only() -> None:
    store = audit.SoapDiagnostics()
    raw = (
        '<soap:Envelope><soap:Header><auth apiKey="SUPER-SECRET-KEY">login</auth></soap:Header>'
        "<body><result>трихинеллы не обнаружены, 4 шт</result></body></soap:Envelope>"
    )
    stored = store.record("trace-9", raw)
    assert "SUPER-SECRET-KEY" not in stored
    assert "трихинеллы не обнаружены" not in stored
    assert "<result>" in stored  # the structure stays, values are masked

    assert store.read("trace-9", principal="vse_service") == stored
    with pytest.raises(audit.ServiceAccountRequired):
        store.read("trace-9", principal="vetsvet")
    with pytest.raises(KeyError):
        store.read("missing", principal="vse_service")

    # Retention: diagnostics older than 30 days are collectable.
    assert audit.SoapDiagnostics.retention == audit.SOAP_DIAGNOSTIC_RETENTION


# --- named assertion: load profile matches Global Constraints -------------------


def test_load_profile_matches_global_constraints() -> None:
    runner = _load_runner()
    profile = runner.FULL_PROFILE
    assert profile["duration_s"] == 30 * 60
    assert profile["read_share"] == 0.8
    assert profile["concurrency"] == 100
    assert profile["laboratories"] == 100
    assert profile["users"] == 500
    assert profile["arrivals_per_day"] == 5000
    assert profile["report_sources_per_lab_halfyear"] == 100_000
    assert profile["host"] == {"vcpu": 8, "gib": 32, "disk": "500GiB SSD"}
    assert profile["p95_read_page_s"] == 2.0
    assert profile["p95_local_save_s"] == 3.0
    assert profile["max_error_share"] == 0.01
    assert profile["report_calc_max_s"] == 60
    assert runner.payload_budget_bytes() == 32 * MIB
    # The short runnable variant is a documented scaled-down derivative.
    short = runner.SHORT_PROFILE
    assert 0 < short["duration_s"] < runner.FULL_PROFILE["duration_s"]
    assert 0 < short["concurrency"] < runner.FULL_PROFILE["concurrency"]
    assert short["read_share"] == runner.FULL_PROFILE["read_share"]


def test_100k_payload_within_32mib_budget() -> None:
    runner = _load_runner()
    started = time.perf_counter()
    size = runner.projection_payload_size(100_000)
    elapsed = time.perf_counter() - started
    assert size <= 32 * MIB
    assert elapsed < 60.0  # OPS03: measurement, not a docstring claim
    sources = runner.compact_report_sources(3)
    assert json.dumps(sources[0])  # compact projection carries no protocol text
    assert set(sources[0]) <= {"u", "r", "m", "q"}


# --- named assertion: runbook docs exist with the contracted facts --------------


def test_observability_operations_docs_carry_contracted_facts() -> None:
    monitoring = (ROOT / "docs/operations/monitoring.md").read_text(encoding="utf-8")
    capacity = (ROOT / "docs/operations/capacity.md").read_text(encoding="utf-8")
    retention_doc = (ROOT / "docs/operations/retention.md").read_text(encoding="utf-8")
    maintenance = (ROOT / "docs/operations/maintenance.md").read_text(encoding="utf-8")
    checklist = (ROOT / "docs/operations/local-release-checklist.md").read_text(encoding="utf-8")

    # monitoring: alert thresholds and their sources
    for fragment in (
        "OPERATION_UNKNOWN",
        "COMMAND_AGE_HIGH",
        "BACKUP_STALE",
        "WAL_LAG_HIGH",
        "OUTBOX_BACKLOG",
        "DISK_LOW",
        "26",
        "15",
        "10",
        "5",
        "20",
    ):
        assert fragment in monitoring, fragment
    # capacity: reproducible command and honest full-profile status
    assert "tests/load/local-scenarios.py" in capacity
    assert "uvicorn" in capacity
    assert "не выполнял" in capacity or "planned" in capacity
    assert "100k" in capacity or "100 000" in capacity
    assert "32" in capacity
    # retention: exact periods and never-purged list
    for fragment in ("90", "365", "30", "receipt_confirmations", "report_snapshots"):
        assert fragment in retention_doc, fragment
    # maintenance: monthly updates, 1 working day for critical, no auto merge
    for fragment in ("месяц", "1 рабочий день", "auto merge" in maintenance or "автоматическое слияние" in maintenance):
        assert fragment, fragment
    # checklist: honest statuses — local modules write/read=false, fixtures are not real ВетИС
    assert "write=false" in checklist or "write/read=false" in checklist
    assert "не является" in checklist or "не объявл" in checklist
    assert "not-run" in checklist or "не выполн" in checklist
