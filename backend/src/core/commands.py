"""Command coordination: unit of work, revision guard, and idempotency journal.

SPEC-04: a command obtains a server ``now`` after locks, checks access/If-Match,
claims its idempotency record, performs every change and technical event in one
transaction, then commits. These helpers are the reusable machinery all later
domain commands build on; they never commit on their own.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError, idempotency_mismatch, revision_conflict, revision_required
from backend.src.modules.identity.models import CommandRecord, CommandStatus

__all__ = [
    "UnitOfWork",
    "CommandContext",
    "canonical_request_hash",
    "resolve_if_match",
    "format_etag",
    "ensure_revision",
    "IdempotencyRecorder",
]


class UnitOfWork:
    """Coordinates a single transaction; only the command coordinator commits."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @property
    def session(self) -> AsyncSession:
        return self._session

    async def flush(self) -> None:
        await self._session.flush()

    async def commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()


def canonical_request_hash(payload: dict[str, Any] | None, expected_revision: int | None) -> str:
    """Deterministic hash of the canonical request (body + If-Match), per SPEC-04.

    The hash ties an idempotency key to the exact request, so a different body or
    revision under the same key raises ``IDEMPOTENCY_MISMATCH``.
    """
    canonical = json.dumps(
        {"payload": payload, "expected_revision": expected_revision},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def format_etag(revision: int) -> str:
    """The ``ETag`` / ``If-Match`` wire form of an integer revision."""
    return f'"{revision}"'


def _unusable_if_match(value: str) -> ProblemError:
    """The stable 422 REVISION_REQUIRED problem for a present-but-unusable If-Match."""
    return revision_required(f'Значение If-Match непригодно ({value}): укажите конкретную ревизию, например "3".')


def resolve_if_match(if_match: str | None) -> int | None:
    """Parse an ``If-Match`` header value into an integer revision, or ``None``.

    ``None`` is returned only when the header is absent; the command then reports
    ``REVISION_REQUIRED`` through :func:`ensure_revision`. A present but unusable
    value raises that same Problem directly (422 ``REVISION_REQUIRED``, API-01)
    instead of an unhandled error:

    - a malformed value (``"abc"``) carries no integer revision;
    - a weak validator (``W/"3"``) is not a strong revision comparison;
    - the wildcard ``*`` is deliberately rejected — accepting it would bypass
      revision checking, so the client must send a concrete revision.
    """
    if if_match is None:
        return None
    value = if_match.strip()
    if value.startswith("W/"):
        raise _unusable_if_match(value)
    if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if value == "" or value == "*":
        raise _unusable_if_match(value)
    try:
        return int(value)
    except ValueError:
        raise _unusable_if_match(value) from None


def ensure_revision(expected: int | None, actual: int) -> None:
    """Enforce the If-Match revision contract for a mutation (SPEC-04)."""
    if expected is None:
        raise revision_required()
    if expected != actual:
        raise revision_conflict()


class IdempotencyRecorder:
    """Claims and resolves idempotency records inside the command's transaction."""

    async def claim(
        self,
        uow: UnitOfWork,
        *,
        actor_id: UUID,
        action: str,
        context_id: UUID,
        key: str,
        request_hash: str,
    ) -> CommandRecord:
        """Find or create the idempotency record for ``(actor, action, context, key)``.

        Returns the existing record on a same-hash replay; raises on a different
        hash; otherwise inserts an ``IN_PROGRESS`` record in the open transaction.
        """
        statement = select(CommandRecord).where(
            CommandRecord.actor_id == actor_id,
            CommandRecord.action == action,
            CommandRecord.context_id == context_id,
            CommandRecord.key == key,
        )
        existing = (await uow.session.execute(statement)).scalar_one_or_none()

        if existing is not None:
            if existing.request_hash != request_hash:
                raise idempotency_mismatch()
            return existing

        record = CommandRecord(
            actor_id=actor_id,
            action=action,
            context_id=context_id,
            key=key,
            request_hash=request_hash,
            status=CommandStatus.IN_PROGRESS,
        )
        uow.session.add(record)
        await uow.flush()
        return record

    async def complete(self, uow: UnitOfWork, record: CommandRecord, result_id: UUID) -> None:
        """Mark a claimed record successful, storing the produced result id."""
        record.status = CommandStatus.SUCCESS
        record.result_id = result_id
        await uow.flush()

    async def fail(self, uow: UnitOfWork, record: CommandRecord, problem_code: str) -> None:
        """Mark a claimed record failed with its problem code."""
        record.status = CommandStatus.FAILED
        record.problem_code = problem_code
        await uow.flush()
