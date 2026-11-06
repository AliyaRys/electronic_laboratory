"""Password policy and Argon2id hashing for API-02."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128

# Argon2id: 64 MiB memory, three iterations, one lane (ADR-004).
ARGON2 = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)
DUMMY_PASSWORD_HASH = ARGON2.hash("not a real account password")

__all__ = [
    "MIN_PASSWORD_LENGTH",
    "MAX_PASSWORD_LENGTH",
    "DUMMY_PASSWORD_HASH",
    "hash_password",
    "verify_password",
    "validate_password",
]


def validate_password(password: str) -> None:
    """Enforce length only; class-mixing and periodic rotation are forbidden."""
    if not (MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH):
        raise ValueError(f"Пароль должен содержать от {MIN_PASSWORD_LENGTH} до {MAX_PASSWORD_LENGTH} символов.")


def hash_password(password: str) -> str:
    validate_password(password)
    return ARGON2.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return ARGON2.verify(password_hash, password)
    except InvalidHashError, VerificationError:
        return False
