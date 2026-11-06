"""Unit and integration tests for the platform's core machinery (Task I01).

These cover the reusable building blocks the four acceptance tests rely on:
server clock, the Problem factory functions, revision/idempotency helpers, the
database engine lifecycle, the live probe, and the closed bootstrap command.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.src.core.clock import Clock, moscow_date, utcnow
from backend.src.core.commands import (
    IdempotencyRecorder,
    UnitOfWork,
    canonical_request_hash,
    ensure_revision,
    format_etag,
    resolve_if_match,
)
from backend.src.core.database import build_engine, dispose_engine, get_engine, get_session_factory
from backend.src.core.problems import (
    Problem,
    ProblemError,
    ProblemItem,
    dependency_unavailable,
    idempotency_key_required,
    idempotency_mismatch,
    not_found,
    revision_conflict,
    revision_required,
    validation_error,
)
from backend.src.modules.identity.bootstrap import (
    BootstrapError,
    create_admin,
    ensure_registry_empty,
    hash_password,
    run_bootstrap,
    user_count,
    validate_password,
    verify_password,
)
from backend.src.modules.identity.models import CommandStatus, UserRole

# --- clock -------------------------------------------------------------------


def test_utcnow_is_aware_utc() -> None:
    now = utcnow()
    assert now.tzinfo is not None
    assert now.utcoffset() == timedelta(0)


def test_clock_now_is_aware() -> None:
    now = Clock().now()
    assert now.tzinfo is not None
    assert now.utcoffset() == timedelta(0)


def test_moscow_date_crosses_midnight() -> None:
    # 2026-06-01 21:30 UTC is already 2026-06-02 00:30 in Europe/Moscow.
    instant = datetime(2026, 6, 1, 21, 30, tzinfo=UTC)
    assert moscow_date(instant) == date(2026, 6, 2)


# --- Problem factory functions ------------------------------------------------


def test_problem_factories_have_stable_codes() -> None:
    assert not_found().status == 404
    assert not_found().code == "NOT_FOUND"
    assert revision_required().status == 422
    assert revision_required().code == "REVISION_REQUIRED"
    assert revision_conflict().status == 409
    assert revision_conflict().code == "REVISION_CONFLICT"
    assert idempotency_key_required().code == "IDEMPOTENCY_KEY_REQUIRED"
    assert idempotency_mismatch().code == "IDEMPOTENCY_MISMATCH"
    assert dependency_unavailable("db down").status == 503
    assert dependency_unavailable("db down").code == "DEPENDENCY_UNAVAILABLE"


def test_validation_error_carries_field_errors() -> None:
    err = validation_error([ProblemItem(path="login", message="required")])
    assert err.code == "VALIDATION_ERROR"
    assert err.status == 422
    assert len(err.errors) == 1
    assert err.errors[0].path == "login"


def test_problem_as_document() -> None:
    problem: Problem = not_found().as_problem(instance="/api/v1/x")
    payload = problem.model_dump(mode="json")
    assert payload["code"] == "NOT_FOUND"
    assert payload["trace_id"]
    assert payload["type"] == "about:blank"


# --- revision / idempotency helpers ------------------------------------------


def test_etag_format_and_parse() -> None:
    assert format_etag(3) == '"3"'
    assert resolve_if_match('"3"') == 3
    assert resolve_if_match("3") == 3
    assert resolve_if_match(None) is None


def test_resolve_if_match_rejects_unusable_values() -> None:
    # Malformed / weak / wildcard / empty values raise the same stable Problem
    # (never an unhandled 500), and `*` must not bypass revision checking.
    for unusable in ("abc", '"abc"', 'W/"3"', "W/3", "*", '"*"', ""):
        with pytest.raises(ProblemError) as err:
            resolve_if_match(unusable)
        assert err.value.status == 422
        assert err.value.code == "REVISION_REQUIRED"


def test_canonical_request_hash_is_deterministic() -> None:
    h1 = canonical_request_hash({"a": 1}, 2)
    h2 = canonical_request_hash({"a": 1}, 2)
    assert h1 == h2
    assert h1 != canonical_request_hash({"a": 2}, 2)
    assert h1 != canonical_request_hash({"a": 1}, 3)


def test_ensure_revision_contract() -> None:
    ensure_revision(1, 1)  # no raise on match
    with pytest.raises(ProblemError) as missing:
        ensure_revision(None, 1)
    assert missing.value.code == "REVISION_REQUIRED"
    with pytest.raises(ProblemError) as conflict:
        ensure_revision(2, 1)
    assert conflict.value.code == "REVISION_CONFLICT"


async def test_idempotency_replay_and_mismatch(db_session: AsyncSession) -> None:
    uow = UnitOfWork(db_session)
    recorder = IdempotencyRecorder()
    actor = uuid.uuid4()
    context = uuid.uuid4()

    record = await recorder.claim(uow, actor_id=actor, action="a", context_id=context, key="k", request_hash="h1")
    assert record.status == CommandStatus.IN_PROGRESS

    # Same key + same hash is a replay of the same record.
    replay = await recorder.claim(uow, actor_id=actor, action="a", context_id=context, key="k", request_hash="h1")
    assert replay.id == record.id

    # Same key + different hash conflicts.
    with pytest.raises(ProblemError) as mismatch:
        await recorder.claim(uow, actor_id=actor, action="a", context_id=context, key="k", request_hash="h2")
    assert mismatch.value.code == "IDEMPOTENCY_MISMATCH"

    result_id = uuid.uuid4()
    await recorder.complete(uow, record, result_id)
    assert record.status == CommandStatus.SUCCESS
    assert record.result_id == result_id

    fresh = await recorder.claim(uow, actor_id=actor, action="b", context_id=context, key="k2", request_hash="h3")
    await recorder.fail(uow, fresh, "STATE_CONFLICT")
    assert fresh.status == CommandStatus.FAILED
    assert fresh.problem_code == "STATE_CONFLICT"


# --- database engine lifecycle ------------------------------------------------


def test_build_engine_returns_async_engine() -> None:
    engine = build_engine()
    assert isinstance(engine, AsyncEngine)


async def test_engine_factory_and_dispose() -> None:
    engine = get_engine()
    assert get_engine() is engine
    factory = get_session_factory()
    assert factory is not None
    await dispose_engine()


# --- live probe ---------------------------------------------------------------


async def test_live_probe(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/health/live")
    assert resp.status_code == 200
    assert resp.json()["status"] == "alive"


# --- bootstrap command --------------------------------------------------------


def test_validate_password_length() -> None:
    with pytest.raises(ValueError):
        validate_password("short")
    with pytest.raises(ValueError):
        validate_password("x" * 129)
    validate_password("x" * 12)  # exactly 12 is valid


def test_hash_and_verify_password() -> None:
    digest = hash_password("correct horse battery")
    assert digest.startswith("$argon2")
    assert verify_password("correct horse battery", digest)
    assert not verify_password("wrong password", digest)


async def test_user_count_and_create_admin(db_session: AsyncSession) -> None:
    assert await user_count(db_session) == 0
    user = await create_admin(
        db_session, login="admin", full_name="Админ", email="admin@example.com", password="longenoughpass"
    )
    assert user.role == UserRole.ADMIN
    assert user.active is True
    assert await user_count(db_session) == 1
    await db_session.commit()


async def test_ensure_registry_empty_refuses_nonempty(db_session: AsyncSession) -> None:
    await create_admin(db_session, login="a", full_name="A", email="a@e.com", password="longenoughpass")
    await db_session.commit()
    with pytest.raises(BootstrapError):
        await ensure_registry_empty(db_session)


async def test_run_bootstrap_creates_and_refuses_twice(db_session: AsyncSession) -> None:
    user = await run_bootstrap(
        db_session,
        login="badmin",
        full_name="B Admin",
        email="b@example.com",
        password="longenoughpass",
        confirmation="longenoughpass",
    )
    assert user.role == UserRole.ADMIN

    with pytest.raises(BootstrapError):
        await run_bootstrap(
            db_session,
            login="badmin2",
            full_name="B2",
            email="b2@example.com",
            password="longenoughpass",
            confirmation="longenoughpass",
        )


async def test_run_bootstrap_rejects_password_mismatch(db_session: AsyncSession) -> None:
    with pytest.raises(BootstrapError):
        await run_bootstrap(
            db_session,
            login="cadmin",
            full_name="C",
            email="c@example.com",
            password="longenoughpass",
            confirmation="differentpass",
        )
    assert await user_count(db_session) == 0
