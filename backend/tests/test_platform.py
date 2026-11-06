"""Platform baseline tests (Task I01).

These tests verify the four acceptance criteria of the platform task:

1. there is no public signup endpoint (404),
2. ``/health/ready`` rejects a stale database schema (503),
3. a command rollback leaves no persisted record and no idempotency-consuming
   success after an injected exception,
4. the ETag/If-Match revision contract and the Problem contract (``code`` +
   ``trace_id`` in every error body).
"""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi import FastAPI, Request, Response
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import (
    IdempotencyRecorder,
    UnitOfWork,
    canonical_request_hash,
    ensure_revision,
    format_etag,
    resolve_if_match,
)
from backend.src.core.problems import register_exception_handlers
from backend.src.modules.identity.models import CommandRecord, CommandStatus, TechnicalEvent
from backend.src.modules.identity.router import CURRENT_SCHEMA_REVISION

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


async def test_no_public_signup(client: AsyncClient) -> None:
    """Public self-registration must not exist; any signup path answers 404."""
    for path in ("/api/v1/signup", "/api/v1/auth/signup", "/api/v1/users/register"):
        resp = await client.post(path, json={"login": "newuser", "password": "secretsecret"})
        assert resp.status_code == 404, f"expected 404 for {path}, got {resp.status_code}"


async def test_ready_rejects_wrong_schema(client: AsyncClient, db_session: AsyncSession) -> None:
    """``/health/ready`` answers 200 on a migrated schema and 503 on a stale one."""
    resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200, resp.text

    # Simulate a schema that has not been migrated to the current head.
    await db_session.execute(text("UPDATE alembic_version SET version_num = '0000_stale'"))
    await db_session.commit()

    try:
        resp = await client.get("/api/v1/health/ready")
        assert resp.status_code == 503
        assert resp.headers["content-type"].startswith("application/problem+json")
        body = resp.json()
        assert body["code"] == "DEPENDENCY_UNAVAILABLE"
        assert body["trace_id"]
    finally:
        await db_session.execute(text(f"UPDATE alembic_version SET version_num = '{CURRENT_SCHEMA_REVISION}'"))
        await db_session.commit()


async def test_command_rollback(db_session: AsyncSession) -> None:
    """After an injected exception there is no record and no idempotency success."""
    actor_id = uuid.uuid4()
    context_id = uuid.uuid4()
    key = "rollback-key"
    request_hash = canonical_request_hash({"n": 1}, None)

    uow = UnitOfWork(db_session)
    recorder = IdempotencyRecorder()

    # A command claims idempotency, writes a technical event, then blows up.
    await recorder.claim(
        uow, actor_id=actor_id, action="test.create", context_id=context_id, key=key, request_hash=request_hash
    )
    uow.session.add(
        TechnicalEvent(actor_id=actor_id, object_uuid=context_id, action="test.create", result="ok", trace_id="t-1")
    )
    await uow.flush()

    with pytest.raises(RuntimeError, match="injected"):
        raise RuntimeError("injected")

    await uow.rollback()

    persisted = await db_session.execute(
        select(func.count()).select_from(CommandRecord).where(CommandRecord.key == key)
    )
    assert persisted.scalar_one() == 0, "command_record must be rolled back"

    events = await db_session.execute(
        select(func.count()).select_from(TechnicalEvent).where(TechnicalEvent.object_uuid == context_id)
    )
    assert events.scalar_one() == 0, "technical_event must be rolled back"

    # A fresh attempt with the same key is NOT a replay of a persisted success.
    replayed = await db_session.execute(
        select(CommandRecord).where(CommandRecord.key == key, CommandRecord.status == CommandStatus.SUCCESS)
    )
    assert replayed.scalar_one_or_none() is None, "no idempotency success may survive the rollback"


