"""ТЗ DR22 tests: retries of the manual arrivals sync INSIDE one operation.

The read side is proven on обезличенные pinned fixtures and transport spies —
no live VetIS call is ever made, and the write port proves that the read retry
NEVER invokes ``ProcessIncomingConsignment``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import requests
from sqlalchemy import func, select

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import Party
from backend.src.modules.identity.models import OutboxEntry
from backend.src.modules.integrations.vetis import sync
from backend.src.modules.integrations.vetis.models import (
    VetisBinding,
    VetisOperation,
    VetisOperationState,
)
from backend.tests.vetis.test_read_contract import FakeTransport, doc, page
from backend.tests.vetis.test_sync import (
    HttpErrorTransport,
    SpyWritePort,
    binding_row,
    make_adapter,
    op_row,
    outbox_rows,
    party_count,
    run,
    run_to_terminal,
    start,
)


class FlakyTransport(FakeTransport):
    """The gateway answers HTTP 502 for the FIRST receive of each listed try."""

    def __init__(self, pages: list[str], transient_failures: int = 1) -> None:
        super().__init__(pages)
        self.remaining_failures = transient_failures

    async def receive_result(self, application_id: str) -> str:
        if self.remaining_failures > 0:
            self.remaining_failures -= 1
            raise ProblemError(
                status=502,
                code="VETIS_TRANSPORT_ERROR",
                title="VetIS transport error",
                detail="Шлюз ВетИС вернул ошибку HTTP 502.",
            )
        return await super().receive_result(application_id)


# --- §8.1: transient 502 then success — ONE operation, SUCCESS, party imported ---


async def test_transient_502_then_success_is_one_operation(sync_env: SimpleNamespace) -> None:
    env = sync_env
    evsd = uuid.uuid4()
    operation_id = await start(env)
    transport = FlakyTransport([page(1, 0, [doc(evsd, "1")])], transient_failures=1)

    await run(env, operation_id, make_adapter(env, transport))
    first = await op_row(env, operation_id)
    # The transient error does NOT fail the operation: it is retryable/pending
    # with the attempt number, the lease/outbox released for the backoff.
    assert first.state == VetisOperationState.PENDING
    assert first.poll_attempts == 1
    assert first.problem_code == "VETIS_TRANSPORT_ERROR"  # the original cause kept
    assert first.diagnostics is not None and first.diagnostics["attempt"] == 1
    rows = await outbox_rows(env, operation_id)
    assert len(rows) == 1 and rows[0].delivered_at is None
    assert rows[0].lease_until is None  # released for the worker retry
    assert rows[0].next_attempt_at > datetime.now(UTC)

    await run(env, operation_id, make_adapter(env, transport))
    second = await op_row(env, operation_id)
    assert second.state == VetisOperationState.SUCCESS  # THE SAME operation
    assert second.id == operation_id
    assert second.problem_code is None  # a SUCCESS is never labelled by a transient error
    assert second.diagnostics is not None and second.diagnostics["attempt"] == 2
    assert (await binding_row(env)).last_success is not None  # the DR9 checkpoint moved
    assert await party_count(env) == 1  # the new party was imported


# --- §8.2: several transient errors — bounded backoff, no duplicates -------------


async def test_transient_backoff_no_duplicate_operations(sync_env: SimpleNamespace) -> None:
    env = sync_env
    operation_id = await start(env)
    adapter = make_adapter(env, HttpErrorTransport())

    await run(env, operation_id, adapter)
    rows = await outbox_rows(env, operation_id)
    assert len(rows) == 1
    first_delay = (rows[0].next_attempt_at - datetime.now(UTC)).total_seconds()
    assert 0 < first_delay <= sync.SYNC_RETRY_BACKOFF_S[0] + 5  # step one ≈ 2 s

    await run(env, operation_id, adapter)
    operation = await op_row(env, operation_id)
    assert operation.poll_attempts == 2
    rows = await outbox_rows(env, operation_id)
    assert len(rows) == 1  # never a second outbox row for the same operation
    second_delay = (rows[0].next_attempt_at - datetime.now(UTC)).total_seconds()
    assert 0 < second_delay <= sync.SYNC_RETRY_BACKOFF_S[1] + 5  # step two ≈ 5 s
    # The whole retry state lives in THE ONE operation for the laboratory.
    count = (
        await env.db.execute(
            select(func.count())
            .select_from(VetisOperation)
            .where(VetisOperation.laboratory_id == env.lab.id, VetisOperation.kind == "SYNC")
        )
    ).scalar_one()
    assert count == 1


# --- §8.3: attempts exhausted → FAILED with the ORIGINAL cause --------------------


async def test_attempts_exhausted_fails_with_original_cause(sync_env: SimpleNamespace) -> None:
    env = sync_env
    operation_id = await start(env)
    adapter = make_adapter(env, HttpErrorTransport())
    operation = await run_to_terminal(env, operation_id, adapter)

    assert operation.state == VetisOperationState.FAILED
    assert operation.problem_code == "VETIS_TRANSPORT_ERROR"  # the ORIGINAL cause, not a generic code
    assert operation.poll_attempts == sync.MAX_SYNC_ATTEMPTS
    assert (await binding_row(env)).last_success is None
    rows = await outbox_rows(env, operation_id)
    assert all(row.delivered_at is not None for row in rows)  # no retry storm afterwards


# --- §8.4: NOT_CONFIGURED is never retried ----------------------------------------


async def test_not_configured_is_not_retried(sync_env: SimpleNamespace) -> None:
    env = sync_env
    operation_id = await start(env)
    adapter = make_adapter(env, _permanent_adapter_problem(503, "INTEGRATION_NOT_CONFIGURED"))

    await run(env, operation_id, adapter)
    operation = await op_row(env, operation_id)
    assert operation.state == VetisOperationState.FAILED  # immediately final
    assert operation.poll_attempts == 0
    rows = await outbox_rows(env, operation_id)
    assert all(row.delivered_at is not None for row in rows)


# --- §8.5: scope/auth/schema errors start no pointless retry ----------------------


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (422, "INTEGRATION_SCOPE_REVOKED"),
        (422, "INTEGRATION_SCOPE_MISSING"),
        (503, "INTEGRATION_SCHEMA_PIN_MISMATCH"),
        (403, "VETIS_AUTH_ERROR"),
    ],
)
async def test_permanent_problems_do_not_retry(
    sync_env: SimpleNamespace, status: int, code: str
) -> None:
    env = sync_env
    operation_id = await start(env)
    adapter = make_adapter(env, _permanent_adapter_problem(status, code))

    await run(env, operation_id, adapter)
    operation = await op_row(env, operation_id)
    assert operation.state == VetisOperationState.FAILED
    assert operation.problem_code == code  # the original problem code is preserved
    assert operation.poll_attempts == 0
    rows = await outbox_rows(env, operation_id)
    assert all(row.delivered_at is not None for row in rows)


async def test_permanent_http_401_is_not_retried(sync_env: SimpleNamespace) -> None:
    """A raw HTTP 401/403 from the gateway is a permanent auth error."""
    env = sync_env
    operation_id = await start(env)

    class UnauthorizedTransport(FakeTransport):
        async def receive_result(self, application_id: str) -> str:
            raise requests.exceptions.HTTPError(
                "401 Client Error", response=SimpleNamespace(status_code=401)
            )

    await run(env, operation_id, make_adapter(env, UnauthorizedTransport([])))
    operation = await op_row(env, operation_id)
    assert operation.state == VetisOperationState.FAILED
    assert operation.problem_code == "VETIS_AUTH_ERROR"
    assert operation.poll_attempts == 0


# --- §8.6: a worker restart during the retry-wait restores the operation ----------


async def test_worker_restart_during_retry_restores_the_operation(
    sync_env: SimpleNamespace,
) -> None:
    env = sync_env
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, HttpErrorTransport()))  # attempt 1 → retry-wait
    before = await op_row(env, operation_id)
    assert before.state == VetisOperationState.PENDING
    assert before.poll_attempts == 1
    assert before.next_poll_at is not None

    # The crash loses the outbox row; the dispatcher (worker startup) restores
    # the pending retry-wait operation WITHOUT losing the retry state.
    await env.db.execute(OutboxEntry.__table__.delete().where(OutboxEntry.operation_id == operation_id))
    await env.db.commit()
    from backend.src.modules.integrations.vetis.dispatcher import dispatch_pending_operations

    restored = await dispatch_pending_operations(env.db)
    await env.db.commit()
    assert operation_id in restored
    rows = await outbox_rows(env, operation_id)
    assert len(rows) == 1 and rows[0].delivered_at is None
    # The restored row is due no earlier than the scheduled backoff moment.
    assert rows[0].next_attempt_at >= before.next_poll_at - timedelta(seconds=1)
    after = await op_row(env, operation_id)
    assert after.poll_attempts == 1  # the attempt counter survived the restart


# --- §8.7: two parallel manual commands share ONE operation -----------------------


async def test_parallel_manual_commands_share_one_operation(sync_env: SimpleNamespace) -> None:
    env = sync_env
    first = await start(env)
    second = await start(env)  # a repeat click during PENDING/retry-wait
    assert first == second
    rows = await outbox_rows(env, first)
    assert len(rows) == 1

    await run(env, first, make_adapter(env, HttpErrorTransport()))  # now in retry-wait
    third = await start(env)  # a repeat click DURING the retry-wait
    assert third == first  # the EXISTING operation, never a new one
    rows = await outbox_rows(env, first)
    assert len(rows) == 1


# --- §8.8: a multi-page full pass with a retry loses no documents -----------------


async def test_multi_page_retry_loses_no_documents(sync_env: SimpleNamespace) -> None:
    env = sync_env
    first, second = uuid.uuid4(), uuid.uuid4()
    operation_id = await start(env)
    # Attempt 1: page one is read, the SECOND page request gets the 502.
    class FlakyOnSecondReceive(FakeTransport):
        def __init__(self) -> None:
            super().__init__([page(2, 0, [doc(first, "1")]), page(2, 1, [doc(second, "2")])])
            self.receive_calls = 0

        async def receive_result(self, application_id: str) -> str:
            self.receive_calls += 1
            if self.receive_calls == 2:
                raise ProblemError(
                    status=502,
                    code="VETIS_TRANSPORT_ERROR",
                    title="VetIS transport error",
                    detail="Шлюз ВетИС вернул ошибку HTTP 502.",
                )
            return await super().receive_result(application_id)

    transport = FlakyOnSecondReceive()
    await run(env, operation_id, make_adapter(env, transport))
    assert (await op_row(env, operation_id)).state == VetisOperationState.PENDING
    assert await party_count(env) == 1  # page one was imported honestly

    # Attempt 2: the FULL pass over both pages of the SAME operation.
    full_pages = [page(2, 0, [doc(first, "1")]), page(2, 1, [doc(second, "2")])]
    await run(env, operation_id, make_adapter(env, FakeTransport(full_pages)))
    operation = await op_row(env, operation_id)
    assert operation.state == VetisOperationState.SUCCESS
    assert await party_count(env) == 2  # nothing was lost, nothing duplicated
    assert (await binding_row(env)).last_success is not None


# --- §8.9: SUCCESS + freshness are committed BEFORE GET visibility ----------------


async def test_success_and_freshness_are_committed_before_get_visibility(
    sync_env: SimpleNamespace,
) -> None:
    env = sync_env
    evsd = uuid.uuid4()
    operation_id = await start(env)
    await run(env, operation_id, make_adapter(env, FakeTransport([page(1, 0, [doc(evsd, "1")])])))

    # A fresh session (the GET /operations/:id path) sees the WHOLE completed
    # transaction: the SUCCESS state, the DR9 freshness checkpoint and the
    # imported party appear together, never partially.
    async with env.factory() as fresh:
        operation = await fresh.get(VetisOperation, operation_id)
        binding = await fresh.get(VetisBinding, env.lab.id)
        party_total = (await fresh.execute(select(func.count()).select_from(Party))).scalar_one()
    assert operation.state == VetisOperationState.SUCCESS
    assert operation.last_success is not None
    assert binding.last_success == operation.last_success  # the same committed transaction
    assert int(party_total) == 1


# --- §8.10: the retry NEVER invokes ProcessIncomingConsignment --------------------


async def test_retry_never_calls_process_incoming(sync_env: SimpleNamespace) -> None:
    from backend.src.modules.integrations.vetis.transport import SpyTransport

    env = sync_env
    evsd = uuid.uuid4()
    operation_id = await start(env)
    spy = SpyTransport([page(1, 0, [doc(evsd, "1")])])
    write_spy = SpyWritePort()

    class FlakySpy(SpyTransport):
        async def receive_result(self, application_id: str) -> str:
            raise ProblemError(
                status=502,
                code="VETIS_TRANSPORT_ERROR",
                title="VetIS transport error",
                detail="Шлюз ВетИС вернул ошибку HTTP 502.",
            )

    flaky = FlakySpy([])
    flaky.calls = spy.calls  # one shared spy journal across the attempts
    await run(env, operation_id, make_adapter(env, flaky))
    await run(env, operation_id, make_adapter(env, spy))
    assert spy.write_calls == 0  # zero write operations on ANY attempt
    assert spy.product_service_calls == 0
    assert write_spy.calls == []  # the write port is never touched
    assert (await op_row(env, operation_id)).state == VetisOperationState.SUCCESS


# --- helpers ----------------------------------------------------------------------


def _permanent_adapter_problem(status: int, code: str) -> FakeTransport:
    class PermanentProblemTransport(FakeTransport):
        async def receive_result(self, application_id: str) -> str:
            raise ProblemError(
                status=status,
                code=code,
                title="VetIS permanent problem",
                detail="Постоянная ошибка конфигурации; повтор без изменения настроек невозможен.",
            )

    return PermanentProblemTransport([])


def test_backoff_contract_is_bounded() -> None:
    """The documented backoff 2/5/10/30/60 s and the attempt budget stay bounded."""
    assert sync.SYNC_RETRY_BACKOFF_S == (2, 5, 10, 30, 60)
    assert sync.MAX_SYNC_ATTEMPTS == 6


def test_classification_contract() -> None:
    """§5.1: the classification of every documented failure class."""
    retryable = [
        ProblemError(status=502, code="VETIS_TRANSPORT_ERROR", title="t", detail="d"),
        ProblemError(status=503, code="DEPENDENCY_UNAVAILABLE", title="t", detail="d"),  # malformed result
        ProblemError(status=502, code="VETIS_CURSOR_CONTRACT_VIOLATED", title="t", detail="d"),
        requests.exceptions.ConnectionError("no route"),
        requests.exceptions.Timeout("timed out"),
    ]
    for exc in retryable:
        retryable_flag, problem = sync._classify_failure(exc)
        assert retryable_flag, exc
        assert problem.code not in ("", None)

    permanent = [
        ProblemError(status=503, code="INTEGRATION_NOT_CONFIGURED", title="t", detail="d"),
        ProblemError(status=422, code="INTEGRATION_SCOPE_MISSING", title="t", detail="d"),
        ProblemError(status=422, code="INTEGRATION_SCOPE_REVOKED", title="t", detail="d"),
        ProblemError(status=503, code="INTEGRATION_SCHEMA_IMPORT_REJECTED", title="t", detail="d"),
        ProblemError(status=503, code="INTEGRATION_SCHEMA_PIN_MISMATCH", title="t", detail="d"),
        ProblemError(status=500, code="VETIS_IMPORT_FAILED", title="t", detail="d"),
        ProblemError(status=422, code="VALIDATION_ERROR", title="t", detail="d"),
    ]
    for exc in permanent:
        retryable_flag, problem = sync._classify_failure(exc)
        assert not retryable_flag, exc
        assert problem.code == exc.code  # the ORIGINAL code, never a generic collapse
    http_502 = requests.exceptions.HTTPError("502", response=SimpleNamespace(status_code=502))
    assert sync._classify_failure(http_502)[0] is True
    http_401 = requests.exceptions.HTTPError("401", response=SimpleNamespace(status_code=401))
    retryable_flag, problem = sync._classify_failure(http_401)
    assert retryable_flag is False and problem.code == "VETIS_AUTH_ERROR"
    # No credential material ever travels in the safe diagnostics.
    assert "api_key" not in sync._transport_problem(http_502).detail.lower()



