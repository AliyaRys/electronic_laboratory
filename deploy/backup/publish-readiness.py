#!/usr/bin/env python3
"""Publish atomic backup evidence after checksums and a restore drill pass."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path


def _instant_from_file(path: Path) -> datetime:
    value = path.read_text(encoding="utf-8").strip()
    return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/srv/vse-backup"))
    parser.add_argument("--restore-evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--system-identifier", required=True)
    parser.add_argument("--timeline", type=int, required=True)
    args = parser.parse_args()

    copies = sorted((args.root / "base" / "daily").glob("*"), reverse=True)
    if not copies:
        raise SystemExit("no verified daily base backup")
    latest = copies[0]
    subprocess.run(
        ["sha256sum", "--check", "MANIFEST.sha256"],
        cwd=latest,
        check=True,
        stdin=subprocess.DEVNULL,
    )
    restore = json.loads(args.restore_evidence.read_text(encoding="utf-8"))
    required = (
        "wal_continuous",
        "checksum_verified",
        "deletion_journal_continuity",
        "keyring_available",
        "all_durable_lsn_replayed",
    )
    if any(restore.get(field) is not True for field in required):
        raise SystemExit("restore evidence is incomplete")
    wal_files = [path for path in (args.root / "wal").iterdir() if path.is_file()]
    if not wal_files:
        raise SystemExit("continuous WAL directory is empty")
    last_wal = datetime.fromtimestamp(max(path.stat().st_mtime for path in wal_files), tz=UTC)
    payload = {
        "schema_version": 1,
        "ready": True,
        "system_identifier": args.system_identifier,
        "timeline": args.timeline,
        "base_backup_completed_at": _instant_from_file(latest / "COMPLETED_AT_UTC").isoformat(),
        "last_wal_received_at": last_wal.isoformat(),
        "restore_tested_at": restore["completed_at"],
        "wal_continuous": True,
        "checksum_verified": True,
        "deletion_journal_continuity": True,
        "keyring_available": True,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".readiness-", dir=args.output.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o440)
        os.replace(temporary, args.output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
