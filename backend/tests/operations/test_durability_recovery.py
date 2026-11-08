"""O02 backup, WAL durability and restore safety contracts."""

from __future__ import annotations

import json
import runpy
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.src.core.durability import (
    BackupReadinessError,
    PostgresDurabilityGuard,
    load_backup_readiness,
)

ROOT = Path(__file__).resolve().parents[3]


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_backup_services_pin_receiver_and_daily_basebackup() -> None:
    receiver = _read("deploy/backup/receiver.service")
    basebackup = _read("deploy/backup/basebackup.service")
    timer = _read("deploy/backup/basebackup.timer")
    tunnel = _read("deploy/backup/tunnel.conf")

    assert "pg_receivewal" in receiver
    assert "--synchronous" in receiver
    assert "application_name=vse_backup" in receiver
    assert "--slot=vse_backup" in receiver
    assert "User=vsebackup" in receiver and "NoNewPrivileges=true" in receiver
    assert "backup-base.sh" in basebackup
    assert "02:00:00 Europe/Moscow" in timer
    assert "RemoteForward 127.0.0.1:6543 postgres:5432" in tunnel
    assert "StrictHostKeyChecking yes" in tunnel
    assert "ExitOnForwardFailure yes" in tunnel


def test_postgres_compose_declares_local_default_and_named_sync_receiver() -> None:
    compose = _read("docker-compose.yml")
    assert "synchronous_commit=local" in compose
    assert "synchronous_standby_names=vse_backup" in compose
    assert "max_slot_wal_keep_size=20GB" in compose
    assert "DB port" not in compose  # no accidental documentation of a published port
    assert "${BACKUP_TUNNEL_IMAGE:-vse-backup-tunnel:local}" in compose


def test_release_builds_and_records_backup_tunnel_digest() -> None:
    workflow = _read(".gitverse/workflows/release.yml")
    schema = json.loads(_read("deploy/release-manifest.schema.json"))
    assert "vse-backup-tunnel" in workflow
    assert "backup_tunnel_digest" in workflow
    assert "backup_tunnel" in schema["properties"]["image_digests"]["required"]


def test_backup_scripts_are_fail_closed_and_restore_disables_writes() -> None:
    backup = _read("deploy/backup/backup-base.sh")
    restore = _read("deploy/backup/restore-gate.py")
    assert "pg_basebackup" in backup
    assert "sha256" in backup
    assert "7" in backup and "4" in backup
    assert "wal_continuous" in restore
    assert "deletion_journal_continuity" in restore
    assert "VETIS_WRITE_ENABLED=false" in restore
    assert "DELETE_DURABILITY_ENABLED=false" in restore
    assert "SUBMITTING" in restore and "reconcile" in restore.lower()


def test_fresh_verified_readiness_manifest_is_accepted(tmp_path: Path) -> None:
    now = datetime.now(UTC)
    path = tmp_path / "readiness.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "ready": True,
                "system_identifier": "7412345678901234567",
                "timeline": 1,
                "base_backup_completed_at": (now - timedelta(hours=1)).isoformat(),
                "last_wal_received_at": (now - timedelta(seconds=5)).isoformat(),
                "restore_tested_at": (now - timedelta(days=7)).isoformat(),
                "wal_continuous": True,
                "checksum_verified": True,
                "deletion_journal_continuity": True,
                "keyring_available": True,
            }
        ),
        encoding="utf-8",
    )
    evidence = load_backup_readiness(path, now=now)
    assert evidence.system_identifier == "7412345678901234567"
    assert evidence.timeline == 1


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ready", False),
        ("wal_continuous", False),
        ("checksum_verified", False),
        ("deletion_journal_continuity", False),
        ("keyring_available", False),
    ],
)
def test_readiness_manifest_rejects_missing_safety_evidence(
    tmp_path: Path, field: str, value: bool
) -> None:
    now = datetime.now(UTC)
    payload = {
        "schema_version": 1,
        "ready": True,
        "system_identifier": "7412345678901234567",
        "timeline": 1,
        "base_backup_completed_at": now.isoformat(),
        "last_wal_received_at": now.isoformat(),
        "restore_tested_at": now.isoformat(),
        "wal_continuous": True,
        "checksum_verified": True,
        "deletion_journal_continuity": True,
        "keyring_available": True,
    }
    payload[field] = value
    path = tmp_path / "readiness.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(BackupReadinessError):
        load_backup_readiness(path, now=now)


