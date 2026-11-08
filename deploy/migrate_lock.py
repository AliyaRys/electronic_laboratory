#!/usr/bin/env python
"""Release-lock wrapper for the one-shot migration job (ADR-003/014).

The one-shot ``migrate`` service must hold a PostgreSQL advisory lock for the
whole duration of ``alembic upgrade head``. Two concurrent migrations or two
concurrent releases therefore serialize: the second one waits until the first
releases the lock, and a hung holder blocks further switches.

Usage (see ``docker-compose.yml`` service ``migrate``)::

    python deploy/migrate_lock.py python -m alembic -c backend/alembic.ini upgrade head

The connection is taken from ``DATABASE_URL`` when set, otherwise from the
Compose variables ``DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME``.

Optional ``LOCK_WAIT_TIMEOUT_SECONDS`` (default: unlimited): give up with a
non-zero exit and an explanatory message instead of waiting forever.
"""

from __future__ import annotations

import asyncio
import os
import sys

# Stable id for this installation's release lock ("VSE" release lock).
# THIS IS THE SINGLE SOURCE OF TRUTH for the id: release.yml (manifest job)
# and docs/operations/release.md must record the SAME number, verified by
# backend/tests/operations/test_configuration.py so they cannot drift.
RELEASE_LOCK_ID = 0x00005653_00004553  # == 94914482292051


def _dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        # asyncpg speaks plain postgres:// URLs.
        for prefix in ("postgresql+asyncpg://", "postgresql+psycopg://", "postgresql+psycopg2://"):
            if url.startswith(prefix):
                return "postgresql://" + url[len(prefix) :]
        return url
    return "postgresql://{user}:{password}@{host}:{port}/{name}".format(
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=os.environ.get("DB_PORT", "5432"),
        name=os.environ["DB_NAME"],
    )


async def _acquire(conn) -> bool:
    """Try to take the release lock; honor LOCK_WAIT_TIMEOUT_SECONDS."""
    timeout = float(os.environ.get("LOCK_WAIT_TIMEOUT_SECONDS", "0") or 0)
    deadline = asyncio.get_event_loop().time() + timeout if timeout else None
    while True:
        if (await conn.fetchval("SELECT pg_try_advisory_lock($1)", RELEASE_LOCK_ID)) is True:
            return True
        if deadline is not None and asyncio.get_event_loop().time() >= deadline:
            return False
        await asyncio.sleep(0.5)


async def _run(argv: list[str]) -> int:
    import asyncpg

    conn = await asyncpg.connect(_dsn())
    try:
        if not await _acquire(conn):
            message = (
                "release lock is held by another migration/release; "
                "a failed or in-flight migration blocks the version switch"
            )
            print(message, file=sys.stderr)
            return 3
        # Run the wrapped command while the lock is held.
        proc = await asyncio.create_subprocess_exec(*argv)
        return await proc.wait()
    finally:
        await conn.execute("SELECT pg_advisory_unlock($1)", RELEASE_LOCK_ID)
        await conn.close()


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print("usage: migrate_lock.py COMMAND [ARGS...]", file=sys.stderr)
        return 2
    return asyncio.run(_run(argv))


if __name__ == "__main__":
    raise SystemExit(main())
