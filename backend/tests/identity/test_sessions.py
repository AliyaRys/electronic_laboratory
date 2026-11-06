"""Session, CSRF and login security acceptance tests (Task I02)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.clock import Clock
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole, UserScope
from backend.src.modules.identity.passwords import hash_password
from backend.src.modules.identity.session import (
    SessionTransport,
    close_session_transport,
    get_session_transport,
)


class TestClock(Clock):
    __test__ = False

    def __init__(self) -> None:
        self.current = datetime(2026, 11, 6, 12, tzinfo=UTC)

    def now(self) -> datetime:
        return self.current

    def advance(self, delta: timedelta) -> None:
        self.current += delta


class MemoryRedis:
    """Small deterministic Redis double; production never falls back to it."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}
        self.expiry: dict[str, float] = {}
        self.now = 0.0
        self.fail = False

    def advance(self, delta: timedelta) -> None:
        self.now += delta.total_seconds()

    def _check(self) -> None:
        if self.fail:
            raise RedisConnectionError("down")

    def _purge(self, name: str) -> None:
        if self.expiry.get(name, self.now + 1) <= self.now:
            self.values.pop(name, None)
            self.sets.pop(name, None)
            self.expiry.pop(name, None)

    async def get(self, name: str):
        self._check()
        self._purge(name)
        return self.values.get(name)

    async def set(self, name: str, value: str, *, ex: int | None = None):
        self._check()
        self.values[name] = value
        if ex is not None:
            self.expiry[name] = self.now + ex
        return True

    async def delete(self, *names: str) -> int:
        self._check()
        for name in names:
            self.values.pop(name, None)
            self.sets.pop(name, None)
            self.expiry.pop(name, None)
        return len(names)

    async def sadd(self, name: str, *values: str) -> int:
        self._check()
        target = self.sets.setdefault(name, set())
        before = len(target)
        target.update(values)
        return len(target) - before

    async def smembers(self, name: str):
        self._check()
        self._purge(name)
        return set(self.sets.get(name, set()))

    async def expire(self, name: str, seconds: int) -> bool:
        self._check()
        self.expiry[name] = self.now + seconds
        return True

    async def eval(self, script: str, numkeys: int, *args: object):
        self._check()
        if "SREM" in script:
            key, member = str(args[0]), str(args[1])
            self.sets.setdefault(key, set()).discard(member)
            return 1
        failure_key, block_key = str(args[0]), str(args[1])
        window, limit, block = int(args[2]), int(args[3]), int(args[4])
        self._purge(failure_key)
        count = int(self.values.get(failure_key, "0")) + 1
        self.values[failure_key] = str(count)
        self.expiry.setdefault(failure_key, self.now + window)
        if count >= limit:
            self.values[block_key] = "1"
            self.expiry[block_key] = self.now + block
        return count

    async def aclose(self) -> None:
        return None


@pytest.fixture
def memory_transport() -> tuple[SessionTransport, MemoryRedis, TestClock]:
    redis = MemoryRedis()
    clock = TestClock()
    return SessionTransport(redis, clock=clock, prefix="test"), redis, clock


