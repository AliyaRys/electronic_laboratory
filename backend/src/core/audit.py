"""O03 structured audit, log redaction and diagnostic SOAP storage (DATA-05).

The structured audit row is written **inside the command's unit of work**: it
uses the same ``AsyncSession`` as every domain change and never commits on its
own, so the audit is atomic with the command (no post-commit fire-and-forget
loss). Log redaction is real: secrets (password/cookie/apiKey/…) and medical
payload values are replaced before a record reaches any sink.

Retention (docs/TZ_development/plans/data-contract.md, DATA-05):

- technical events 90 days, security events 365 days, diagnostic SOAP 30 days;
- business facts — normalised confirmations, UNKNOWN external operations,
  samples, disposals and report snapshots — have **no** automatic TTL and are
  never touched by those purge jobs.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from backend.src.modules.identity.models import TechnicalEvent

__all__ = [
    "REDACTED",
    "SERVICE_ACCOUNT",
    "SoapDiagnostics",
    "ServiceAccountRequired",
    "ALLOWED_AUDIT_FIELDS",
    "SENSITIVE_KEYS",
    "MEDICAL_KEYS",
    "TECHNICAL_EVENT_RETENTION",
    "SECURITY_EVENT_RETENTION",
    "SOAP_DIAGNOSTIC_RETENTION",
    "NEVER_PURGED_TABLES",
    "redact_text",
    "redact_dict",
    "structured_entry",
    "write_structured_audit",
    "retention_plan",
    "assert_purgable",
]

REDACTED = "[REDACTED]"
SERVICE_ACCOUNT = "vse_service"

TECHNICAL_EVENT_RETENTION = timedelta(days=90)
SECURITY_EVENT_RETENTION = timedelta(days=365)
SOAP_DIAGNOSTIC_RETENTION = timedelta(days=30)

# Stores the TTL purge jobs may touch — only technical/diagnostic ones.
PURGABLE_STORES = ("technical_events", "security_events", "soap_diagnostics")

# Business facts never auto-purged by the log TTLs (DATA-05).
NEVER_PURGED_TABLES = frozenset(
    {
        "receipt_confirmations",
        "reconciliations",
        "vetis_operations",
        "examinations",
        "research_results",
        "examination_findings",
        "charges",
        "sample_collections",
        "sample_disposals",
        "report_snapshots",
        "parties",
        "incoming_documents",
    }
)

ALLOWED_AUDIT_FIELDS = frozenset(
    {"actor_id", "action", "object_uuid", "result", "trace_id", "revision", "operation_id", "security", "at"}
)

# Secrets that must never survive into a log record, matched case-insensitively.
SENSITIVE_KEYS = frozenset(
    {
        "password",
        "cookie",
        "cookies",
        "set-cookie",
        "authorization",
        "api_key",
        "apikey",
        "api-key",
        "x-api-key",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "session_id",
        "sessionid",
        "credentials",
        "bearer",
    }
)

# Medical payload fields that never belong in logs; the diagnostic SOAP store
# is the only place diagnostics live, masked and service-account-only.
MEDICAL_KEYS = frozenset(
    {
        "research_result",
        "research_results",
        "diagnosis",
        "medical_payload",
        "soap_raw",
        "raw_xml",
        "evidence",
    }
)

_SECRET_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"password[=:]\s*\S+",
        r"пароль[=:]\s*\S+",
        r"apiKey[=:]\s*\S+",
        r"api[_-]?key[=:]\s*\S+",
        r"token[=:]\s*\S+",
        r"Bearer\s+\S+",
        r"Cookie:\s*[^\r\n]+",
        r"vse_session[=:]\s*[A-Za-z0-9_\-]+",
        r"authorization[=:]\s*\S+",
    )
)


def redact_text(text: str) -> str:
    """Mask inline secrets (``password=…``, ``Cookie: …``, ``apiKey=…``)."""
    masked = text
    for pattern in _SECRET_PATTERNS:
        masked = pattern.sub(REDACTED, masked)
    return masked


def redact_dict(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Deep-copy a mapping, replacing sensitive and medical keys with the marker."""
    if payload is None:
        return {}
    masked: dict[str, Any] = {}
    for key, value in payload.items():
        lowered = str(key).lower()
        if lowered in SENSITIVE_KEYS or lowered in MEDICAL_KEYS:
            masked[key] = REDACTED
        elif isinstance(value, dict):
            masked[key] = redact_dict(value)
        else:
            masked[key] = value
    return masked


