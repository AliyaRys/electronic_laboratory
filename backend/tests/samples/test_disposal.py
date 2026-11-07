"""S02 tests: the atomic full-disposal command (API-06, FT-SMP-06/07, AT-11).

Named plan assertions (controller decisions):

- ``test_dispose_all`` — 12.6 → balance 0, one event carrying the mass 12.6,
  other species of the same laboratory unaffected;
- ``test_stale_dialog_after_new_collection`` — a new collection between the
  dialog opening and the confirmation → 409, nothing changed (stale revision
  and stale shown mass both conflict);
- ``test_parallel_disposals`` — two concurrent dispose commands → exactly one
  disposal, the loser answers 409;
- ``test_disposal_date`` — a date earlier than max ``collected_on`` → 422
  (FT «утилизация не может предшествовать включённым отборам»), a future date
  → 422 (R-06), the day of the latest collection is allowed;
- ``test_no_disposal_mutation_routes`` — PUT/DELETE on the disposal endpoint
  → 405/404: the disposal is create-once, there are no mutation routes
  (O-07, sample:disposal-update/delete denied for every role).

Plus the API-06 contract: Idempotency-Key + If-Match of the basket required,
the server (never the client) computes the stored mass, the replay of the same
key records exactly one event, a NEW after the disposal leaves a positive
balance, and ANALYST/ADMIN are refused through the API.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.contracts import CommandContext
from backend.src.core.database import async_session
from backend.src.core.problems import ProblemError
from backend.src.modules.identity.authz import Authorizer, InMemoryDecisionEngine, get_authorizer
from backend.src.modules.identity.models import TechnicalEvent, User, UserRole, UserScope
from backend.src.modules.identity.session import SessionTransport, get_session_transport
from backend.src.modules.samples.commands import dispose_samples, load_disposal_view
from backend.src.modules.samples.models import SampleCollection, SampleDisposal
from backend.src.modules.samples.queries import active_party_mass
from backend.src.modules.samples.schemas import DisposalWrite
from backend.src.modules.samples.service import apply_sample
from backend.tests.identity.test_sessions import MemoryRedis, TestClock
from backend.tests.samples.test_collections import (  # noqa: F401 - fixture re-export
    actor as collections_actor,
)
from backend.tests.samples.test_collections import (
    lab as collections_lab,
)
from backend.tests.samples.test_collections import (
    new_sample,
    species_id,
)
from backend.tests.samples.test_collections import (
    other_session as collections_other_session,
)
from backend.tests.samples.test_collections import (
    party as collections_party,
)

# Fixture re-exports (the pattern of test_reconciliation): the shared S01
# fixtures stay single-source while remaining resolvable by their names here.
lab = collections_lab
actor = collections_actor
party = collections_party
other_session = collections_other_session

# TechnicalEvent is imported from identity.models above.

PLAYER = "correct horse battery"


def _today() -> date:
    from backend.src.core.clock import moscow_date, utcnow

    return moscow_date(utcnow())


def disposal_write(
    lab_id: uuid.UUID,
    species: uuid.UUID,
    expected_mass: str,
    disposed_on: date | None = None,
    number: str = "ВСД-001",
    **overrides: Any,
) -> DisposalWrite:
    payload: dict[str, Any] = {
        "laboratoryId": str(lab_id),
        "productSpeciesId": str(species),
        "disposedOn": (disposed_on or _today()).isoformat(),
        "externalVsdNumber": number,
        "expectedMassKg": expected_mass,
    }
    payload.update(overrides)
    return DisposalWrite.model_validate(payload)


async def basket_rev(db: AsyncSession, lab_id: uuid.UUID, species: uuid.UUID) -> int:
    from backend.src.modules.samples.models import SampleBasket

    rev = (
        await db.execute(
            select(SampleBasket.rev).where(
                SampleBasket.laboratory_id == lab_id, SampleBasket.product_species_id == species
            )
        )
    ).scalar_one()
    return int(rev)


def disposal_count() -> Any:
    return select(func.count()).select_from(SampleDisposal)


def dispose_events() -> Any:
    return select(TechnicalEvent).where(TechnicalEvent.action == "sample:dispose")


# --- HTTP environment -------------------------------------------------------------


@asynccontextmanager
async def client_for(env: SimpleNamespace, user: User | None = None):
    from backend.src.interfaces.main import app

    factory = async_sessionmaker(env.engine, class_=AsyncSession, expire_on_commit=False)

    async def request_session():
        async with factory() as session:
            yield session

    app.dependency_overrides[async_session] = request_session
    app.dependency_overrides[get_session_transport] = lambda: env.transport
    app.dependency_overrides[get_authorizer] = lambda: env.authorizer
    try:
        identity = await env.transport.create((user or env.vet).id)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            http.cookies.set(SessionTransport.COOKIE_NAME, identity.session_id)
            http.cookies.set(SessionTransport.CSRF_COOKIE_NAME, identity.csrf_token)
            yield http, identity
    finally:
        app.dependency_overrides.pop(async_session, None)
        app.dependency_overrides.pop(get_session_transport, None)
        app.dependency_overrides.pop(get_authorizer, None)


@pytest.fixture
async def dispose_env(db_session: AsyncSession, test_db_engine, lab, actor: uuid.UUID) -> SimpleNamespace:
    transport = SessionTransport(MemoryRedis(), clock=TestClock(), prefix="disposal")
    vet = (await db_session.execute(select(User).where(User.id == actor))).scalar_one()
    analyst = User(
        login="analyst1",
        full_name="Аналитик",
        email="analyst@example.test",
        password_hash=PLAYER,
        role=UserRole.ANALYST,
        active=True,
    )
    admin = User(
        login="admin1",
        full_name="Администратор",
        email="admin@example.test",
        password_hash=PLAYER,
        role=UserRole.ADMIN,
        active=True,
    )
    db_session.add_all([analyst, admin])
    db_session.add(UserScope(user_id=vet.id, laboratory_id=lab.id, product_scope_id=uuid.uuid4()))
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        engine=test_db_engine,
        transport=transport,
        authorizer=Authorizer(InMemoryDecisionEngine()),
        own=lab,
        vet=vet,
        analyst=analyst,
        admin=admin,
    )


def disposal_body(
    lab_id: uuid.UUID,
    species: uuid.UUID,
    expected_mass: str,
    disposed_on: date | None = None,
) -> dict[str, Any]:
    return {
        "laboratoryId": str(lab_id),
        "productSpeciesId": str(species),
        "disposedOn": (disposed_on or _today()).isoformat(),
        "externalVsdNumber": "ВСД-001",
        "expectedMassKg": expected_mass,
    }


# --- named assertion: full disposal of the whole balance ---------------------------


async def test_dispose_all(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    """12.6 → 0: the whole balance is disposed exactly once, the event carries
    the server-computed mass, and another species is untouched."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("11.8"))
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()

    # Another species of the same laboratory keeps its own positive balance.
    other_species = uuid.uuid4()
    db_session.add(
        SampleCollection(
            party_id=party.id,
            laboratory_id=lab.id,
            product_species_id=other_species,
            classification_snapshot=dict(party.classification_snapshot),
            collected_on=_today(),
            mass_kg=Decimal("2"),
            collected_by=actor,
        )
    )
    await db_session.commit()

    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    view = await dispose_samples(ctx, disposal_write(lab.id, species, "12.6"), uow=db_session)
    await db_session.commit()

    assert view.mass_kg == "12.6"
    assert view.product_species_id == str(species)
    assert view.external_vsd_number == "ВСД-001"

    row = (await db_session.execute(select(SampleDisposal))).scalar_one()
    assert row.mass_kg == Decimal("12.6")
    assert row.disposed_on == _today()

    # Every collection of the species is attached; the balance is exactly 0.
    masses = (
        (
            await db_session.execute(
                select(SampleCollection.mass_kg).where(SampleCollection.product_species_id == species)
            )
        )
        .scalars()
        .all()
    )
    assert sum(masses, Decimal("0")) == Decimal("12.6")
    attached = (
        (
            await db_session.execute(
                select(SampleCollection.disposal_id).where(SampleCollection.product_species_id == species)
            )
        )
        .scalars()
        .all()
    )
    assert all(item == row.id for item in attached)
    assert await active_party_mass(db_session, party.id) == Decimal("2.0")

    # The other species keeps its fact and its balance.
    other = (
        await db_session.execute(select(SampleCollection).where(SampleCollection.product_species_id == other_species))
    ).scalar_one()
    assert other.disposal_id is None
    assert other.mass_kg == Decimal("2")

    # One event, carrying the actual mass.
    events = (await db_session.execute(dispose_events())).scalars().all()
    assert len(events) == 1
    assert events[0].result == "12.6"
    assert events[0].object_uuid == row.id


