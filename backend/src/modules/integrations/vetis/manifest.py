"""Versioned VetIS ВУ contract manifest (INPUT-01, ADR-018).

The manifest is a versioned, committed artifact: endpoint, serviceId, business
namespace, SOAP actions, constraints and the initiator policy of the pinned
Veterinary-Authority test profile. It deliberately contains NO secrets — the
issued test profile (gateway login/password, apiKey, issuerId, enterprise
scope) loads only from a server-side secret file referenced by the
``VETIS_SECRET_PROFILE`` environment variable and is never committed, logged
or returned by any API.

Schema pinning: until the WSDL and every XSD import are downloaded and pinned
by SHA-256 (``schema_pins.status == "PINNED"``), the adapter honestly refuses
to touch the network (503 ``INTEGRATION_NOT_CONFIGURED``). A successful XML
example never replaces schema pinning.

The structural rules of ``manifest.schema.json`` are enforced here field by
field (the deployment has no JSON-Schema dependency; this loader is its
executable counterpart and both artifacts must change together).
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.src.core.problems import ProblemError

__all__ = [
    "ManifestPinError",
    "SchemaPins",
    "SecretProfile",
    "VetisManifest",
    "load_manifest",
    "load_manifest_with_pins",
    "load_secret_profile",
]

_XML_MAX_BYTES = 32 * 1024 * 1024
_XML_MAX_DEPTH = 128

_SECRETS_FORBIDDEN = ("apiKey", "issuerId", "password", "login")


def integration_not_configured() -> ProblemError:
    """The stable 503 problem for an unconfigured/pinned-but-absent VetIS profile."""
    return ProblemError(
        status=503,
        code="INTEGRATION_NOT_CONFIGURED",
        title="Integration not configured",
        detail=(
            "Интеграция с ВетИС не настроена. Обновление поступлений недоступно; обратитесь к администратору установки."
        ),
    )


class ManifestPinError(ProblemError):
    """A pinned resource does not match its recorded SHA-256."""


class PinEntry(BaseModel):
    """One pinned schema resource and its SHA-256."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    resource: str
    sha256: str
    imports: list[str] = Field(default_factory=list)


