"""Shared HMAC keyring for session-bound report previews (ADR-021)."""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache

from backend.src.core.problems import dependency_unavailable
from backend.src.infrastructure.config.settings import Settings, get_settings

ROTATION_INTERVAL = timedelta(days=90)
OLD_KEY_GRACE = timedelta(hours=9)

__all__ = ["SigningKey", "PreviewKeyring", "get_preview_keyring", "ROTATION_INTERVAL", "OLD_KEY_GRACE"]


@dataclass(frozen=True, slots=True)
class SigningKey:
    key_id: str
    secret: bytes
    activated_at: datetime
    retired_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.key_id.strip():
            raise ValueError("key_id подписи отчётов не может быть пустым.")
        if len(self.secret) < 32:
            raise ValueError("Ключ подписи отчётов должен содержать не менее 256 бит.")
        if self.activated_at.tzinfo is None:
            raise ValueError("activated_at ключа должен содержать часовой пояс.")
        if self.retired_at is not None:
            if self.retired_at.tzinfo is None:
                raise ValueError("retired_at ключа должен содержать часовой пояс.")
            if self.retired_at < self.activated_at:
                raise ValueError("Ключ не может быть выведен до его активации.")


class PreviewKeyring:
    """One active signing key plus verification-only retired keys."""

    def __init__(self, active: SigningKey, previous: tuple[SigningKey, ...] = ()) -> None:
        if active.retired_at is not None:
            raise ValueError("Активный ключ не может быть отмечен как выведенный.")
        if any(item.retired_at is None for item in previous):
            raise ValueError("Предыдущие ключи должны содержать retired_at.")
        keys = {active.key_id: active, **{item.key_id: item for item in previous}}
        if len(keys) != 1 + len(previous):
            raise ValueError("Идентификаторы ключей должны быть уникальны.")
        self.active = active
        self.keys = keys

    def signing_key(self, now: datetime) -> SigningKey:
        if now < self.active.activated_at or now - self.active.activated_at > ROTATION_INTERVAL:
            raise dependency_unavailable("Ключ подписи preview требует плановой ротации.")
        return self.active

    def verification_key(self, key_id: str, now: datetime) -> SigningKey | None:
        key = self.keys.get(key_id)
        if key is None or now < key.activated_at:
            return None
        if key.retired_at is None:
            return key if now - key.activated_at <= ROTATION_INTERVAL + OLD_KEY_GRACE else None
        return key if now <= key.retired_at + OLD_KEY_GRACE else None

    @classmethod
    def from_settings(cls, settings: Settings) -> PreviewKeyring:
        raw = settings.report_preview_keys
        if raw:
            try:
                config = json.loads(raw)
                active_id = str(config["active"])
                parsed: list[SigningKey] = []
                for item in config["keys"]:
                    padding = "=" * (-len(str(item["secret"])) % 4)
                    activated_at = datetime.fromisoformat(str(item["activated_at"]))
                    retired_at = datetime.fromisoformat(str(item["retired_at"])) if item.get("retired_at") else None
                    if activated_at.tzinfo is None or (retired_at is not None and retired_at.tzinfo is None):
                        raise ValueError("Времена ключей должны содержать часовой пояс.")
                    parsed.append(
                        SigningKey(
                            key_id=str(item["id"]),
                            secret=base64.urlsafe_b64decode(str(item["secret"]) + padding),
                            activated_at=activated_at.astimezone(UTC),
                            retired_at=retired_at.astimezone(UTC) if retired_at is not None else None,
                        )
                    )
                active = next(item for item in parsed if item.key_id == active_id)
            except (ValueError, KeyError, TypeError, StopIteration, json.JSONDecodeError) as exc:
                raise RuntimeError("REPORT_PREVIEW_KEYS имеет непригодный формат.") from exc
            return cls(active, tuple(item for item in parsed if item.key_id != active_id))
        if settings.is_production:
            raise RuntimeError("REPORT_PREVIEW_KEYS обязателен в production.")
        secret = hashlib.sha256(f"report-preview:{settings.secret_key}".encode()).digest()
        key_id = hashlib.sha256(secret).hexdigest()[:16]
        return cls(SigningKey(key_id=key_id, secret=secret, activated_at=datetime.now(UTC)))


@lru_cache
def get_preview_keyring() -> PreviewKeyring:
    return PreviewKeyring.from_settings(get_settings())