def test_readiness_manifest_rejects_stale_backup_and_restore_test(tmp_path: Path) -> None:
    now = datetime.now(UTC)
    payload = {
        "schema_version": 1,
        "ready": True,
        "system_identifier": "7412345678901234567",
        "timeline": 1,
        "base_backup_completed_at": (now - timedelta(hours=27)).isoformat(),
        "last_wal_received_at": now.isoformat(),
        "restore_tested_at": (now - timedelta(days=32)).isoformat(),
        "wal_continuous": True,
        "checksum_verified": True,
        "deletion_journal_continuity": True,
        "keyring_available": True,
    }
    path = tmp_path / "readiness.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(BackupReadinessError):
        load_backup_readiness(path, now=now)


def _valid_manifest(path: Path) -> None:
    now = datetime.now(UTC)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "ready": True,
                "system_identifier": "7412345678901234567",
                "timeline": 3,
                "base_backup_completed_at": now.isoformat(),
                "last_wal_received_at": now.isoformat(),
                "restore_tested_at": now.isoformat(),
                "wal_continuous": True,
                "checksum_verified": True,
                "deletion_journal_continuity": True,
                "keyring_available": True,
            }
        ),
        encoding="utf-8",
    )


class _Result:
    def __init__(self, value: object) -> None:
        self.value = value

    def one(self) -> object:
        return self.value

    def scalar_one(self) -> object:
        return self.value


class _GuardDatabase:
    def __init__(self, *, receiver_ready: bool) -> None:
        self.receiver_ready = receiver_ready
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def execute(self, statement: object, parameters: dict[str, object] | None = None) -> _Result:
        sql = str(statement)
        self.calls.append((sql, parameters or {}))
        if "pg_control_system" in sql:
            return _Result(("7412345678901234567", 3))
        return _Result(self.receiver_ready)


@pytest.mark.asyncio
async def test_guard_requires_named_receiver_slot_and_matching_cluster(tmp_path: Path) -> None:
    manifest = tmp_path / "readiness.json"
    _valid_manifest(manifest)
    db = _GuardDatabase(receiver_ready=True)
    settings = SimpleNamespace(
        delete_durability_enabled=True,
        backup_readiness_path=str(manifest),
        backup_replication_application_name="vse_backup",
        backup_replication_slot="vse_backup",
    )
    guard = PostgresDurabilityGuard(db, settings)  # type: ignore[arg-type]
    assert await guard.ready() is True
    receiver_sql, parameters = db.calls[-1]
    assert "application_name = :application_name" in receiver_sql
    assert "slot_name = :slot_name" in receiver_sql
    assert parameters == {"application_name": "vse_backup", "slot_name": "vse_backup"}


def test_restore_gate_refuses_missing_journal_and_emits_write_disabled_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    gate = ROOT / "deploy" / "backup" / "restore-gate.py"
    evidence = tmp_path / "evidence.json"
    output = tmp_path / "safe.env"
    payload = {
        "schema_version": 1,
        "wal_continuous": True,
        "checksum_verified": True,
        "deletion_journal_continuity": False,
        "keyring_available": True,
        "all_durable_lsn_replayed": True,
        "pending_external_policy": "reconcile-only",
    }
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", [str(gate), str(evidence), "--output", str(output)])
    with pytest.raises(SystemExit) as refused:
        runpy.run_path(str(gate), run_name="__main__")
    assert refused.value.code == 3
    payload["deletion_journal_continuity"] = True
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(SystemExit) as accepted:
        runpy.run_path(str(gate), run_name="__main__")
    assert accepted.value.code == 0
    safe = output.read_text(encoding="utf-8")
    assert "VETIS_WRITE_ENABLED=false" in safe
    assert "DELETE_DURABILITY_ENABLED=false" in safe