@pytest.fixture
async def identity_api(client: AsyncClient, db_session: AsyncSession, memory_transport):
    from backend.src.interfaces.main import app

    transport, redis, clock = memory_transport
    app.dependency_overrides[get_session_transport] = lambda: transport
    app.dependency_overrides[get_authorizer] = lambda: Authorizer(InMemoryDecisionEngine())
    territory = Territory(name="Татарстан")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="Организация")
    db_session.add(lab)
    await db_session.flush()
    product = uuid.uuid4()
    user = User(
        login="doctor",
        full_name="Ветеринарный врач",
        email="doctor@example.test",
        password_hash=hash_password("correct horse battery"),
        role=UserRole.VET,
        active=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(UserScope(user_id=user.id, laboratory_id=lab.id, product_scope_id=product))
    await db_session.commit()
    yield client, db_session, transport, redis, clock, user
    app.dependency_overrides.pop(get_session_transport, None)
    app.dependency_overrides.pop(get_authorizer, None)


async def _csrf(client: AsyncClient) -> str:
    response = await client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    return str(response.json()["csrf_token"])


async def _login(client: AsyncClient, password: str = "correct horse battery"):
    token = await _csrf(client)
    return await client.post(
        "/api/v1/auth/login",
        json={"login": "doctor", "password": password},
        headers={"Origin": "http://test", "X-CSRF-Token": token},
    )


async def test_login_csrf_cookie_and_origin(identity_api) -> None:
    client, *_ = identity_api
    token = await _csrf(client)
    missing = await client.post("/api/v1/auth/login", json={"login": "doctor", "password": "x"})
    assert missing.status_code == 403
    foreign = await client.post(
        "/api/v1/auth/login",
        json={"login": "doctor", "password": "x"},
        headers={"Origin": "https://evil.test", "X-CSRF-Token": token},
    )
    assert foreign.status_code == 403
    success = await _login(client)
    assert success.status_code == 200, success.text
    cookies = success.headers.get_list("set-cookie")
    session_cookie = next(item for item in cookies if item.startswith("vse_session="))
    assert "HttpOnly" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert success.headers["cache-control"] == "no-store"


async def test_login_limit(identity_api) -> None:
    client, _, _, redis, _, _ = identity_api
    for _ in range(5):
        response = await _login(client, "wrong password")
        assert response.status_code == 401
    sixth = await _login(client)
    assert sixth.status_code == 429
    redis.advance(timedelta(minutes=15, seconds=1))
    allowed = await _login(client)
    assert allowed.status_code == 200


async def test_redis_failure_closed(identity_api) -> None:
    client, _, _, redis, _, _ = identity_api
    redis.fail = True
    response = await _login(client)
    assert response.status_code == 503
    assert response.json()["code"] == "DEPENDENCY_UNAVAILABLE"


async def test_logout_and_password_revoke(identity_api) -> None:
    client, db, transport, _, _, user = identity_api
    first = await _login(client)
    assert first.status_code == 200
    first_id = client.cookies[SessionTransport.COOKIE_NAME]
    csrf = str(first.json()["csrf_token"])
    second = await transport.create(user.id)
    changed = await client.post(
        "/api/v1/me/change-password",
        json={
            "current_password": "correct horse battery",
            "new_password": "a completely new pass",
            "confirmation": "a completely new pass",
        },
        headers={"Origin": "http://test", "X-CSRF-Token": csrf},
    )
    assert changed.status_code == 204, changed.text
    assert await transport.read(first_id) is None
    assert await transport.read(second.session_id) is None
    updated = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
    assert updated.rev == 2
    assert (await _login(client, "correct horse battery")).status_code == 401
    new_login = await _login(client, "a completely new pass")
    assert new_login.status_code == 200
    logout_csrf = str(new_login.json()["csrf_token"])
    session_id = client.cookies[SessionTransport.COOKIE_NAME]
    logged_out = await client.post(
        "/api/v1/auth/logout",
        json={},
        headers={"Origin": "http://test", "X-CSRF-Token": logout_csrf},
    )
    assert logged_out.status_code == 204
    assert await transport.read(session_id) is None


async def test_absolute_and_idle_expiry(memory_transport) -> None:
    transport, redis, clock = memory_transport
    actor = uuid.uuid4()
    idle = await transport.create(actor)
    clock.advance(timedelta(minutes=30, seconds=1))
    redis.advance(timedelta(minutes=29))
    assert await transport.read(idle.session_id) is None
    absolute = await transport.create(actor)
    for _ in range(15):
        clock.advance(timedelta(minutes=30))
        redis.advance(timedelta(minutes=29))
        assert await transport.read(absolute.session_id) is not None
    clock.advance(timedelta(minutes=30, seconds=1))
    redis.advance(timedelta(minutes=29))
    assert await transport.read(absolute.session_id) is None


async def test_me_contexts_and_session_failures(identity_api) -> None:
    client, db, transport, _, _, user = identity_api
    assert (await client.get("/api/v1/health/live")).status_code == 200
    assert (await client.get("/api/v1/health/ready")).status_code == 200
    assert (await client.get("/api/v1/me")).status_code == 401
    logged_in = await _login(client)
    assert logged_in.status_code == 200
    assert (await client.get("/api/v1/me")).status_code == 200
    contexts = await client.get("/api/v1/contexts")
    assert contexts.status_code == 200
    assert len(contexts.json()) == 1
    session_id = client.cookies[SessionTransport.COOKIE_NAME]
    await transport.revoke(session_id, user.id)
    expired = await client.get("/api/v1/me")
    assert expired.status_code == 401
    assert expired.json()["code"] == "SESSION_EXPIRED"

    relogin = await _login(client)
    assert relogin.status_code == 200
    user.active = False
    await db.commit()
    blocked = await client.get("/api/v1/me")
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "ACCOUNT_BLOCKED"
    assert (await _login(client)).status_code == 403


async def test_change_password_validation(identity_api) -> None:
    client, *_ = identity_api
    logged_in = await _login(client)
    csrf = str(logged_in.json()["csrf_token"])
    response = await client.post(
        "/api/v1/me/change-password",
        json={"current_password": "bad", "new_password": "short", "confirmation": "different"},
        headers={"Origin": "http://test", "X-CSRF-Token": csrf},
    )
    assert response.status_code == 422
    assert {item["path"] for item in response.json()["errors"]} == {
        "current_password",
        "new_password",
        "confirmation",
    }


@pytest.mark.parametrize(
    "operation",
    ["create", "read", "revoke", "revoke_all", "record_login_failure", "clear_login_failures"],
)
async def test_every_redis_operation_fails_closed(memory_transport, operation: str) -> None:
    transport, redis, _ = memory_transport
    actor = uuid.uuid4()
    identity = await transport.create(actor)
    redis.fail = True
    with pytest.raises(Exception) as error:
        if operation == "create":
            await transport.create(actor)
        elif operation == "read":
            await transport.read(identity.session_id)
        elif operation == "revoke":
            await transport.revoke(identity.session_id, actor)
        elif operation == "revoke_all":
            await transport.revoke_all(actor)
        elif operation == "record_login_failure":
            await transport.record_login_failure("127.0.0.1", "doctor")
        else:
            await transport.clear_login_failures("127.0.0.1", "doctor")
    assert getattr(error.value, "status", None) == 503


async def test_transport_factory_and_close(monkeypatch) -> None:
    import backend.src.modules.identity.session as session_module

    monkeypatch.setattr(session_module, "_transport", None)
    transport = get_session_transport()
    assert get_session_transport() is transport
    await close_session_transport()
    assert session_module._transport is None
