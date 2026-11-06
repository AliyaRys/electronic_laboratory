"""user administration constraints

Revision ID: 0003_user_admin_constraints
Revises: 0002_auth_policy_adapter
Create Date: 2026-11-06

Missing constraints and supporting index for Task I03 (DATA-01): one delegation
per (target, role, territory), a non-blank login, and a history lookup index.
Never edits the shipped 0001/0002 revisions in place.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_user_admin_constraints"
down_revision: str | Sequence[str] | None = "0002_auth_policy_adapter"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_delegation_grant_target", "delegation_grants", ["target_id", "role", "territory_id"]
    )
    op.create_check_constraint("login_not_blank", "users", sa.text("btrim(login) <> ''"))
    op.create_index("ix_user_events_target_at", "user_events", ["target_user_id", "at"])


def downgrade() -> None:
    op.drop_index("ix_user_events_target_at", table_name="user_events")
    op.drop_constraint("login_not_blank", "users", type_="check")
    op.drop_constraint("uq_delegation_grant_target", "delegation_grants", type_="unique")
