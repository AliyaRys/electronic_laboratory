# ruff: noqa
r"""Identity seed for the F03 e2e suite (runs against the REAL backend database).

Usage (repo root, PowerShell):

    $env:Path = "C:\Users\Алия\.local\bin;$env:Path"
    $env:DATABASE_URL = "postgresql+asyncpg://127.0.0.1:55433/vse"
    $env:REDIS_URL = "redis://127.0.0.1:56380/0"
    uv run --frozen python frontend/tests/e2e/seed_identity.py

The script truncates the identity tables (like backend conftest), runs the
closed bootstrap CLI (OPS-01) and creates the minimum users for the four
roles plus acceptance fixtures. Credentials are written to
``frontend/test-results/identity-seed.json`` for the Playwright spec (the
directory is gitignored).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

os_imports = __import__("os")

from sqlalchemy import select, text

from backend.src.core.database import get_engine, get_session_factory
from backend.src.modules.identity.bootstrap import run_bootstrap
from backend.src.modules.identity.models import (
    Laboratory,
    Territory,
    User,
    UserEvent,
    UserRole,
    UserScope,
)
from backend.src.modules.identity.passwords import hash_password

ADMIN_LOGIN = "e2e-admin"
ADMIN_PASSWORD = "e2e-admin-password-1"
USER_PASSWORD = "e2e-user-password-1"
NEW_PASSWORD = "e2e-reset-password-1"

PRODUCT_ID = "11111111-1111-4111-8111-111111111111"

TABLES = (
    "outbox",
    "technical_events",
    "command_records",
    "casbin_rule",
    "user_events",
    "delegation_grants",
    "user_scopes",
    "users",
    "laboratories",
    "territories",
)


def mk_user(login: str, name: str, role: UserRole, active: bool = True) -> User:
    return User(
        login=login,
        full_name=name,
        email=f"{login}@e2e.test",
        password_hash=hash_password(USER_PASSWORD),
        role=role,
        active=active,
    )


async def main() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        for table in TABLES:
            await conn.execute(text(f'TRUNCATE TABLE "{table}" CASCADE'))
    await engine.dispose()

    async with get_session_factory()() as db:
        await run_bootstrap(
            db,
            login=ADMIN_LOGIN,
            full_name="Администратор Электронной лаборатории",
            email="e2e-admin@e2e.test",
            password=ADMIN_PASSWORD,
            confirmation=ADMIN_PASSWORD,
            delegation_territory="Республика Татарстан",
        )

        # run_bootstrap already created the root territory; reuse it.
        root = (
            await db.execute(
                select(Territory).where(Territory.name == "Республика Татарстан", Territory.parent_id.is_(None))
            )
        ).scalar_one()
        district = Territory(name="Е2Е район", parent_id=root.id)
        db.add(district)
        await db.flush()

        lab_a = Laboratory(
            territory_id=district.id,
            name="Е2Е лаборатория А",
            address="г. Е2Е, 1",
            organization="Е2Е",
        )
        lab_b = Laboratory(
            territory_id=district.id,
            name="Е2Е лаборатория Б",
            address="г. Е2Е, 2",
            organization="Е2Е",
        )
        db.add_all([lab_a, lab_b])
        await db.flush()

        vet = mk_user("e2e-vet", "Врач Е2Е Ветеринарный", UserRole.VET)
        head = mk_user("e2e-head", "Заведующий Е2Е Главный", UserRole.HEAD)
        analyst = mk_user("e2e-analyst", "Аналитик Е2Е Аналитикович", UserRole.ANALYST)
        blocked = mk_user("e2e-blocked", "Заблокирован Е2Е", UserRole.VET, active=False)
        linked = mk_user("e2e-linked", "Связанный Е2Е Связанный", UserRole.VET)
        db.add_all([vet, head, analyst, blocked, linked])
        await db.flush()

        db.add_all(
            [
                UserScope(user_id=vet.id, laboratory_id=lab_a.id, product_scope_id=uuid.UUID(PRODUCT_ID)),
                UserScope(user_id=head.id, laboratory_id=lab_a.id, product_scope_id=lab_a.id),
                UserScope(user_id=analyst.id, laboratory_id=lab_a.id, product_scope_id=lab_a.id),
                UserScope(user_id=analyst.id, laboratory_id=lab_b.id, product_scope_id=lab_b.id),
                UserScope(user_id=blocked.id, laboratory_id=lab_a.id, product_scope_id=uuid.UUID(PRODUCT_ID)),
                UserScope(user_id=linked.id, laboratory_id=lab_a.id, product_scope_id=uuid.UUID(PRODUCT_ID)),
                # A record authored by the linked user: delete must answer 409
                # USER_HAS_REFERENCES (AT-24) while blocking stays possible.
                UserEvent(
                    target_user_id=linked.id,
                    actor_id=linked.id,
                    at=datetime.now(UTC),
                    action="seed",
                    changed_fields={"source": "e2e"},
                ),
            ]
        )
        await db.commit()

    out = Path(__file__).resolve().parent / "identity-seed.local.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "admin": {"login": ADMIN_LOGIN, "password": ADMIN_PASSWORD},
                "userPassword": USER_PASSWORD,
                "newPassword": NEW_PASSWORD,
                "users": {
                    "vet": "e2e-vet",
                    "head": "e2e-head",
                    "analyst": "e2e-analyst",
                    "blocked": "e2e-blocked",
                    "linked": "e2e-linked",
                },
                "labAId": str(lab_a.id),
                "labBId": str(lab_b.id),
                "productId": PRODUCT_ID,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"seeded: {out}")


if __name__ == "__main__":
    os_imports.environ.setdefault("SESSION_COOKIE_SECURE", "false")
    asyncio.run(main())
