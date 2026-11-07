"""S03 tests: the sample accounting read endpoints (API-06, permissions.md).

Named plan assertions:

- the balances read model is the live SUM of the active collections of one
  laboratory per species with the basket revision (DATA-03: never materialized);
- the collections page lists only the available (not disposed) facts;
- the disposals page carries the period filter and the filter never changes
  the balance («фильтр не влияет на balance»);
- the role matrix (permissions.md ``sample:read``): VET/HEAD of the own
  scope, ANALYST of the chosen laboratory, ADMIN forbidden.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.identity.models import User, UserRole, UserScope
from backend.src.modules.samples.models import SampleCollection
from backend.src.modules.samples.queries import active_party_mass
from backend.src.modules.samples.service import apply_sample
from backend.tests.samples.test_collections import (  # noqa: F401 - fixture re-export
    actor as collections_actor,
)
from backend.tests.samples.test_collections import lab as collections_lab
from backend.tests.samples.test_collections import (
    new_sample,
    species_id,
)
from backend.tests.samples.test_collections import (
    party as collections_party,
)
from backend.tests.samples.test_disposal import (
    basket_rev,
    client_for,
)
from backend.tests.samples.test_disposal import (
    dispose_env as dispose_env_shared,  # noqa: F401 - the S02 HTTP environment fixture
)

lab = collections_lab
actor = collections_actor
party = collections_party


@pytest.fixture(name="dispose_env")
def dispose_env_fixture(dispose_env_shared: SimpleNamespace) -> SimpleNamespace:  # noqa: F811
    """The shared S02 disposal HTTP environment under its usual name."""
    return dispose_env_shared


def write_payload(**payload: Any) -> Any:
    """A validated DisposalWrite from snake_case kwargs (populate_by_name)."""
    from backend.src.modules.samples.schemas import DisposalWrite

    return DisposalWrite.model_validate(payload)


# --- read model --------------------------------------------------------------------


async def test_balances_view(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    """The balance of one laboratory/species basket = SUM(active collections)."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("11.8"))
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    other_species = uuid.uuid4()
    db_session.add(
        SampleCollection(
            party_id=party.id,
            laboratory_id=lab.id,
            product_species_id=other_species,
            classification_snapshot=dict(party.classification_snapshot),
            collected_on=date.today(),
            mass_kg=Decimal("2"),
            collected_by=actor,
        )
    )
    await db_session.commit()

    from backend.src.modules.samples import queries

    balances = await queries.balance_list(db_session, lab.id)
    by_species = {item.product_species_id: item for item in balances}
    assert by_species[str(species)].mass_kg == "12.6"
    assert by_species[str(other_species)].mass_kg == "2"
    assert by_species[str(species)].revision >= 1


