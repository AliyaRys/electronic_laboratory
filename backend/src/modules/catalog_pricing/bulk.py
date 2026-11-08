"""Bulk price jobs (Task C02): immutable intent, per-target transactions.

The controller decisions implemented here:

- job creation is ONE command: the ENTIRE coverage scope is validated before
  anything is written (one foreign target → 403 and zero changes);
- the job and its target list are immutable after creation; every target is
  applied in its OWN SQL transaction, so one failing laboratory never rolls
  back the others;
- retry re-applies ONLY the FAILED targets with the original intent and a NEW
  command key; SUCCEEDED targets are never touched;
- the access right is re-checked per target at application time (SPEC-04
  «доступ заново на каждую цель»).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.commands import UnitOfWork
from backend.src.core.contracts import CommandStateView
from backend.src.modules.catalog_pricing.models import BulkPriceJob, BulkPriceTarget, Tariff
from backend.src.modules.catalog_pricing.schemas import MoneyStringType, parse_decimal
from backend.src.modules.identity.authz import Authorizer, ScopeTarget
from backend.src.modules.identity.models import CommandRecord, CommandStatus, TechnicalEvent

__all__ = [
    "BulkPriceWrite",
    "BulkPriceTargetView",
    "BulkPriceJobView",
    "BulkAccepted",
    "CommandStateView",
    "upsert_tariff",
    "apply_target",
    "create_job",
    "run_failed_targets",
    "job_state",
    "load_job",
    "job_view",
    "command_state_view",
]


# --- DTOs (API-03) ------------------------------------------------------------------


class BulkPriceWrite(BaseModel):
    """The whole-set intent of a bulk price command; no ETag applies to it."""

    model_config = ConfigDict(extra="forbid")

    laboratory_ids: list[uuid.UUID] = Field(min_length=1)
    product_species_id: uuid.UUID
    service_code: str = Field(min_length=1, max_length=128)
    unit_id: str = Field(min_length=1, max_length=64)
    price: MoneyStringType

    def intent(self) -> dict[str, Any]:
        """The immutable intent payload stored with the command hash."""
        return self.model_dump(mode="json")


class BulkPriceTargetView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lab_id: uuid.UUID
    state: str
    problem: str | None = None


class BulkPriceJobView(BaseModel):
    """GET /catalogs/bulk-prices/:id — the per-target actual results."""

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    state: str
    targets: list[BulkPriceTargetView]


class BulkAccepted(BaseModel):
    """The 202 answer of an accepted bulk command (API-01)."""

    model_config = ConfigDict(extra="forbid")

    operation_id: uuid.UUID
    state: str
    status_url: str


# --- state derivation ----------------------------------------------------------------


def job_state(targets: list[BulkPriceTarget]) -> str:
    """Derive the aggregate state from the per-target actual results."""
    states = {target.state for target in targets}
    if states == {"SUCCEEDED"}:
        return "COMPLETED"
    if states == {"FAILED"}:
        return "FAILED"
    if states <= {"SUCCEEDED", "FAILED"}:
        return "PARTIAL"
    if states == {"PENDING"}:
        return "PENDING"
    return "RUNNING"


# --- application ---------------------------------------------------------------------


async def upsert_tariff(db: AsyncSession, intent: BulkPriceWrite, laboratory_id: uuid.UUID) -> None:
    """Set the tariff of one laboratory to the intended price (own row only).

    The unique pricing key (laboratory, species, code, unit) decides between an
    update (revision bump) and a create; no other laboratory is ever touched —
    bulk pricing never inherits (AT-21/SC-096).
    """
    existing = (
        await db.execute(
            select(Tariff)
            .where(
                Tariff.laboratory_id == laboratory_id,
                Tariff.product_species_id == intent.product_species_id,
                Tariff.service_code == intent.service_code,
                Tariff.unit_id == intent.unit_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    price = parse_decimal(intent.price)
    if existing is not None:
        existing.price = Decimal(price)
        existing.version += 1
        existing.source = {"name": "Массовая команда цены"}
        existing.rev += 1
    else:
        db.add(
            Tariff(
                laboratory_id=laboratory_id,
                product_species_id=intent.product_species_id,
                service_code=intent.service_code,
                unit_id=intent.unit_id,
                price=Decimal(price),
                version=1,
                source={"name": "Массовая команда цены"},
            )
        )
    await db.flush()


async def apply_target(
    db: AsyncSession,
    authorizer: Authorizer,
    actor_id: uuid.UUID,
    target: BulkPriceTarget,
    intent: BulkPriceWrite,
) -> None:
    """Apply one laboratory target inside ITS OWN transaction.

    The caller opens and commits the transaction; an exception rolls the whole
    target back without affecting the others. The access right is re-checked
    here, at application time (SPEC-04: actual rights, never a stale check).
    """
    await authorizer.authorize(
        db,
        actor_id,
        "catalog:bulk-price",
        ScopeTarget(laboratory_id=target.laboratory_id, product_scope_id=intent.product_species_id),
    )
    await upsert_tariff(db, intent, target.laboratory_id)
    target.state = "SUCCEEDED"
    target.problem_code = None


# --- command pieces -------------------------------------------------------------------


async def create_job(db: AsyncSession, actor_id: uuid.UUID, intent: BulkPriceWrite) -> BulkPriceJob:
    """Insert the immutable job and its immutable PENDING target list."""
    job = BulkPriceJob(
        actor_id=actor_id,
        product_species_id=intent.product_species_id,
        service_code=intent.service_code,
        unit_id=intent.unit_id,
        price=Decimal(parse_decimal(intent.price)),
        created_at=datetime.now(UTC).date(),
    )
    db.add(job)
    await db.flush()
    seen: set[uuid.UUID] = set()
    for laboratory_id in intent.laboratory_ids:
        if laboratory_id in seen:
            continue
        seen.add(laboratory_id)
        db.add(BulkPriceTarget(job_id=job.id, laboratory_id=laboratory_id, state="PENDING"))
    await db.flush()
    return job


async def load_job(db: AsyncSession, job_id: uuid.UUID) -> tuple[BulkPriceJob, list[BulkPriceTarget]] | None:
    job = (await db.execute(select(BulkPriceJob).where(BulkPriceJob.id == job_id))).scalar_one_or_none()
    if job is None:
        return None
    targets = (
        (
            await db.execute(
                select(BulkPriceTarget).where(BulkPriceTarget.job_id == job_id).order_by(BulkPriceTarget.laboratory_id)
            )
        )
        .scalars()
        .all()
    )
    return job, list(targets)


def job_view(job: BulkPriceJob, targets: list[BulkPriceTarget]) -> BulkPriceJobView:
    return BulkPriceJobView(
        id=job.id,
        state=job_state(targets),
        targets=[
            BulkPriceTargetView(lab_id=target.laboratory_id, state=target.state, problem=target.problem_code)
            for target in targets
        ],
    )


def command_state_view(record: CommandRecord) -> CommandStateView:
    """The minimal CommandState per API-01 for a catalog command record."""
    return CommandStateView(
        id=record.id,
        kind="catalog",
        state=record.status.value if isinstance(record.status, CommandStatus) else str(record.status),
        result_id=record.result_id,
        problem=record.problem_code,
        updated_at=record.finished_at,
    )


def technical_event(db: AsyncSession, actor_id: uuid.UUID, job_id: uuid.UUID, result: str) -> None:
    """One technical event per DATA-05 for the accepted 202 operation."""
    db.add(
        TechnicalEvent(
            actor_id=actor_id,
            object_uuid=job_id,
            action="bulk-price",
            at=datetime.now(UTC),
            result=result,
            trace_id=uuid.uuid4().hex,
            operation_id=job_id,
        )
    )


async def run_failed_targets(
    uow: UnitOfWork,
    authorizer: Authorizer,
    actor_id: uuid.UUID,
    job: BulkPriceJob,
    targets: list[BulkPriceTarget],
    intent: BulkPriceWrite,
    only: set[uuid.UUID] | None = None,
) -> str:
    """Apply targets one by one, each in its OWN SQL transaction.

    ``only`` limits the application to a subset of laboratories (the retry
    path passes exactly the FAILED set); SUCCEEDED targets are never repeated.
    The session commits between targets, so one failing laboratory never rolls
    back the others. Returns the derived aggregate state.
    """
    db = uow.session
    job_id = job.id
    plan = [(target.laboratory_id, target.state) for target in targets]
    for laboratory_id, initial_state in plan:
        if only is not None and laboratory_id not in only:
            continue
        if initial_state == "SUCCEEDED":
            continue
        try:
            # The target row is loaded FRESH inside this target's transaction
            # (and locked): after any earlier rollback the previous ORM objects
            # are expired and a sync refresh would be illegal in asyncio.
            target = (
                (
                    await db.execute(
                        select(BulkPriceTarget)
                        .where(
                            BulkPriceTarget.job_id == job_id,
                            BulkPriceTarget.laboratory_id == laboratory_id,
                        )
                        .with_for_update()
                    )
                )
                .scalars()
                .one()
            )
            await apply_target(db, authorizer, actor_id, target, intent)
        except Exception as exc:  # noqa: BLE001 - the actual per-target result
            await db.rollback()
            problem_code = getattr(exc, "code", "INTERNAL_ERROR")
            target = (
                (
                    await db.execute(
                        select(BulkPriceTarget)
                        .where(
                            BulkPriceTarget.job_id == job_id,
                            BulkPriceTarget.laboratory_id == laboratory_id,
                        )
                        .with_for_update()
                    )
                )
                .scalars()
                .one()
            )
            target.state = "FAILED"
            target.problem_code = str(problem_code)
            await db.flush()
        await db.commit()
    refreshed = (await db.execute(select(BulkPriceTarget).where(BulkPriceTarget.job_id == job_id))).scalars().all()
    return job_state(list(refreshed))
