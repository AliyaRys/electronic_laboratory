"""Core shared contracts (DATA-06)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

__all__ = ["UUID", "CommandContext", "ResourceScope", "Page", "CommandStateView"]


@dataclass(frozen=True, slots=True)
class CommandContext:
    """The context passed to every application command (SPEC-04).

    ``actor_id`` and ``idempotency_key`` come from the transport; role/scope and
    ``now`` are never taken from the client. ``expected_revision`` carries the
    ``If-Match`` value for the targeted aggregate.
    """

    actor_id: UUID
    idempotency_key: str
    expected_revision: int | None = None


@dataclass(frozen=True, slots=True)
class ResourceScope:
    """A laboratory/product scope used by authorization (DATA-06)."""

    laboratory_id: UUID
    product_species_id: UUID | None = None


class Page[T](BaseModel):
    """A stable, ordered page of results (API-01): ``{items,total,page,page_size}``."""

    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    total: int
    page: int
    page_size: int


class CommandStateView(BaseModel):
    """API-01 state of an asynchronous or durability-uncertain command."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    kind: str
    state: str
    result_id: UUID | None = None
    problem: str | None = None
    updated_at: datetime | None = None