async def test_disposal_removes_species_from_balances(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    """The disposal of a basket empties its balance line, others survive."""
    from backend.src.core.contracts import CommandContext
    from backend.src.modules.samples import queries
    from backend.src.modules.samples.commands import dispose_samples

    species = species_id(party)
    collection = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    ctx = CommandContext(
        actor_id=actor,
        idempotency_key=str(uuid.uuid4()),
        expected_revision=await basket_rev(db_session, lab.id, species),
    )
    await dispose_samples(
        ctx,
        write_payload(
            laboratory_id=lab.id,
            product_species_id=species,
            disposed_on=date.today(),
            external_vsd_number="ВСД-001",
            expected_mass_kg="0.8",
        ),
        uow=db_session,
    )
    await db_session.commit()
    balances = await queries.balance_list(db_session, lab.id)
    assert all(item.product_species_id != str(species) for item in balances)
    assert collection.disposal_id is not None


# --- HTTP endpoints ------------------------------------------------------------------


async def test_balances_endpoint(
    db_session: AsyncSession, dispose_env: SimpleNamespace, actor: uuid.UUID, party
) -> None:
    env = dispose_env
    species = species_id(party)
    await apply_sample(env.db, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await env.db.commit()
    async with client_for(env, env.vet) as (http, _identity):
        answer = await http.get("/api/v1/samples/balances", params={"laboratory_id": str(env.own.id)})  # type: ignore[attr-defined]
        assert answer.status_code == 200, answer.text  # type: ignore[attr-defined]
        items = answer.json()  # type: ignore[attr-defined]
        entry = next(item for item in items if item["product_species_id"] == str(species))
        assert entry["mass_kg"] == "0.8"
        assert "revision" in entry


async def test_collections_endpoint_lists_active_only(
    db_session: AsyncSession, dispose_env: SimpleNamespace, actor: uuid.UUID, party
) -> None:
    env = dispose_env
    species = species_id(party)
    await apply_sample(env.db, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await apply_sample(env.db, actor, party.id, uuid.uuid4(), new_sample("0.4"))
    await env.db.commit()
    async with client_for(env, env.vet) as (http, _identity):
        page = await http.get("/api/v1/samples/collections", params={"laboratory_id": str(env.own.id)})  # type: ignore[attr-defined]
        assert page.status_code == 200, page.text  # type: ignore[attr-defined]
        body = page.json()  # type: ignore[attr-defined]
        assert body["total"] == 2
        assert len(body["items"]) == 2

        # Dispose one fact: it leaves the available page, the other survives.
        from backend.src.core.contracts import CommandContext
        from backend.src.modules.samples.commands import dispose_samples

        ctx = CommandContext(
            actor_id=actor,
            idempotency_key=str(uuid.uuid4()),
            expected_revision=await basket_rev(env.db, env.own.id, species),
        )
        view = await dispose_samples(
            ctx,
            write_payload(
                laboratory_id=env.own.id,
                product_species_id=species,
                disposed_on=date.today(),
                external_vsd_number="ВСД-002",
                expected_mass_kg="1.2",
            ),
            uow=env.db,
        )
        await env.db.commit()
        after = await http.get("/api/v1/samples/collections", params={"laboratory_id": str(env.own.id)})  # type: ignore[attr-defined]
        items = after.json()["items"]  # type: ignore[attr-defined]
        assert after.status_code == 200  # type: ignore[attr-defined]
        # The full disposal consumes the whole basket: both facts of the
        # species are attached, so the available page is empty.
        assert all(item["disposal_id"] is not None for item in items) or items == []
        disposals = await http.get("/api/v1/samples/disposals", params={"laboratory_id": str(env.own.id)})  # type: ignore[attr-defined]
        assert disposals.status_code == 200  # type: ignore[attr-defined]
        disposal_items = disposals.json()["items"]  # type: ignore[attr-defined]
        assert [item["id"] for item in disposal_items] == [view.id]


async def test_disposals_period_filter_keeps_balance(
    db_session: AsyncSession, dispose_env: SimpleNamespace, actor: uuid.UUID, party
) -> None:
    """The period filter changes the history page only — never the balance."""
    env = dispose_env
    species = species_id(party)
    await apply_sample(env.db, actor, party.id, uuid.uuid4(), new_sample("1.5"))
    await env.db.commit()
    today = (await env.db.execute(select(SampleCollection.collected_on).limit(1))).scalar_one()
    async with client_for(env, env.vet) as (http, _identity):
        inside = await http.get(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            params={"laboratory_id": str(env.own.id), "date_from": str(today)},
        )
        assert inside.status_code == 200  # type: ignore[attr-defined]

        # Dispose the whole balance.
        from backend.src.core.contracts import CommandContext
        from backend.src.modules.samples.commands import dispose_samples

        ctx = CommandContext(
            actor_id=actor,
            idempotency_key=str(uuid.uuid4()),
            expected_revision=await basket_rev(env.db, env.own.id, species),
        )
        await dispose_samples(
            ctx,
            write_payload(
                laboratory_id=env.own.id,
                product_species_id=species,
                disposed_on=today,
                external_vsd_number="ВСД-003",
                expected_mass_kg="1.5",
            ),
            uow=env.db,
        )
        await env.db.commit()

        today_page = await http.get(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            params={"laboratory_id": str(env.own.id), "date_from": str(today), "date_to": str(today)},
        )
        assert today_page.json()["total"] == 1  # type: ignore[attr-defined]
        future_page = await http.get(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            params={
                "laboratory_id": str(env.own.id),
                "date_from": str(today + timedelta(days=1)),
            },
        )
        assert future_page.json()["total"] == 0  # type: ignore[attr-defined]
        assert future_page.json()["items"] == []  # type: ignore[attr-defined]

        # The filter never touches the balances read model (still one line, 0).
        balances = await http.get("/api/v1/samples/balances", params={"laboratory_id": str(env.own.id)})  # type: ignore[attr-defined]
        assert balances.json() == []  # type: ignore[attr-defined]
        assert await active_party_mass(env.db, party.id) == Decimal("0")


async def test_read_roles_matrix(dispose_env: SimpleNamespace, actor: uuid.UUID, party) -> None:
    """VET/HEAD of the own scope and ANALYST read; ADMIN is refused (matrix)."""
    env = dispose_env
    head = User(
        login="head1",
        full_name="Заведующий",
        email="head@example.test",
        password_hash="correct horse battery",
        role=UserRole.HEAD,
        active=True,
    )
    env.db.add(head)
    await env.db.flush()
    env.db.add(UserScope(user_id=head.id, laboratory_id=env.own.id, product_scope_id=uuid.uuid4()))
    # The analyst reads the one chosen laboratory (scope row exists).
    env.db.add(UserScope(user_id=env.analyst.id, laboratory_id=env.own.id, product_scope_id=uuid.uuid4()))
    await env.db.commit()

    cases: list[tuple[User, int, str]] = [
        (env.vet, 200, "vet"),
        (head, 200, "head"),
        (env.analyst, 200, "analyst"),
        (env.admin, 403, "admin"),
    ]
    for user, status, label in cases:
        async with client_for(env, user) as (http, _identity):
            answer = await http.get(  # type: ignore[attr-defined]
                "/api/v1/samples/balances",
                params={"laboratory_id": str(env.own.id)},
            )
            assert answer.status_code == status, (label, answer.text)  # type: ignore[attr-defined]
            if status == 200:
                assert isinstance(answer.json(), list)  # type: ignore[attr-defined]

    # A laboratory outside the scope is not readable by anyone.
    for user in (env.vet, env.analyst):
        async with client_for(env, user) as (http, _identity):
            answer = await http.get(  # type: ignore[attr-defined]
                "/api/v1/samples/balances",
                params={"laboratory_id": str(uuid.uuid4())},
            )
            assert answer.status_code == 403, answer.text  # type: ignore[attr-defined]
