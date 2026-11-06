"""Infrastructure configuration enums."""

from __future__ import annotations

from enum import StrEnum

__all__ = ["EnvironmentOption"]


class EnvironmentOption(StrEnum):
    """Application environment."""

    PRODUCTION = "production"
    STAGING = "staging"
    DEVELOPMENT = "development"
    LOCAL = "local"
    PYTEST = "pytest"