class WsdlPin(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    resource: str
    sha256: str


class SchemaPins(BaseModel):
    """Pinned WSDL/XSD state: ``PENDING`` refuses every live call."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["PINNED", "PENDING"]
    wsdl: WsdlPin | None = None
    xsd: list[PinEntry] = Field(default_factory=list)


class OperationPin(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    input_type: str
    output_type: str
    read_only: bool


class ManifestConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    page_count_max: int
    issue_date_interval_days_max: int
    xml_max_bytes: int
    xml_max_depth: int
    connect_timeout_s: int
    read_timeout_s: int


class InitiatorPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["SERVICE_READ_IDENTITY"]
    secret_ref: str
    write_capability: bool


class VetisManifest(BaseModel):
    """The validated manifest of the ВУ test profile (secrets never inside)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    profile_id: str
    manifest_version: int
    contour: str
    family: str
    service_id: str
    endpoint: str
    business_schema_version: str
    soap_version: str
    namespaces: dict[str, str]
    soap_actions: dict[str, str]
    operations: list[OperationPin]
    schema_pins: SchemaPins
    constraints: ManifestConstraints
    initiator: InitiatorPolicy
    evidence_links: list[str]


def _validate(raw: dict[str, object]) -> None:
    """The executable counterpart of ``manifest.schema.json``."""
    required = (
        "profile_id",
        "manifest_version",
        "contour",
        "family",
        "service_id",
        "endpoint",
        "business_schema_version",
        "soap_version",
        "namespaces",
        "soap_actions",
        "operations",
        "schema_pins",
        "constraints",
        "initiator",
        "evidence_links",
    )
    missing = [key for key in required if key not in raw]
    if missing:
        raise ValueError(f"В manifest отсутствуют обязательные поля: {', '.join(missing)}")
    if raw["family"] != "mercury-vu.service":
        raise ValueError("Поддерживается только профиль ветеринарных управлений (mercury-vu.service).")
    if raw["service_id"] != "mercury-vu.service:2.0":
        raise ValueError("Неверный serviceId профиля ВУ.")
    if not str(raw["endpoint"]).startswith("https://"):
        raise ValueError("Endpoint профиля ВУ должен использовать HTTPS.")
    if raw["contour"] not in ("PILOT", "PRODUCTION"):
        raise ValueError("Неверный контур manifest.")
    initiator = raw["initiator"]
    if not isinstance(initiator, dict) or initiator.get("write_capability") is not False:
        raise ValueError("Read-идентичность manifest не имеет write-полномочий.")
    text = json.dumps(raw, ensure_ascii=False)
    for forbidden in _SECRETS_FORBIDDEN:
        if forbidden.lower() in text.lower():
            raise ValueError(f"Manifest не может содержать поле секрета: {forbidden}")


def load_manifest(path: str | os.PathLike[str]) -> VetisManifest:
    """Load and validate the committed manifest (pins as recorded in the file)."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    _validate(raw)
    return VetisManifest.model_validate(raw)


def load_manifest_with_pins(manifest_path: str | os.PathLike[str], pins: dict[str, object]) -> VetisManifest:
    """Attach externally recorded WSDL/XSD pins, verifying every SHA-256.

    ``pins`` follows the ``schema_pins`` shape of the versioned schema. Each
    referenced file is read and its SHA-256 compared; any mismatch (or a
    missing file) is a hard :class:`ManifestPinError` — never a silent accept.
    """
    manifest = load_manifest(manifest_path)
    status = pins.get("status")
    if status not in ("PINNED", "PENDING"):
        raise ManifestPinError(
            status=503,
            code="INTEGRATION_NOT_CONFIGURED",
            title="Integration not configured",
            detail="Статус закрепления схемы ВУ неизвестен.",
        )
    if status == "PENDING":
        return manifest.model_copy(update={"schema_pins": SchemaPins(status="PENDING", wsdl=None, xsd=[])}, deep=True)

    def _verify(resource: str, expected: str) -> None:
        digest = hashlib.sha256(Path(resource).read_bytes()).hexdigest()
        if digest != expected:
            raise ManifestPinError(
                status=503,
                code="INTEGRATION_SCHEMA_PIN_MISMATCH",
                title="Schema pin mismatch",
                detail=f"SHA-256 закреплённой схемы ВУ не совпал: {Path(resource).name}.",
            )

    wsdl_raw = pins.get("wsdl")
    wsdl: WsdlPin | None = None
    if wsdl_raw is not None:
        if not isinstance(wsdl_raw, dict):
            raise ManifestPinError(
                status=503,
                code="INTEGRATION_NOT_CONFIGURED",
                title="Integration not configured",
                detail="Неверная запись закрепления WSDL.",
            )
        _verify(str(wsdl_raw["resource"]), str(wsdl_raw["sha256"]))
        wsdl = WsdlPin(resource=str(wsdl_raw["resource"]), sha256=str(wsdl_raw["sha256"]))
    xsd_raw = pins.get("xsd", [])
    if not isinstance(xsd_raw, list):
        raise ManifestPinError(
            status=503,
            code="INTEGRATION_NOT_CONFIGURED",
            title="Integration not configured",
            detail="Неверный список закреплений XSD.",
        )
    xsd_entries: list[PinEntry] = []
    for entry in xsd_raw:
        if not isinstance(entry, dict):
            raise ManifestPinError(
                status=503,
                code="INTEGRATION_NOT_CONFIGURED",
                title="Integration not configured",
                detail="Неверная запись закрепления XSD.",
            )
        _verify(str(entry["resource"]), str(entry["sha256"]))
        xsd_entries.append(
            PinEntry(
                resource=str(entry["resource"]),
                sha256=str(entry["sha256"]),
                imports=[str(item) for item in entry.get("imports", [])],
            )
        )
    return manifest.model_copy(
        update={"schema_pins": SchemaPins(status="PINNED", wsdl=wsdl, xsd=xsd_entries)}, deep=True
    )


class SecretProfile(BaseModel):
    """The issued test profile, loaded ONLY from a server-side secret file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    gateway_user: str
    gateway_password: str
    api_key: str
    issuer_id: str
    user_login: str
    enterprise_id: str
    business_member_id: str

    def __repr__(self) -> str:
        """The profile never prints its secrets."""
        return "SecretProfile(***redacted***)"


def load_secret_profile(path: str | os.PathLike[str]) -> SecretProfile:
    """Load the issued test profile from the installation secret file.

    The path comes from ``VETIS_SECRET_PROFILE``. The file is never part of the
    repository; its contents are never logged, echoed or stored in evidence.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return SecretProfile.model_validate(raw)


def secret_profile_path() -> str | None:
    """The configured secret-file path, or ``None`` when the profile is absent."""
    return os.environ.get("VETIS_SECRET_PROFILE") or None
