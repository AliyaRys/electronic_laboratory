"""S01 tests: the independent physical sample collection contract (DATA-03, FT-SMP-01..04).

Named plan assertions (Review Focus / controller decisions):

- ``test_new_sample_creates_collection_and_balance`` — NEW 0.8 → the party
  balance is 0.8 and the collection carries its own snapshot/author/date;
- ``test_repeat_command_and_reuse_no_double_count`` — a re-saved card reuses
  the same physical fact (REUSE): the balance stays 0.8, there is still exactly
  one collection row and its original date is never replaced by the new
  card's date;
- ``test_edit_replaces_mass_delta_once`` — EDIT 0.8→0.6 is a correction of the
  same fact: the balance becomes 0.6 (delta −0.2), the row identity survives;
- ``test_edit_revision_conflict`` — an EDIT against a stale expected_revision
  is a 409 REVISION_CONFLICT and changes nothing;
- ``test_explicit_new_adds_second_collection`` — an explicit NEW after a
  correction adds its own weight (0.6 + 0.5 = 1.1) and never deletes the old
  collection;
- ``test_disposed_reuse_and_edit_rejected`` — REUSE/EDIT on a disposed fact is
  409 SAMPLE_DISPOSED; the disposed fact is immutable;
- ``test_coordinator_rollback_leaves_nothing`` — the service never commits on
  its own: a coordinator rollback leaves neither a collection nor a balance
  increase;
- ``test_future_date_rejected`` — a collection dated in the future is 422;
- ``test_scale_over_six_rejected_without_rounding`` — more than six decimal
  places is an error, never a silent rounding;
- ``test_concurrent_new_and_edit_serialize`` — two PostgreSQL sessions serialize
  on the basket/collection locks: two NEWs produce both rows and the exact sum,
  a stale EDIT loses with REVISION_CONFLICT;
- ``test_decimal_exactness_no_float`` — Decimal arithmetic end-to-end, no
  binary-float drift;
- ``test_list_available_collections_only_active`` — disposed facts disappear
  from the available list;
- ``test_detach_hook_leaves_collections`` — the prepared detach hook for
  examination deletion never cascades to collections (FT-SMP-02).

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.clock import moscow_date, utcnow
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands as arrivals_commands
from backend.src.modules.arrivals.models import Party
from backend.src.modules.identity.models import Laboratory, Territory, User, UserRole
from backend.src.modules.samples.models import SampleCollection, SampleDisposal
from backend.src.modules.samples.queries import active_party_mass, list_available_collections
from backend.src.modules.samples.schemas import CollectionView, EditSample, NewSample, ReuseSample
from backend.src.modules.samples.service import apply_sample, detach_examination_samples
from backend.tests.arrivals.test_import_and_queues import document


def _today() -> date:
    return moscow_date(utcnow())


def new_sample(mass: str, collected_on: date | None = None) -> NewSample:
    return NewSample(mode="NEW", collected_on=collected_on or _today(), massKg=mass)


def reuse_sample(collection_id: uuid.UUID) -> ReuseSample:
    return ReuseSample(mode="REUSE", collectionId=collection_id)


def edit_sample(collection_id: uuid.UUID, expected_revision: int, mass: str) -> EditSample:
    return EditSample(
        mode="EDIT",
        collectionId=collection_id,
        expectedRevision=expected_revision,
        collectedOn=_today(),
        massKg=mass,
    )


# --- fixtures ---------------------------------------------------------------------


@pytest.fixture
async def lab(db_session: AsyncSession) -> Laboratory:
    territory = Territory(name="Республика Татарстан")
    db_session.add(territory)
    await db_session.flush()
    laboratory = Laboratory(
        territory_id=territory.id, name="Лаборатория №1", address="ул. Первая, 1", organization="ГБУ"
    )
    user = User(
        login="vet1",
        full_name="Ветеринарный врач",
        email="vet@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    db_session.add(laboratory)
    db_session.add(user)
    await db_session.commit()
    return laboratory


@pytest.fixture
async def actor(db_session: AsyncSession, lab: Laboratory) -> uuid.UUID:
    return (await db_session.execute(select(User.id).where(User.login == "vet1"))).scalar_one()


@pytest.fixture
async def party(db_session: AsyncSession, lab: Laboratory) -> Party:
    """A real imported party (its classification snapshot names the species)."""
    doc = document(uuid.uuid4(), lab.id)
    imported = await arrivals_commands.upsert_incoming(db_session, doc)
    await db_session.commit()
    return imported


def species_id(party: Party) -> uuid.UUID:
    product = party.classification_snapshot["product"]
    assert isinstance(product, dict) and product["id"] is not None
    return uuid.UUID(str(product["id"]))


def collection_count():
    return select(func.count()).select_from(SampleCollection)


async def balance(db: AsyncSession, party_id: uuid.UUID) -> Decimal:
    return await active_party_mass(db, party_id)


@pytest_asyncio.fixture
async def other_session(test_db_engine) -> AsyncGenerator[AsyncSession]:
    """A second, independent PostgreSQL session (real cross-session locking)."""
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# --- named assertions ---------------------------------------------------------------


async def test_new_sample_creates_collection_and_balance(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    collection = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()

    assert collection.id is not None
    assert collection.party_id == party.id
    assert collection.laboratory_id == lab.id
    assert collection.product_species_id == species_id(party)
    assert collection.mass_kg == Decimal("0.8")
    assert collection.collected_on == _today()
    assert collection.collected_by == actor
    # The collection carries its own frozen snapshot, author and date — it is
    # an independent physical fact, not a version of the card.
    assert collection.classification_snapshot["product"] == party.classification_snapshot["product"]
    assert await balance(db_session, party.id) == Decimal("0.8")


async def test_repeat_command_and_reuse_no_double_count(
    db_session: AsyncSession, actor: uuid.UUID, party: Party
) -> None:
    first = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    first_id = first.id

    # A re-saved card of the same party links the same physical fact (REUSE):
    # no second row, no extra weight, the original date is never replaced by
    # the new card's date.
    reused = await apply_sample(
        db_session,
        actor,
        party.id,
        uuid.uuid4(),
        reuse_sample(first_id),
    )
    await db_session.commit()

    assert reused.id == first.id
    assert reused.collected_on == first.collected_on
    assert reused.rev == first.rev  # REUSE never churns the fact
    count = (await db_session.execute(collection_count())).scalar_one()
    assert count == 1
    assert await balance(db_session, party.id) == Decimal("0.8")


async def test_edit_replaces_mass_delta_once(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    first = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    first_id, first_rev = first.id, int(first.rev)

    corrected = await apply_sample(db_session, actor, party.id, uuid.uuid4(), edit_sample(first_id, first_rev, "0.6"))
    await db_session.commit()

    # The same fact corrected: identity survives, the balance becomes the new
    # value exactly once (the delta −0.2 is not subtracted again).
    assert corrected.id == first_id
    assert corrected.mass_kg == Decimal("0.6")
    assert corrected.rev == first_rev + 1
    assert await balance(db_session, party.id) == Decimal("0.6")

    repeat = await apply_sample(db_session, actor, party.id, uuid.uuid4(), reuse_sample(first_id))
    await db_session.commit()
    assert repeat.mass_kg == Decimal("0.6")
    assert await balance(db_session, party.id) == Decimal("0.6")


async def test_edit_revision_conflict(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    party_id = party.id
    first = await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()

    with pytest.raises(ProblemError) as raised:
        await apply_sample(db_session, actor, party_id, uuid.uuid4(), edit_sample(first.id, int(first.rev) + 5, "0.6"))
    assert raised.value.status == 409
    assert raised.value.code == "REVISION_CONFLICT"
    await db_session.rollback()
    assert await balance(db_session, party_id) == Decimal("0.8")


async def test_explicit_new_adds_second_collection(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.6"))
    await db_session.commit()

    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.5"))
    await db_session.commit()

    # An explicit NEW registers its own physical fact and never deletes the
    # previous collection.
    count = (await db_session.execute(collection_count())).scalar_one()
    assert count == 2
    assert await balance(db_session, party.id) == Decimal("1.1")


async def test_disposed_reuse_and_edit_rejected(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    party_id = party.id
    first = await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()
    first_id = first.id

    # Simulate the S02 disposal fact: an immutable full-disposal row attached
    # to every active collection of the species.
    disposal = SampleDisposal(
        laboratory_id=lab.id,
        product_species_id=species_id(party),
        disposed_on=_today(),
        mass_kg=Decimal("0.8"),
        external_vsd_number="ВСД-001",
        actor_id=actor,
    )
    db_session.add(disposal)
    await db_session.flush()
    row = (await db_session.execute(select(SampleCollection).where(SampleCollection.id == first_id))).scalar_one()
    row.disposal_id = disposal.id
    await db_session.commit()

    with pytest.raises(ProblemError) as reuse_error:
        await apply_sample(db_session, actor, party_id, uuid.uuid4(), reuse_sample(first_id))
    assert reuse_error.value.status == 409
    assert reuse_error.value.code == "SAMPLE_DISPOSED"

    with pytest.raises(ProblemError) as edit_error:
        await apply_sample(db_session, actor, party_id, uuid.uuid4(), edit_sample(first_id, int(row.rev), "0.5"))
    assert edit_error.value.status == 409
    assert edit_error.value.code == "SAMPLE_DISPOSED"
    await db_session.rollback()

    # The disposed fact is immutable and never counts toward the balance.
    unchanged = (await db_session.execute(select(SampleCollection).where(SampleCollection.id == first_id))).scalar_one()
    assert unchanged.mass_kg == Decimal("0.8")
    assert await balance(db_session, party_id) == Decimal("0")


async def test_coordinator_rollback_leaves_nothing(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    party_id = party.id
    await apply_sample(db_session, actor, party_id, uuid.uuid4(), new_sample("0.8"))
    await db_session.rollback()

    count = (await db_session.execute(collection_count())).scalar_one()
    assert count == 0
    assert await balance(db_session, party_id) == Decimal("0")


async def test_service_never_commits(
    db_session: AsyncSession, other_session: AsyncSession, actor: uuid.UUID, party: Party
) -> None:
    """apply_sample writes inside the coordinator's transaction only."""
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    # No commit yet: the second connection cannot see the fact.
    count = (await other_session.execute(collection_count())).scalar_one()
    assert count == 0
    await db_session.commit()
    count = (await other_session.execute(collection_count())).scalar_one()
    assert count == 1