# --- named assertion: the stale dialog conflicts -----------------------------------


@pytest.mark.parametrize("stale", ["revision", "mass"])
async def test_stale_dialog_after_new_collection(
    db_session: AsyncSession, lab, actor: uuid.UUID, party, stale: str
) -> None:
    """A collection added after the dialog opened makes the old confirmation a
    409; nothing is disposed and the balance keeps both collections."""
    species = species_id(party)
    party_id = party.id
    await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    dialog_rev = await basket_rev(db_session, lab.id, species)

    # The competitor wins the race while the dialog is open.
    await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.5"))
    await db_session.commit()

    expected_mass = "0.8" if stale == "mass" else "1.3"
    expected_revision = dialog_rev if stale == "revision" else await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=expected_revision)
    with pytest.raises(ProblemError) as raised:
        await dispose_samples(ctx, disposal_write(lab.id, species, expected_mass), uow=db_session)
    assert raised.value.status == 409
    assert raised.value.code == "REVISION_CONFLICT"
    await db_session.rollback()

    assert (await db_session.execute(disposal_count())).scalar_one() == 0
    assert await active_party_mass(db_session, party_id) == Decimal("1.3")


# --- named assertion: two concurrent disposals → exactly one -----------------------


async def test_parallel_disposals(
    db_session: AsyncSession, other_session: AsyncSession, lab, actor: uuid.UUID, party
) -> None:
    """Two concurrent dispose commands serialize on the basket lock: exactly
    one disposal exists and the loser answers 409."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)

    ctx_a = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    ctx_b = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    payload = disposal_write(lab.id, species, "1.6")

    # A takes the basket lock inside its open transaction FIRST; B blocks on it.
    task_a = asyncio.create_task(dispose_samples(ctx_a, payload, uow=db_session))
    task_b = asyncio.create_task(dispose_samples(ctx_b, payload, uow=other_session))
    done, pending = await asyncio.wait({task_a, task_b}, return_when=asyncio.FIRST_COMPLETED)
    assert task_a in done and pending == {task_b}
    await db_session.commit()  # release the locks; B proceeds against rev+1
    with pytest.raises(ProblemError) as raised:
        await task_b
    assert raised.value.status == 409
    assert raised.value.code == "REVISION_CONFLICT"
    await other_session.rollback()

    disposals = (await db_session.execute(select(SampleDisposal))).scalars().all()
    assert len(disposals) == 1
    assert disposals[0].mass_kg == Decimal("1.6")
    events = (await db_session.execute(dispose_events())).scalars().all()
    assert len(events) == 1


# --- named assertion: disposal date rules ------------------------------------------


@pytest.mark.parametrize(
    ("offset_days", "expected_status"),
    [
        (0, None),  # the day of the latest collection is allowed
        (-1, 422),  # earlier than max collected_on → 422
        (1, 422),  # future → 422
    ],
)
async def test_disposal_date(
    db_session: AsyncSession, lab, actor: uuid.UUID, party, offset_days: int, expected_status: int | None
) -> None:
    species = species_id(party)
    party_id = party.id
    yesterday = _today() - timedelta(days=1)
    await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.8", collected_on=yesterday))
    await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.5"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)

    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    payload = disposal_write(lab.id, species, "1.3", disposed_on=_today() + timedelta(days=offset_days))
    if expected_status is None:
        view = await dispose_samples(ctx, payload, uow=db_session)
        await db_session.commit()
        assert view.mass_kg == "1.3"
        assert view.disposed_on == _today()
        assert await active_party_mass(db_session, party.id) == Decimal("0")
    else:
        with pytest.raises(ProblemError) as raised:
            await dispose_samples(ctx, payload, uow=db_session)
        assert raised.value.status == expected_status
        await db_session.rollback()
        assert (await db_session.execute(disposal_count())).scalar_one() == 0
        assert await active_party_mass(db_session, party_id) == Decimal("1.3")


# --- named assertion: no mutation routes for the disposal --------------------------


async def test_no_disposal_mutation_routes(dispose_env: SimpleNamespace) -> None:
    """The disposal is create-once (O-07): PUT/DELETE meet 405 on the collection
    route and 404 on the never-existing item routes."""
    async with client_for(dispose_env) as (http, identity):  # type: ignore[operator]
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
        }
        put = await http.put("/api/v1/samples/disposals", json={}, headers=headers)  # type: ignore[attr-defined]
        assert put.status_code == 405  # type: ignore[attr-defined]
        delete = await http.delete("/api/v1/samples/disposals", headers=headers)  # type: ignore[attr-defined]
        assert delete.status_code == 405  # type: ignore[attr-defined]
        put_item = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/samples/disposals/{uuid.uuid4()}", json={}, headers=headers
        )
        assert put_item.status_code == 404  # type: ignore[attr-defined]
        delete_item = await http.delete(  # type: ignore[attr-defined]
            f"/api/v1/samples/disposals/{uuid.uuid4()}", headers=headers
        )
        assert delete_item.status_code == 404  # type: ignore[attr-defined]


# --- API-06 contract: guards, replay, prohibitions ---------------------------------


async def test_disposal_api_endpoint(
    db_session: AsyncSession, dispose_env: SimpleNamespace, actor: uuid.UUID, party
) -> None:
    """POST /samples/disposals: Idempotency-Key + If-Match required; the stored
    mass is server-computed even when the shown mass was wrong."""
    env = dispose_env
    species = species_id(party)
    await apply_sample(env.db, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await apply_sample(env.db, actor, party.id, uuid.uuid4(), new_sample("0.4"))
    await env.db.commit()
    rev = await basket_rev(env.db, env.own.id, species)
    base_headers = {
        "x-csrf-token": "",
        "origin": "http://test",
        "idempotency-key": str(uuid.uuid4()),
        "if-match": f'"{rev}"',
    }

    async with client_for(env) as (http, identity):
        base_headers["x-csrf-token"] = identity.csrf_token

        no_key = await http.post(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            json=disposal_body(env.own.id, species, "1.2"),
            headers={k: v for k, v in base_headers.items() if k != "idempotency-key"},
        )
        assert no_key.status_code == 422  # type: ignore[attr-defined]
        assert no_key.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED"  # type: ignore[attr-defined]

        no_match = await http.post(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            json=disposal_body(env.own.id, species, "1.2"),
            headers={k: v for k, v in base_headers.items() if k != "if-match"},
        )
        assert no_match.status_code == 422  # type: ignore[attr-defined]
        assert no_match.json()["code"] == "REVISION_REQUIRED"  # type: ignore[attr-defined]

        # A wrong shown mass is only a guard: it conflicts with 409 and
        # nothing is stored.
        wrong_shown = await http.post(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            json=disposal_body(env.own.id, species, "9.9"),
            headers={**base_headers, "idempotency-key": str(uuid.uuid4())},
        )
        assert wrong_shown.status_code == 409, wrong_shown.text  # type: ignore[attr-defined]
        assert wrong_shown.json()["code"] == "REVISION_CONFLICT"  # type: ignore[attr-defined]

        # The correct confirmation stores the server-computed mass (1.2).
        created = await http.post(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            json=disposal_body(env.own.id, species, "1.2"),
            headers={**base_headers, "idempotency-key": str(uuid.uuid4())},
        )
        assert created.status_code == 201, created.text  # type: ignore[attr-defined]
        view = created.json()  # type: ignore[attr-defined]
        assert view["mass_kg"] == "1.2"  # type: ignore[attr-defined]
        assert view["external_vsd_number"] == "ВСД-001"  # type: ignore[attr-defined]

        await env.db.commit()
        # One disposal, one event; the balance is 0.
        assert (await env.db.execute(disposal_count())).scalar_one() == 1
        events = (await env.db.execute(dispose_events())).scalars().all()
        assert len(events) == 1
        assert await active_party_mass(env.db, party.id) == Decimal("0")


async def test_replay_same_key_one_event(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    """A timeout after commit + the replay of the same key answers the saved
    disposal and never records a second event."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key="same-key", expected_revision=rev)
    first = await dispose_samples(ctx, disposal_write(lab.id, species, "0.8"), uow=db_session)
    await db_session.commit()

    replay_ctx = CommandContext(actor_id=actor, idempotency_key="same-key", expected_revision=rev)
    replayed = await dispose_samples(replay_ctx, disposal_write(lab.id, species, "0.8"), uow=db_session)
    await db_session.commit()

    assert replayed.id == first.id
    assert (await db_session.execute(disposal_count())).scalar_one() == 1
    events = (await db_session.execute(dispose_events())).scalars().all()
    assert len(events) == 1


