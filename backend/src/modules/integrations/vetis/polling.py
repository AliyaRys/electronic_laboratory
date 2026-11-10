"""Bounded Mercury polling schedule for receipt applications (W02)."""

from __future__ import annotations

from datetime import timedelta

POLL_DELAYS = (2, 5, 10, 30, 60)
MAX_PROCESSING = timedelta(minutes=15)

__all__ = ["MAX_PROCESSING", "poll_delay"]


def poll_delay(attempt: int) -> timedelta:
    """Deterministic base delay; deployment may add bounded jitter."""
    index = min(max(attempt, 0), len(POLL_DELAYS) - 1)
    return timedelta(seconds=POLL_DELAYS[index])
