"""Server clock (SPEC-05): a single UTC instant, day boundaries in Europe/Moscow."""

from __future__ import annotations

from datetime import UTC, date, datetime

from zoneinfo import ZoneInfo

MOSCOW = ZoneInfo("Europe/Moscow")

__all__ = ["Clock", "utcnow", "moscow_date", "MOSCOW"]


class Clock:
    """Injectable server clock.

    ``now()`` returns a single timezone-aware UTC instant; SPEC-04 requires every
    command to obtain its ``now`` once, *after* lock acquisition, from this clock.
    """

    def now(self) -> datetime:
        return datetime.now(UTC)


def utcnow() -> datetime:
    """A timezone-aware UTC instant (``timestamptz`` semantics)."""
    return datetime.now(UTC)


def moscow_date(instant: datetime) -> date:
    """The Europe/Moscow calendar day for a UTC instant (SPEC-05).

    The day a record was *created* is defined by the Moscow wall-clock time of the
    single server instant of the command, not by the client's local date.
    """
    return instant.astimezone(MOSCOW).date()