async def test_replay_different_payload_is_mismatch(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key="same-key", expected_revision=rev)
    await dispose_samples(ctx, disposal_write(lab.id, species, "0.8"), uow=db_session)
    await db_session.commit()

    replay_ctx = CommandContext(actor_id=actor, idempotency_key="same-key", expected_revision=rev)
    with pytest.raises(ProblemError) as raised:
        await dispose_samples(replay_ctx, disposal_write(lab.id, species, "0.8", number="ВСД-002"), uow=db_session)
    assert raised.value.status == 409
    assert raised.value.code == "IDEMPOTENCY_MISMATCH"
    await db_session.rollback()


async def test_new_collection_after_disposal_positive_balance(
    db_session: AsyncSession, lab, actor: uuid.UUID, party
) -> None:
    """The disposal froze only the locked set: a NEW afterwards gets its own
    positive balance and is never attached to the finished disposal."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    await dispose_samples(ctx, disposal_write(lab.id, species, "0.8"), uow=db_session)
    await db_session.commit()

    fresh = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.5"))
    await db_session.commit()

    assert await active_party_mass(db_session, party.id) == Decimal("0.5")
    assert fresh.disposal_id is None


async def test_zero_balance_rejected(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    """There is nothing to dispose: no zero/partial disposal is ever stored."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    await dispose_samples(ctx, disposal_write(lab.id, species, "0.8"), uow=db_session)
    await db_session.commit()

    replay_rev = await basket_rev(db_session, lab.id, species)
    empty_ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=replay_rev)
    with pytest.raises(ProblemError) as raised:
        await dispose_samples(empty_ctx, disposal_write(lab.id, species, "0"), uow=db_session)
    assert raised.value.status == 422
    await db_session.rollback()
    assert (await db_session.execute(disposal_count())).scalar_one() == 1


