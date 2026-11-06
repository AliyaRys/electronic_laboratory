"""make Casbin columns compatible with sqlalchemy-adapter

Revision ID: 0002_auth_policy_adapter
Revises: 0001_identity
Create Date: 2026-11-06

The official adapter serializes only non-NULL values. Empty-string defaults in
the baseline produced six-field policies and Casbin correctly rejected them.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_auth_policy_adapter"
down_revision: str | Sequence[str] | None = "0001_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE_ACTIONS = {
    "ADMIN": (
        "catalog:bulk-price",
        "catalog:create",
        "catalog:delete",
        "catalog:read",
        "catalog:retry",
        "catalog:update",
        "context:list",
        "operation:read",
        "password:change",
        "profile:read",
        "users:block",
        "users:create",
        "users:delete",
        "users:history",
        "users:list",
        "users:read",
        "users:reset-password",
        "users:unblock",
        "users:update",
    ),
    "ANALYST": (
        "arrivals:count",
        "arrivals:list",
        "arrivals:read",
        "arrivals:search",
        "catalog:bulk-price",
        "catalog:create",
        "catalog:delete",
        "catalog:read",
        "catalog:retry",
        "catalog:update",
        "conclusion:pdf",
        "conclusion:preview",
        "conclusion:print",
        "context:list",
        "examination:count",
        "examination:list",
        "examination:read",
        "examination:search",
        "operation:read",
        "password:change",
        "profile:read",
        "report:5vet-delete",
        "report:5vet-export",
        "report:5vet-list",
        "report:5vet-preview",
        "report:5vet-read",
        "report:5vet-save",
        "report:operational",
        "sample:read",
    ),
    "HEAD": (
        "arrivals:count",
        "arrivals:hide",
        "arrivals:list",
        "arrivals:read",
        "arrivals:search",
        "catalog:create",
        "catalog:delete",
        "catalog:read",
        "catalog:update",
        "conclusion:pdf",
        "conclusion:preview",
        "conclusion:print",
        "context:list",
        "examination:complete-waiting",
        "examination:count",
        "examination:create-complete",
        "examination:create-wait",
        "examination:delete",
        "examination:list",
        "examination:read",
        "examination:search",
        "examination:update",
        "operation:read",
        "password:change",
        "profile:read",
        "receipt:reconcile",
        "receipt:submit",
        "reconciliation:save",
        "report:5vet-delete",
        "report:5vet-export",
        "report:5vet-list",
        "report:5vet-preview",
        "report:5vet-read",
        "report:5vet-save",
        "report:operational",
        "sample:collect",
        "sample:dispose",
        "sample:edit",
        "sample:read",
        "sample:reuse",
        "vetis:sync",
    ),
    "VET": (
        "arrivals:count",
        "arrivals:hide",
        "arrivals:list",
        "arrivals:read",
        "arrivals:search",
        "catalog:read",
        "conclusion:pdf",
        "conclusion:preview",
        "conclusion:print",
        "context:list",
        "examination:complete-waiting",
        "examination:count",
        "examination:create-complete",
        "examination:create-wait",
        "examination:delete",
        "examination:list",
        "examination:read",
        "examination:search",
        "examination:update",
        "operation:read",
        "password:change",
        "profile:read",
        "receipt:reconcile",
        "receipt:submit",
        "reconciliation:save",
        "sample:collect",
        "sample:dispose",
        "sample:edit",
        "sample:read",
        "sample:reuse",
        "vetis:sync",
    ),
}


def upgrade() -> None:
    for column in ("ptype", "v0", "v1", "v2", "v3", "v4", "v5"):
        op.alter_column(
            "casbin_rule",
            column,
            existing_type=sa.String(length=255),
            nullable=True,
            server_default=None,
        )
    policy_table = sa.table(
        "casbin_rule",
        sa.column("ptype", sa.String()),
        sa.column("v0", sa.String()),
        sa.column("v1", sa.String()),
    )
    op.execute("DELETE FROM casbin_rule")
    op.bulk_insert(
        policy_table,
        [{"ptype": "p", "v0": role, "v1": action} for role, actions in ROLE_ACTIONS.items() for action in actions],
    )


def downgrade() -> None:
    op.execute("DELETE FROM casbin_rule")
    for column in ("ptype", "v0", "v1", "v2", "v3", "v4", "v5"):
        op.execute(sa.text(f"UPDATE casbin_rule SET {column} = '' WHERE {column} IS NULL"))
        op.alter_column(
            "casbin_rule",
            column,
            existing_type=sa.String(length=255),
            nullable=False,
            server_default=sa.text("''"),
        )