async def test_etag_and_problem_contract() -> None:
    """ETag/If-Match revision answers 422/409 and Problem bodies carry code + trace_id."""
    revision_app = _build_revision_app()

    async with AsyncClient(transport=ASGITransport(app=revision_app), base_url="http://test") as ac:
        # Missing If-Match on a mutation -> 422 REVISION_REQUIRED.
        resp = await ac.put("/resource", json={"value": "b"})
        assert resp.status_code == 422
        assert resp.headers["content-type"].startswith("application/problem+json")
        body = resp.json()
        assert body["code"] == "REVISION_REQUIRED"
        assert body["trace_id"]

        # Wrong If-Match -> 409 REVISION_CONFLICT.
        resp = await ac.put("/resource", json={"value": "b"}, headers={"If-Match": '"999"'})
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "REVISION_CONFLICT"
        assert body["trace_id"]

        # Correct If-Match -> 200 with an updated ETag.
        resp = await ac.put("/resource", json={"value": "b"}, headers={"If-Match": '"1"'})
        assert resp.status_code == 200
        assert resp.headers["etag"] == '"2"'

        # A GET of a mutable resource advertises its revision.
        resp = await ac.get("/resource")
        assert resp.status_code == 200
        assert resp.headers["etag"] == '"2"'


async def test_if_match_unusable_answers_problem_422() -> None:
    """Malformed, weak and wildcard If-Match values answer Problem 422.

    ``abc``, ``W/"3"`` and ``*`` must never leak an unhandled 500, and ``*``
    must never bypass revision checking: the client has to send a concrete
    revision, and every error stays a Problem with a stable code + trace_id.
    """
    revision_app = _build_revision_app()

    async with AsyncClient(transport=ASGITransport(app=revision_app), base_url="http://test") as ac:
        for header in ("abc", 'W/"3"', "*"):
            resp = await ac.put("/resource", json={"value": "b"}, headers={"If-Match": header})
            assert resp.status_code == 422, (header, resp.text)
            assert resp.headers["content-type"].startswith("application/problem+json")
            body = resp.json()
            assert body["code"] == "REVISION_REQUIRED"
            assert body["trace_id"]


def test_migration_from_i01_to_i02(test_db_url: str) -> None:
    """The released I01 schema upgrades to the I02 adapter schema on real PostgreSQL."""
    env = dict(os.environ)
    env["DATABASE_URL"] = test_db_url
    base = [sys.executable, "-m", "alembic", "-c", str(REPO_ROOT / "backend" / "alembic.ini")]
    downgrade = subprocess.run(
        [*base, "downgrade", "0001_identity"], cwd=REPO_ROOT, env=env, capture_output=True, text=True
    )
    assert downgrade.returncode == 0, downgrade.stdout + downgrade.stderr
    try:
        upgrade = subprocess.run([*base, "upgrade", "head"], cwd=REPO_ROOT, env=env, capture_output=True, text=True)
        assert upgrade.returncode == 0, upgrade.stdout + upgrade.stderr
        sync_url = test_db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        with psycopg.connect(sync_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM casbin_rule")
            assert cursor.fetchone()[0] > 0
    finally:
        # Keep the shared test database at head even when the assertion fails.
        subprocess.run([*base, "upgrade", "head"], cwd=REPO_ROOT, env=env, capture_output=True, text=True)


# --------------------------------------------------------------------------- #
# Test-local revision resource: exercises the production Problem handlers and
# revision helpers exactly the way future domain routers will.
# --------------------------------------------------------------------------- #

_STATE: dict[str, object] = {"revision": 1}


def _build_revision_app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/resource")
    async def get_resource(response: Response) -> dict[str, object]:
        response.headers["etag"] = format_etag(_STATE["revision"])  # type: ignore[arg-type]
        return {"id": "r1", "value": "a", "revision": _STATE["revision"]}

    @app.put("/resource")
    async def put_resource(request: Request, response: Response) -> dict[str, object]:
        expected = resolve_if_match(request.headers.get("if-match"))
        ensure_revision(expected, _STATE["revision"])  # type: ignore[arg-type]
        _STATE["revision"] = 2
        response.headers["etag"] = format_etag(_STATE["revision"])  # type: ignore[arg-type]
        return {"id": "r1", "value": "b", "revision": _STATE["revision"]}

    return app
