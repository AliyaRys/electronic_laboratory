"""identity + command journal + outbox

Revision ID: 0001_identity
Revises:
Create Date: 2026-11-06

One-shot foundation schema (DATA-01, DATA-05): territories, laboratories, users,
scopes, delegation grants, user events, the official Casbin rule table, the local
command journal, technical events, and the outbox. External VetIS handling is
added by later tasks.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_identity"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def upgrade() -> None:
    op.create_table(
        "territories",
        _uuid_pk(),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["parent_id"], ["territories.id"], ondelete="RESTRICT"),
    )

    op.create_table(
        "laboratories",
        _uuid_pk(),
        sa.Column("territory_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("organization", sa.String(length=255), nullable=False),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.CheckConstraint("rev >= 1", name="rev_positive"),
        sa.ForeignKeyConstraint(["territory_id"], ["territories.id"], ondelete="RESTRICT"),
    )

    op.create_table(
        "users",
        _uuid_pk(),
        sa.Column("login", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("position", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("rev", sa.BigInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("login", name="uq_users_login"),
        sa.CheckConstraint("rev >= 1", name="rev_positive"),
        sa.CheckConstraint("role IN ('VET','HEAD','ADMIN','ANALYST')", name="role_valid"),
    )

    op.create_table(
        "user_scopes",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("laboratory_id", postgresql.UUID(as_uuid=True), nullable=False),
        # DATA-01: the PK over the three columns guarantees UNIQUE-of-three and
        # NOT NULL on each of them; a separate unique constraint would only
        # duplicate the PK index.
        sa.Column("product_scope_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "laboratory_id", "product_scope_id", name="pk_user_scopes"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["laboratory_id"], ["laboratories.id"], ondelete="RESTRICT"),
    )

    op.create_table(
        "delegation_grants",
        _uuid_pk(),
        sa.Column("grantor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("territory_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("may_delegate", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.CheckConstraint("role IN ('VET','HEAD','ADMIN','ANALYST')", name="role_valid"),
        sa.ForeignKeyConstraint(["grantor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["target_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["territory_id"], ["territories.id"], ondelete="RESTRICT"),
    )

    op.create_table(
        "user_events",
        _uuid_pk(),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("changed_fields", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
    )

    # Official sqlalchemy-adapter Casbin rule table (ADR-004).
    op.create_table(
        "casbin_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ptype", sa.String(length=255), nullable=False),
        sa.Column("v0", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("v1", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("v2", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("v3", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("v4", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("v5", sa.String(length=255), nullable=False, server_default=sa.text("''")),
    )

    op.create_table(
        "command_records",
        _uuid_pk(),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("context_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=255), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("result_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("problem_code", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("actor_id", "action", "context_id", "key", name="uq_command_scope"),
        sa.CheckConstraint("status IN ('IN_PROGRESS','SUCCESS','FAILED')", name="status_valid"),
    )

    op.create_table(
        "technical_events",
        _uuid_pk(),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("object_uuid", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("result", sa.String(length=64), nullable=False),
        sa.Column("trace_id", sa.String(length=64), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=True),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    op.create_table(
        "outbox",
        _uuid_pk(),
        sa.Column("operation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("lease_owner", sa.String(length=128), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("delivered_at IS NULL OR lease_until IS NULL", name="delivered_or_leased"),
    )
    op.create_index("ix_outbox_operation_id", "outbox", ["operation_id"])
    op.create_index("ix_outbox_next_attempt_at", "outbox", ["next_attempt_at"])


def downgrade() -> None:
    op.drop_table("outbox")
    op.drop_table("technical_events")
    op.drop_table("command_records")
    op.drop_table("casbin_rule")
    op.drop_table("user_events")
    op.drop_table("delegation_grants")
    op.drop_table("user_scopes")
    op.drop_table("users")
    op.drop_table("laboratories")
    op.drop_table("territories")