@pytest.mark.parametrize("number", ["", "   "])
async def test_blank_external_number_rejected(
    db_session: AsyncSession, lab, actor: uuid.UUID, party, number: str
) -> None:
    """FT-SMP-06: the outgoing eVSD number is mandatory and nonblank."""
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    with pytest.raises(ProblemError) as raised:
        await dispose_samples(ctx, disposal_write(lab.id, species, "0.8", number=number), uow=db_session)
    assert raised.value.status == 422
    await db_session.rollback()
    assert (await db_session.execute(disposal_count())).scalar_one() == 0


async def test_analyst_and_admin_cannot_dispose(dispose_env: SimpleNamespace, party) -> None:
    """permissions.md: sample:dispose is VET/HEAD only — ANALYST and ADMIN are
    refused through the API itself."""
    env = dispose_env
    species = species_id(party)
    body = disposal_body(env.own.id, species, "0.8")
    headers = {
        "origin": "http://test",
        "idempotency-key": str(uuid.uuid4()),
        "if-match": '"1"',
    }
    async with client_for(env, env.analyst) as (http, identity):
        response = await http.post(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            json=body,
            headers={**headers, "x-csrf-token": identity.csrf_token},
        )
        assert response.status_code == 403  # type: ignore[attr-defined]
        assert response.json()["code"] == "ACCESS_DENIED"  # type: ignore[attr-defined]
    async with client_for(env, env.admin) as (http, identity):
        response = await http.post(  # type: ignore[attr-defined]
            "/api/v1/samples/disposals",
            json=body,
            headers={**headers, "x-csrf-token": identity.csrf_token},
        )
        assert response.status_code == 403  # type: ignore[attr-defined]
        assert response.json()["code"] == "ACCESS_DENIED"  # type: ignore[attr-defined]


async def test_load_disposal_view_roundtrip(db_session: AsyncSession, lab, actor: uuid.UUID, party) -> None:
    species = species_id(party)
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    rev = await basket_rev(db_session, lab.id, species)
    ctx = CommandContext(actor_id=actor, idempotency_key=str(uuid.uuid4()), expected_revision=rev)
    created = await dispose_samples(ctx, disposal_write(lab.id, species, "0.8"), uow=db_session)
    await db_session.commit()

    loaded = await load_disposal_view(db_session, uuid.UUID(created.id))
    assert loaded == created