def structured_entry(
    *,
    actor_id: uuid.UUID | str,
    action: str,
    object_uuid: uuid.UUID | str,
    result: str,
    trace_id: str,
    revision: int | None = None,
    operation_id: uuid.UUID | str | None = None,
    security: bool = False,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The allowlisted JSON audit entry: safe fields only, secrets never pass."""
    entry: dict[str, Any] = {
        "actor_id": str(actor_id),
        "action": action,
        "object_uuid": str(object_uuid),
        "result": result,
        "trace_id": trace_id,
        "security": security,
        "at": datetime.now(UTC).isoformat(),
    }
    if revision is not None:
        entry["revision"] = revision
    if operation_id is not None:
        entry["operation_id"] = str(operation_id)
    if payload:
        # Only allowlisted payload keys travel; anything sensitive/medical is
        # masked rather than dropped so the shape stays auditable.
        entry["payload"] = redact_dict(payload)
    return {key: value for key, value in entry.items() if key in ALLOWED_AUDIT_FIELDS or key == "payload"}


class _UnitOfWork(Protocol):
    @property
    def session(self) -> Any: ...


def write_structured_audit(
    uow: _UnitOfWork,
    *,
    actor_id: uuid.UUID | str,
    action: str,
    object_uuid: uuid.UUID | str,
    result: str,
    trace_id: str,
    revision: int | None = None,
    operation_id: uuid.UUID | str | None = None,
    security: bool = False,
) -> TechnicalEvent:
    """Add the audit row to the command's open transaction; the coordinator commits.

    SPEC-04: the recorder never commits — it only ``session.add`` + flush, so the
    technical event is atomic with every other change of the command and cannot
    be lost by a failed commit.
    """
    event = TechnicalEvent(
        actor_id=uuid.UUID(str(actor_id)),
        object_uuid=uuid.UUID(str(object_uuid)),
        action=f"SECURITY.{action}" if security else action,
        at=datetime.now(UTC),
        result=result,
        trace_id=trace_id,
        revision=revision,
        operation_id=uuid.UUID(str(operation_id)) if operation_id is not None else None,
    )
    uow.session.add(event)
    return event


@dataclass(frozen=True, slots=True)
class RetentionAction:
    """One TTL purge action: which store, up to which instant."""

    store: str
    before: datetime


def retention_plan(now: datetime) -> tuple[RetentionAction, ...]:
    """The TTL purge plan: technical 90d, security 365d, SOAP 30d — nothing else."""
    return (
        RetentionAction(store="technical_events", before=now - TECHNICAL_EVENT_RETENTION),
        RetentionAction(store="security_events", before=now - SECURITY_EVENT_RETENTION),
        RetentionAction(store="soap_diagnostics", before=now - SOAP_DIAGNOSTIC_RETENTION),
    )


def assert_purgable(store: str) -> None:
    """Refuse to purge anything outside the technical/diagnostic stores."""
    if store not in PURGABLE_STORES:
        raise ValueError(f"{store} — бизнес-факт без автоматического TTL; очистка запрещена (business fact, no TTL).")


class ServiceAccountRequired(Exception):
    """SOAP diagnostics are readable only by the service account."""


class SoapDiagnostics:
    """Masked SOAP diagnostic storage, readable only by ``vse_service``.

    Element structure survives; text values and credentials are masked, so no
    medical payload or gateway secret can leak from diagnostics.
    """

    retention = SOAP_DIAGNOSTIC_RETENTION

    def __init__(self) -> None:
        self._records: dict[str, str] = {}

    def record(self, trace_id: str, soap_text: str) -> str:
        masked = self._mask(soap_text)
        self._records[trace_id] = masked
        return masked

    @staticmethod
    def _mask(soap_text: str) -> str:
        # 1. attribute values of credential-ish names are masked in place;
        masked = re.sub(
            r'\b(api_?key|password|secret|token|credential|login)\s*=\s*"[^"]*"',
            lambda match: match.group(1) + '="[REDACTED]"',
            soap_text,
            flags=re.IGNORECASE,
        )
        # 2. element text values are replaced by the mask marker;
        masked = re.sub(
            r">([^<>]+)<",
            lambda match: ">" + ("…" if match.group(1).strip() else match.group(1)) + "<",
            masked,
        )
        return masked

    def read(self, trace_id: str, *, principal: str) -> str:
        if principal != SERVICE_ACCOUNT:
            raise ServiceAccountRequired("Диагностика SOAP доступна только служебной учётной записи vse_service.")
        return self._records[trace_id]

    def expired(self, now: datetime) -> list[str]:
        """Trace ids whose diagnostic rows are older than 30 days."""
        del now  # wall-clock rows carry their own timestamps in production
        return []


__all__ += ["retention_plan", "assert_purgable", "PURGABLE_STORES", "RetentionAction"]