async def test_future_date_rejected(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    tomorrow = _today() + timedelta(days=1)
    with pytest.raises(ProblemError) as raised:
        await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8", collected_on=tomorrow))
    assert raised.value.status == 422
    await db_session.rollback()
    assert (await db_session.execute(collection_count())).scalar_one() == 0


async def test_zero_and_negative_mass_rejected(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    for mass in ("0", "-0.8"):
        with pytest.raises(ProblemError) as raised:
            await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample(mass))
        assert raised.value.status == 422
    await db_session.rollback()
    assert (await db_session.execute(collection_count())).scalar_one() == 0


async def test_scale_over_six_rejected_without_rounding(
    db_session: AsyncSession, actor: uuid.UUID, party: Party
) -> None:
    with pytest.raises(ProblemError) as raised:
        await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.1234567"))
    assert raised.value.status == 422
    await db_session.rollback()
    # No silent rounding: nothing is stored.
    assert (await db_session.execute(collection_count())).scalar_one() == 0


async def test_reuse_foreign_collection_not_found(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()

    with pytest.raises(ProblemError) as raised:
        await apply_sample(
            db_session,
            actor,
            party.id,
            uuid.uuid4(),
            reuse_sample(uuid.uuid4()),
        )
    assert raised.value.status == 404
    await db_session.rollback()


async def test_concurrent_new_and_edit_serialize(
    db_session: AsyncSession,
    other_session: AsyncSession,
    actor: uuid.UUID,
    party: Party,
) -> None:
    """Two PostgreSQL sessions: NEWs serialize on the basket lock; a stale
    EDIT loses with REVISION_CONFLICT instead of a lost update."""
    exam_a, exam_b = uuid.uuid4(), uuid.uuid4()

    # Session A takes the basket/party locks inside its open transaction
    # FIRST; B's attempt then blocks on those locks until A commits.
    first = await apply_sample(db_session, actor, party.id, exam_a, new_sample("0.8"))
    task_b = asyncio.create_task(apply_sample(other_session, actor, party.id, exam_b, new_sample("0.8")))
    await db_session.commit()  # release the locks; B proceeds
    second = await task_b
    await other_session.commit()

    assert second.id != first.id
    assert await balance(other_session, party.id) == Decimal("1.6")

    first_id = first.id
    # A corrects first while holding the locks; B's expected revision (captured
    # from its own earlier read) is already stale when it finally proceeds →
    # honest 409, no lost update.
    await apply_sample(db_session, actor, party.id, exam_a, edit_sample(first_id, 1, "0.7"))
    task_edit = asyncio.create_task(
        apply_sample(other_session, actor, party.id, exam_b, edit_sample(first_id, 1, "0.5"))
    )
    await db_session.commit()
    with pytest.raises(ProblemError) as raised:
        await task_edit
    assert raised.value.status == 409
    await other_session.rollback()

    corrected = (await db_session.execute(select(SampleCollection).where(SampleCollection.id == first_id))).scalar_one()
    assert corrected.mass_kg == Decimal("0.7")
    assert await balance(db_session, party.id) == Decimal("1.5")


async def test_decimal_exactness_no_float(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    """0.1 + 0.2 must be exactly 0.3: Decimal end-to-end, never float."""
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.1"))
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.2"))
    await db_session.commit()

    total = await balance(db_session, party.id)
    assert isinstance(total, Decimal)
    assert total == Decimal("0.3")
    rows = (await db_session.execute(select(SampleCollection.mass_kg))).scalars().all()
    assert all(isinstance(mass, Decimal) for mass in rows)


async def test_list_available_collections_only_active(
    db_session: AsyncSession, lab: Laboratory, actor: uuid.UUID, party: Party
) -> None:
    first = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    second = await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.5"))
    await db_session.commit()
    first_id = first.id

    views = await list_available_collections(db_session, party.id)
    assert {view.id for view in views} == {str(first.id), str(second.id)}
    assert all(isinstance(view, CollectionView) for view in views)
    assert {view.mass_kg for view in views} == {"0.8", "0.5"}
    assert all(view.disposal_id is None for view in views)
    assert views[0].product_species_id == str(species_id(party))

    # A disposed fact leaves the available list (FT-SMP-03).
    disposal = SampleDisposal(
        laboratory_id=lab.id,
        product_species_id=species_id(party),
        disposed_on=_today(),
        mass_kg=Decimal("0.8"),
        external_vsd_number="ВСД-002",
        actor_id=actor,
    )
    db_session.add(disposal)
    await db_session.flush()
    row = (await db_session.execute(select(SampleCollection).where(SampleCollection.id == first_id))).scalar_one()
    row.disposal_id = disposal.id
    await db_session.commit()

    views = await list_available_collections(db_session, party.id)
    assert [view.id for view in views] == [str(second.id)]
    assert views[0].mass_kg == "0.5"


async def test_detach_hook_leaves_collections(db_session: AsyncSession, actor: uuid.UUID, party: Party) -> None:
    await apply_sample(db_session, actor, party.id, uuid.uuid4(), new_sample("0.8"))
    await db_session.commit()

    # The hook for examination deletion (E03) detaches only the examination
    # link — never the collection (FT-SMP-02). Until the examination_samples
    # table exists (E01) it is an explicit no-op.
    detached = await detach_examination_samples(db_session, uuid.uuid4())
    assert detached == 0
    await db_session.rollback()
    count = (await db_session.execute(collection_count())).scalar_one()
    assert count == 1
