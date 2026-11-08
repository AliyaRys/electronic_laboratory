"""O03 observability metrics and alert thresholds (DATA-05, OPS-01).

Named alert conditions wired in :func:`evaluate_alerts`:

- ``OPERATION_UNKNOWN`` — any UNKNOWN external operation (severity high);
- ``COMMAND_AGE_HIGH`` — a command record older than 15 minutes (high);
- ``BACKUP_STALE`` — the last verified backup older than 26 hours (high);
- ``WAL_LAG_HIGH`` — receiver WAL lag above 10 minutes (high);
- ``OUTBOX_BACKLOG`` — the oldest due outbox entry above 5 minutes (high);
- ``DISK_LOW`` — free disk below 20% (high).

The :class:`MetricsRegistry` collects the API latency/error families, DB lock
waits and the operational gauges (outbox/UNKNOWN/last sync/backup) named by the
plan; ``render_prometheus`` exposes them in text format for the monitoring
endpoint described in ``docs/operations/monitoring.md``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

__all__ = [
    "Alert",
    "ALERT_THRESHOLDS",
    "MetricsRegistry",
    "evaluate_alerts",
]

UNKNOWN_MAX = 0
COMMAND_AGE_HIGH_SECONDS = 15 * 60
BACKUP_MAX_AGE_HOURS = 26.0
WAL_LAG_MAX_SECONDS = 10 * 60
OUTBOX_MAX_AGE_SECONDS = 5 * 60
DISK_FREE_MIN_PERCENT = 20.0

ALERT_THRESHOLDS: dict[str, float] = {
    "unknown_operations_max": UNKNOWN_MAX,
    "oldest_command_age_seconds": COMMAND_AGE_HIGH_SECONDS,
    "backup_age_hours": BACKUP_MAX_AGE_HOURS,
    "wal_lag_seconds": WAL_LAG_MAX_SECONDS,
    "outbox_oldest_seconds": OUTBOX_MAX_AGE_SECONDS,
    "disk_free_percent_min": DISK_FREE_MIN_PERCENT,
}


@dataclass(frozen=True, slots=True)
class Alert:
    """One raised alert with a stable code and severity."""

    code: str
    severity: str
    message: str


def evaluate_alerts(snapshot: Mapping[str, Any]) -> list[Alert]:
    """Evaluate the named conditions against a metrics snapshot."""
    raised: list[Alert] = []
    unknown = snapshot.get("unknown_operations", 0)
    if unknown > UNKNOWN_MAX:
        raised.append(Alert("OPERATION_UNKNOWN", "high", f"Неразрешённых UNKNOWN операций: {unknown}."))
    age = snapshot.get("oldest_command_age_seconds", 0)
    if age > COMMAND_AGE_HIGH_SECONDS:
        raised.append(
            Alert("COMMAND_AGE_HIGH", "high", f"Команда не завершена {age} с (> {COMMAND_AGE_HIGH_SECONDS} с).")
        )
    backup = snapshot.get("backup_age_hours", 0.0)
    if backup > BACKUP_MAX_AGE_HOURS:
        raised.append(
            Alert("BACKUP_STALE", "high", f"Последняя проверенная копия {backup} ч назад (> {BACKUP_MAX_AGE_HOURS} ч).")
        )
    wal = snapshot.get("wal_lag_seconds", 0)
    if wal > WAL_LAG_MAX_SECONDS:
        raised.append(Alert("WAL_LAG_HIGH", "high", f"Отставание WAL {wal} с (> {WAL_LAG_MAX_SECONDS} с)."))
    outbox = snapshot.get("outbox_oldest_seconds", 0)
    if outbox > OUTBOX_MAX_AGE_SECONDS:
        raised.append(
            Alert("OUTBOX_BACKLOG", "high", f"Старейшая запись outbox {outbox} с (> {OUTBOX_MAX_AGE_SECONDS} с).")
        )
    disk = snapshot.get("disk_free_percent", 100.0)
    if disk < DISK_FREE_MIN_PERCENT:
        raised.append(Alert("DISK_LOW", "high", f"Свободно на диске {disk}% (< {DISK_FREE_MIN_PERCENT}%)."))
    return raised


def _p95(sorted_values: list[float]) -> float:
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, math.ceil(0.95 * len(sorted_values)) - 1)
    return sorted_values[index]


class MetricsRegistry:
    """In-process registry of the plan's metric families.

    Latency/error families are observed per request; operational gauges are set
    by the maintenance/collection loop. Values stay in the process — the
    shipping endpoint is documented in ``monitoring.md``.
    """

    def __init__(self) -> None:
        self._latencies: list[float] = []
        self._requests_total = 0
        self._errors_total = 0
        self._db_lock_waits: list[float] = []
        self._gauges: dict[str, float] = {}

    def observe_api(self, method: str, path: str, seconds: float, status: int) -> None:
        del method, path  # labelled series live in the exposition step
        self._requests_total += 1
        self._latencies.append(seconds)
        if status >= 500 or status == 0:
            self._errors_total += 1

    def observe_db_lock_wait(self, seconds: float) -> None:
        self._db_lock_waits.append(seconds)

    def set_gauge(self, name: str, value: float) -> None:
        self._gauges[name] = value

    def snapshot(self) -> dict[str, Any]:
        ordered = sorted(self._latencies)
        return {
            "api_requests_total": self._requests_total,
            "api_errors_total": self._errors_total,
            "p50_api_seconds": ordered[len(ordered) // 2] if ordered else 0.0,
            "p95_api_seconds": _p95(ordered),
            "db_lock_waits_total": len(self._db_lock_waits),
            "p95_db_lock_seconds": _p95(sorted(self._db_lock_waits)),
            **self._gauges,
        }

    def render_prometheus(self) -> str:
        """Text exposition of the named families (``vse_`` prefix)."""
        state = self.snapshot()
        lines = [
            f"vse_api_requests_total {state['api_requests_total']}",
            f"vse_api_errors_total {state['api_errors_total']}",
            f"vse_p50_api_seconds {state['p50_api_seconds']}",
            f"vse_p95_api_seconds {state['p95_api_seconds']}",
            f"vse_db_lock_waits_total {state['db_lock_waits_total']}",
            f"vse_p95_db_lock_seconds {state['p95_db_lock_seconds']}",
        ]
        for name, value in self._gauges.items():
            lines.append(f"vse_{name} {value}")
        lines.append(f"vse_collected_at {datetime.now(UTC).isoformat()}")
        return "\n".join(lines) + "\n"
