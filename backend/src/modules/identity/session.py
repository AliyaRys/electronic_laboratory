"""Redis-backed opaque browser sessions and login throttling (API-02)."""

from __future__ import annotations

import json
import secrets
import uuid
from collections.abc import Set as AbstractSet
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from backend.src.core.clock import Clock
from backend.src.core.problems import ProblemError, dependency_unavailable
from backend.src.infrastructure.config.settings import get_settings

SESSION_ABSOLUTE = timedelta(hours=8)
SESSION_IDLE = timedelta(minutes=30)
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_BLOCK = timedelta(minutes=15)
LOGIN_FAILURE_LIMIT = 5


class RedisClient(Protocol):
    async def get(self, name: str) -> bytes | str | None: ...
    async def set(self, name: str, value: str, *, ex: int | None = None) -> object: ...
    async def delete(self, *names: str) -> int: ...
    async def sadd(self, name: str, *values: str) -> int: ...
    async def smembers(self, name: str) -> AbstractSet[bytes | str]: ...
    async def expire(self, name: str, seconds: int) -> bool: ...
    async def eval(self, script: str, numkeys: int, *keys_and_args: object) -> object: ...
    async def aclose(self) -> None: ...


@dataclass(frozen=True, slots=True)
class SessionIdentity:
    session_id: str
    actor_id: uuid.UUID
    csrf_token: str
    created_at: datetime
    last_seen_at: datetime

    def to_json(self) -> str:
        data = asdict(self)
        data["actor_id"] = str(self.actor_id)
        data["created_at"] = self.created_at.isoformat()
        data["last_seen_at"] = self.last_seen_at.isoformat()
        return json.dumps(data, separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_json(cls, raw: bytes | str) -> SessionIdentity:
        data = json.loads(raw)
        return cls(
            session_id=str(data["session_id"]),
            actor_id=uuid.UUID(str(data["actor_id"])),
            csrf_token=str(data["csrf_token"]),
            created_at=datetime.fromisoformat(str(data["created_at"])).astimezone(UTC),
            last_seen_at=datetime.fromisoformat(str(data["last_seen_at"])).astimezone(UTC),
        )


_FAILURE_SCRIPT = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if n >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
end
return n
"""


class SessionTransport:
    """Opaque session IDs in a Secure HttpOnly cookie; all state stays in Redis."""

    COOKIE_NAME = "vse_session"
    CSRF_COOKIE_NAME = "vse_csrf"

    def __init__(self, redis: RedisClient, *, clock: Clock | None = None, prefix: str = "vse") -> None:
        self.redis = redis
        self.clock = clock or Clock()
        self.prefix = prefix

    def _session_key(self, session_id: str) -> str:
        return f"{self.prefix}:session:{session_id}"

    def _user_key(self, actor_id: uuid.UUID) -> str:
        return f"{self.prefix}:user-sessions:{actor_id}"

    def _failure_key(self, ip: str, login: str) -> str:
        return f"{self.prefix}:login-fail:{ip}:{login}"

    def _block_key(self, ip: str, login: str) -> str:
        return f"{self.prefix}:login-block:{ip}:{login}"

    async def create(self, actor_id: uuid.UUID) -> SessionIdentity:
        now = self.clock.now()
        identity = SessionIdentity(
            session_id=secrets.token_urlsafe(32),
            actor_id=actor_id,
            csrf_token=secrets.token_urlsafe(32),
            created_at=now,
            last_seen_at=now,
        )
        try:
            await self.redis.set(
                self._session_key(identity.session_id),
                identity.to_json(),
                ex=int(SESSION_IDLE.total_seconds()),
            )
            user_key = self._user_key(actor_id)
            await self.redis.sadd(user_key, identity.session_id)
            await self.redis.expire(user_key, int(SESSION_ABSOLUTE.total_seconds()))
        except RedisError, OSError:
            raise dependency_unavailable("Хранилище сеансов недоступно.") from None
        return identity

    async def read(self, session_id: str) -> SessionIdentity | None:
        try:
            raw = await self.redis.get(self._session_key(session_id))
            if raw is None:
                return None
            identity = SessionIdentity.from_json(raw)
            now = self.clock.now()
            absolute_left = identity.created_at + SESSION_ABSOLUTE - now
            if absolute_left <= timedelta(0) or now - identity.last_seen_at > SESSION_IDLE:
                await self.revoke(session_id, identity.actor_id)
                return None
            refreshed = SessionIdentity(
                session_id=identity.session_id,
                actor_id=identity.actor_id,
                csrf_token=identity.csrf_token,
                created_at=identity.created_at,
                last_seen_at=now,
            )
            ttl = max(1, int(min(SESSION_IDLE, absolute_left).total_seconds()))
            await self.redis.set(self._session_key(session_id), refreshed.to_json(), ex=ttl)
            return refreshed
        except RedisError, OSError, ValueError, KeyError, json.JSONDecodeError:
            raise dependency_unavailable("Хранилище сеансов недоступно.") from None

    async def revoke(self, session_id: str, actor_id: uuid.UUID | None = None) -> None:
        try:
            await self.redis.delete(self._session_key(session_id))
            # Stale set members are harmless and expire within the absolute limit.
            if actor_id is not None:
                await self.redis.eval(
                    "return redis.call('SREM', KEYS[1], ARGV[1])", 1, self._user_key(actor_id), session_id
                )
        except RedisError, OSError:
            raise dependency_unavailable("Хранилище сеансов недоступно.") from None

    async def revoke_all(self, actor_id: uuid.UUID) -> None:
        try:
            raw_ids = await self.redis.smembers(self._user_key(actor_id))
            ids = [item.decode() if isinstance(item, bytes) else item for item in raw_ids]
            keys = [self._session_key(item) for item in ids]
            if keys:
                await self.redis.delete(*keys)
            await self.redis.delete(self._user_key(actor_id))
        except RedisError, OSError:
            raise dependency_unavailable("Хранилище сеансов недоступно.") from None

    async def is_login_blocked(self, ip: str, login: str) -> bool:
        try:
            return await self.redis.get(self._block_key(ip, login)) is not None
        except RedisError, OSError:
            raise dependency_unavailable("Хранилище ограничения входа недоступно.") from None

    async def record_login_failure(self, ip: str, login: str) -> int:
        try:
            result = await self.redis.eval(
                _FAILURE_SCRIPT,
                2,
                self._failure_key(ip, login),
                self._block_key(ip, login),
                int(LOGIN_WINDOW.total_seconds()),
                LOGIN_FAILURE_LIMIT,
                int(LOGIN_BLOCK.total_seconds()),
            )
            return int(cast(int, result))
        except RedisError, OSError:
            raise dependency_unavailable("Хранилище ограничения входа недоступно.") from None

    async def clear_login_failures(self, ip: str, login: str) -> None:
        try:
            await self.redis.delete(self._failure_key(ip, login), self._block_key(ip, login))
        except RedisError, OSError:
            raise dependency_unavailable("Хранилище ограничения входа недоступно.") from None


_transport: SessionTransport | None = None


def get_session_transport() -> SessionTransport:
    global _transport
    if _transport is None:
        client = Redis.from_url(get_settings().redis_url, decode_responses=False)
        _transport = SessionTransport(cast(RedisClient, client))
    return _transport


async def close_session_transport() -> None:
    global _transport
    if _transport is not None:
        try:
            await _transport.redis.aclose()
        finally:
            _transport = None


def session_required() -> ProblemError:
    return ProblemError(
        status=401, code="SESSION_REQUIRED", title="Session required", detail="Требуется вход в систему."
    )


def session_expired() -> ProblemError:
    return ProblemError(status=401, code="SESSION_EXPIRED", title="Session expired", detail="Сеанс истёк.")
