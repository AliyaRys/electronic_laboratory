#!/usr/bin/env python3
"""Fail-closed gate before a restored installation may serve users.

This does not perform restore. It validates the operator evidence produced by
the isolated restore drill and emits only a safe, write-disabled environment.
Pending external SUBMITTING operations must be reconciled, never resubmitted.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SAFE_ENV = """VETIS_READ_ENABLED=false
VETIS_WRITE_ENABLED=false
DELETE_DURABILITY_ENABLED=false
RESTORE_RECONCILE_ONLY=true
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        data = json.loads(args.evidence.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        print(f"restore gate refused: unreadable evidence: {error}", file=sys.stderr)
        return 3
    required_true = (
        "wal_continuous",
        "checksum_verified",
        "deletion_journal_continuity",
        "keyring_available",
        "all_durable_lsn_replayed",
    )
    missing = [name for name in required_true if data.get(name) is not True]
    if data.get("schema_version") != 1 or missing:
        print(f"restore gate refused: missing safety evidence: {', '.join(missing)}", file=sys.stderr)
        return 3
    if data.get("pending_external_policy") != "reconcile-only":
        print("restore gate refused: SUBMITTING operations must be reconcile-only", file=sys.stderr)
        return 3
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(SAFE_ENV, encoding="utf-8")
    print("restore evidence accepted; installation remains write-disabled")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
