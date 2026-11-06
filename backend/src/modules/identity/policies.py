"""Canonical application permission matrix and Casbin policy installation."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.identity.models import CasbinRule, UserRole

# Exact actions from docs/TZ_development/plans/permissions.md. Scope and state
# constraints are supplied as request attributes; a role alone never grants scope.
PERMISSION_MATRIX: dict[str, frozenset[UserRole]] = {
    "profile:read": frozenset(UserRole),
    "password:change": frozenset(UserRole),
    "context:list": frozenset(UserRole),
    **{
        f"arrivals:{op}": frozenset({UserRole.VET, UserRole.HEAD, UserRole.ANALYST})
        for op in ("list", "read", "search", "count")
    },
    "arrivals:hide": frozenset({UserRole.VET, UserRole.HEAD}),
    "reconciliation:save": frozenset({UserRole.VET, UserRole.HEAD}),
    "vetis:sync": frozenset({UserRole.VET, UserRole.HEAD}),
    "receipt:submit": frozenset({UserRole.VET, UserRole.HEAD}),
    "receipt:reconcile": frozenset({UserRole.VET, UserRole.HEAD}),
    "operation:read": frozenset(UserRole),
    **{
        f"examination:{op}": frozenset({UserRole.VET, UserRole.HEAD, UserRole.ANALYST})
        for op in ("list", "read", "search", "count")
    },
    "examination:create-wait": frozenset({UserRole.VET, UserRole.HEAD}),
    "examination:create-complete": frozenset({UserRole.VET, UserRole.HEAD}),
    "examination:update": frozenset({UserRole.VET, UserRole.HEAD}),
    "examination:complete-waiting": frozenset({UserRole.VET, UserRole.HEAD}),
    "examination:delete": frozenset({UserRole.VET, UserRole.HEAD}),
    **{
        f"conclusion:{op}": frozenset({UserRole.VET, UserRole.HEAD, UserRole.ANALYST})
        for op in ("preview", "pdf", "print")
    },
    "sample:read": frozenset({UserRole.VET, UserRole.HEAD, UserRole.ANALYST}),
    **{f"sample:{op}": frozenset({UserRole.VET, UserRole.HEAD}) for op in ("collect", "reuse", "edit", "dispose")},
    "catalog:read": frozenset(UserRole),
    **{
        f"catalog:{op}": frozenset({UserRole.HEAD, UserRole.ADMIN, UserRole.ANALYST})
        for op in ("create", "update", "delete")
    },
    **{f"catalog:{op}": frozenset({UserRole.ADMIN, UserRole.ANALYST}) for op in ("bulk-price", "retry")},
    "report:operational": frozenset({UserRole.HEAD, UserRole.ANALYST}),
    **{
        f"report:5vet-{op}": frozenset({UserRole.HEAD, UserRole.ANALYST})
        for op in ("list", "read", "export", "preview", "save", "delete")
    },
    **{
        f"users:{op}": frozenset({UserRole.ADMIN})
        for op in ("list", "read", "history", "create", "update", "block", "unblock", "reset-password", "delete")
    },
}

DENIED_ACTIONS = frozenset(
    {"sample:disposal-update", "sample:disposal-delete", "report:5vet-update", "delegation:self-escalate"}
)


def policy_rows() -> Iterable[tuple[str, str]]:
    for action, roles in PERMISSION_MATRIX.items():
        for role in sorted(roles, key=str):
            yield role.value, action


async def install_default_policies(session: AsyncSession) -> None:
    """Install the versioned matrix in the official adapter table atomically."""
    await session.execute(delete(CasbinRule))
    for role, action in policy_rows():
        session.add(CasbinRule(ptype="p", v0=role, v1=action))
