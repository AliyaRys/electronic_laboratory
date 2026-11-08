"""Application settings (ADR-001/013: separate DB host/port/user/password/name)."""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import quote

from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.src.infrastructure.config.enums import EnvironmentOption

__all__ = ["Settings", "get_settings"]


class Settings(BaseSettings):
    """Central configuration, read from the process environment.

    The database DSN is assembled from ``DB_HOST``/``DB_PORT``/``DB_USER``/
    ``DB_PASSWORD``/``DB_NAME`` (ADR-001); ``DATABASE_URL`` is accepted as an
    override for CI and tests. Secrets are never logged.
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: EnvironmentOption = EnvironmentOption.DEVELOPMENT

    # Database — separate variables (ADR-001/013), with DATABASE_URL as override.
    db_host: str = "localhost"
    db_port: int = 5432
    db_user: str = "postgres"
    db_password: str = "postgres"
    db_name: str = "postgres"
    database_url: str | None = None

    database_pool_size: int = 20
    database_max_overflow: int = 0
    database_pool_pre_ping: bool = True

    # Application metadata (OpenAPI)
    app_name: str = "Электронная лаборатория ВСЭ"
    app_version: str = "0.1.0"

    # Security
    secret_key: str = "insecure-secret-key-change-this"
    # JSON keyring shared by every worker; required in production (ADR-021).
    report_preview_keys: str | None = None
    # E03/O02: destructive examination deletes require a verified synchronous
    # WAL receiver. Disabled is the safe default until O02 provisions it.
    delete_durability_enabled: bool = False

    # Redis (sessions / rate limit / queue transport; ADR-005)
    redis_url: str = "redis://localhost:6379/0"
    session_cookie_secure: bool = True

    # API
    api_prefix: str = "/api/v1"

    @property
    def async_database_url(self) -> str:
        """The asyncpg DSN, from ``DATABASE_URL`` or assembled from ``DB_*`` vars."""
        if self.database_url:
            return self.database_url
        password = quote(self.db_password, safe="")
        return f"postgresql+asyncpg://{self.db_user}:{password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @property
    def sync_database_url(self) -> str:
        """A psycopg URL used only by the limited Casbin adapter thread pool."""
        async_url = self.async_database_url
        if async_url.startswith("postgresql+asyncpg://"):
            return "postgresql+psycopg://" + async_url.removeprefix("postgresql+asyncpg://")
        return async_url

    @property
    def is_production(self) -> bool:
        return self.environment == EnvironmentOption.PRODUCTION


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
