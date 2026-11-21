"""DR45 tests: the scoped journal read model (§2).

Named controller assertions:

- the journal is its OWN scoped read model (``GET /api/v1/examinations``),
  never the arrivals result list; a plain URL (no ``status``) answers
  COMPLETED only, ``?status=WAITING`` answers the waiting cards;
- the item carries the already-resolved display values: ``evsd_uuid``,
  ``consignor_name``, ``specialist_id``/``specialist_name`` (the frozen ФИО,
  never the raw created_by), ``first_completed_at``, ``outcome``;
- ordering: COMPLETED by ``first_completed_at``, WAITING by ``created_at``,
  with the id tie-breaker; the Moscow calendar window is half-open;
- pagination: 20 rows per page, page 2 shows the NEXT rows, ``total``
  matches the filter;
- no N+1: fetching a full page runs a bounded number of statements.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.models import User, UserRole
from backend.tests.samples.test_collections import actor as actor  # noqa: F401 - fixture re-export
from backend.tests.samples.test_collections import lab as lab  # noqa: F401 - fixture re-export
from backend.tests.samples.test_disposal import client_for, dispose_env  # noqa: F401 - fixture re-export

dispose_env = dispose_env  # noqa: F811 - pytest fixture re-export under its own name


async def _party(
    db: AsyncSession,
    env: SimpleNamespace,
    *,
    consignor: str,
    evsd: uuid.UUID | None = None,
) -> Any:
    """One confirmed party with a snapshot that carries the consignor name."""
    from decimal import Decimal

    from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation

    evsd_uuid = evsd or uuid.uuid4()
    incoming = IncomingDocument(
        contour="PILOT",
        evsd_uuid=evsd_uuid,
        laboratory_id=env.own.id,
        external_status="COMPLETED",
        source_snapshot={"vdDocument": {"consignor": {"enterprise": {"name": consignor}}, "batch": {}}},
        content_hash=uuid.uuid4().hex * 2,
        fetched_at=datetime.now(UTC),
    )
    db.add(incoming)
    await db.flush()
    party = Party(
        incoming_document_id=incoming.id,
        laboratory_id=env.own.id,
        classification_snapshot={"product": {"id": str(uuid.uuid4()), "name": "продукция"}},
    )
    db.add(party)
    await db.flush()
    db.add(
        ReceiptConfirmation(
            party_id=party.id,
            operation_id=uuid.uuid4(),
            source_evsd_uuid=evsd_uuid,
            fingerprint=uuid.uuid4().hex * 2,
            evidence={},
            accepted_mass_kg=Decimal("100"),
            accepted_quantity=Decimal("4"),
            accepted_unit_id=str(uuid.uuid4()),
            returned_mass_kg=Decimal("0"),
            returned_quantity=Decimal("0"),
            classification_snapshot=dict(party.classification_snapshot),
            previous_sufficient=False,
        )
    )
    await db.flush()
    return party


async def _examination(
    db: AsyncSession,
    env: SimpleNamespace,
    party: Any,
    *,
    status: str = "COMPLETED",
    number: str = "ВСЭ-1",
    stamp: str = "Клеймо-1",
    outcome: str | None = "FIT",
    specialist: User | None = None,
    specialist_name: str | None = None,
    created_at: datetime | None = None,
    first_completed_at: datetime | None = "unset",
) -> Examination:
    row = Examination(
        party_id=party.id,
        laboratory_id=env.own.id,
        number=number,
        stamp=stamp,
        status=status,
        sent_to_lab=status == "WAITING",
        research_snapshot=[],
        findings_snapshot={"invasive": [], "noncontagious": []},
        pricing_snapshot={"lines": [], "total": "0.00", "currency": "RUB", "fair": False},
        outcome=outcome,
        direction="SALE" if outcome == "FIT" else None,
        specialist_id=specialist.id if specialist is not None else None,
        specialist_name=specialist_name,
        created_by=(specialist or env.vet).id,
        created_at=created_at or datetime(2026, 3, 1, 10, 0, 0, tzinfo=UTC),
        first_completed_at=(
            datetime(2026, 3, 1, 10, 0, 0, tzinfo=UTC)
            if first_completed_at == "unset" and status == "COMPLETED"
            else (first_completed_at if status == "COMPLETED" else None)
        ),
        rev=1,
    )
    db.add(row)
    await db.flush()
    return row


async def test_plain_url_answers_completed_only(dispose_env: SimpleNamespace) -> None:
    env = dispose_env
    waiting_party = await _party(env.db, env, consignor="Хозяйство ожидания")
    completed_party = await _party(env.db, env, consignor="Хозяйство готовое")
    await _examination(
        env.db,
        env,
        waiting_party,
        status="WAITING",
        number="ВСЭ-W",
        created_at=datetime(2026, 3, 5, 10, 0, 0, tzinfo=UTC),
    )
    await _examination(
        env.db,
        env,
        completed_party,
        number="ВСЭ-C",
        first_completed_at=datetime(2026, 3, 2, 10, 0, 0, tzinfo=UTC),
    )
    await env.db.commit()
    async with client_for(env, env.vet) as (http, _identity):
        answer = await http.get("/api/v1/examinations", params={"laboratory_id": str(env.own.id)})  # type: ignore[attr-defined]
        assert answer.status_code == 200, answer.text  # type: ignore[attr-defined]
        body = answer.json()  # type: ignore[attr-defined]
        assert all(item["status"] == "COMPLETED" for item in body["items"])
        assert [item["number"] for item in body["items"]] == ["ВСЭ-C"]
        item = body["items"][0]
        assert item["evsd_uuid"] is not None
        assert item["consignor_name"] == "Хозяйство готовое"
        assert item["specialist_id"] is not None
        assert item["specialist_name"] == env.vet.full_name
        assert item["first_completed_at"] is not None

        waiting = await http.get(  # type: ignore[attr-defined]
            "/api/v1/examinations", params={"laboratory_id": str(env.own.id), "status": "WAITING"}
        )
        assert waiting.status_code == 200  # type: ignore[attr-defined]
        assert [row["number"] for row in waiting.json()["items"]] == ["ВСЭ-W"]  # type: ignore[attr-defined]


async def test_invalid_status_is_422(dispose_env: SimpleNamespace) -> None:
    env = dispose_env
    async with client_for(env, env.vet) as (http, _identity):
        answer = await http.get(  # type: ignore[attr-defined]
            "/api/v1/examinations", params={"laboratory_id": str(env.own.id), "status": "OPEN"}
        )
        assert answer.status_code == 422  # type: ignore[attr-defined]


async def test_foreign_laboratory_is_forbidden(dispose_env: SimpleNamespace) -> None:
    env = dispose_env
    async with client_for(env, env.vet) as (http, _identity):
        answer = await http.get(  # type: ignore[attr-defined]
            "/api/v1/examinations", params={"laboratory_id": str(uuid.uuid4())}
        )
        # A foreign laboratory UUID is never confirmed (hide_foreign).
        assert answer.status_code == 404  # type: ignore[attr-defined]


async def test_filters_and_ordering(dispose_env: SimpleNamespace) -> None:
    env = dispose_env
    vet = (await env.db.execute(select(User).where(User.id == env.vet.id))).scalar_one()
    old_party = await _party(env.db, env, consignor="Старое хозяйство")
    new_party = await _party(env.db, env, consignor="Новое хозяйство")
    unfit_party = await _party(env.db, env, consignor="Бракованное хозяйство")
    await _examination(
        env.db, env, old_party, number="ВСЭ-001", stamp="Клеймо-старое",
        created_at=datetime(2026, 1, 15, 9, 0, 0, tzinfo=UTC),
        first_completed_at=datetime(2026, 1, 1, 9, 0, 0, tzinfo=UTC),
        outcome="FIT",
    )
    await _examination(
        env.db, env, new_party, number="ВСЭ-002",
        created_at=datetime(2026, 2, 3, 9, 0, 0, tzinfo=UTC),
        first_completed_at=datetime(2026, 2, 1, 9, 0, 0, tzinfo=UTC),
        outcome="UNFIT", specialist_name=vet.full_name,
    )
    await _examination(
        env.db, env, unfit_party, number="ВСЭ-003",
        created_at=datetime(2026, 2, 10, 9, 0, 0, tzinfo=UTC),
        status="WAITING", outcome=None,
    )
    await env.db.commit()

    from backend.src.modules.examinations import journal as journal_model

    items, total = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED")
    assert total == 2
    # Descending: the newest completed card is first (tie-break by id is deterministic).
    assert [item.number for item in items] == ["ВСЭ-002", "ВСЭ-001"]

    items_asc, _ = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED", sort="asc")
    assert [item.number for item in items_asc] == ["ВСЭ-001", "ВСЭ-002"]

    items_outcome, total_outcome = await journal_model.journal_page(
        env.db, env.own.id, status="COMPLETED", outcome="UNFIT"
    )
    assert total_outcome == 1 and items_outcome[0].number == "ВСЭ-002"

    items_q, total_q = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED", q="Клеймо-старое")
    assert total_q == 1 and items_q[0].number == "ВСЭ-001"

    items_cons, total_cons = await journal_model.journal_page(
        env.db, env.own.id, status="COMPLETED", q="Браков"
    )
    assert total_cons == 0

    waiting_items, waiting_total = await journal_model.journal_page(env.db, env.own.id, status="WAITING")
    assert waiting_total == 1 and waiting_items[0].number == "ВСЭ-003"
    assert waiting_items[0].first_completed_at is None

    # The Moscow half-open window on the CREATION date of the VSE card:
    # from the Moscow midnight boundary (ТЗ DR53 Task 4).
    moscow_from = datetime(2026, 1, 31, 21, 0, 0, tzinfo=UTC)  # 00:00 МСК 01.02
    window_items, window_total = await journal_model.journal_page(
        env.db, env.own.id, status="COMPLETED", occurred_from=moscow_from
    )
    assert window_total == 1 and window_items[0].number == "ВСЭ-002"

    # The same window is meaningful for WAITING too («Дата создания ВСЭ»):
    waiting_window, waiting_window_total = await journal_model.journal_page(
        env.db, env.own.id, status="WAITING", occurred_from=moscow_from
    )
    assert waiting_window_total == 1 and waiting_window[0].number == "ВСЭ-003"
    future_from = datetime(2026, 3, 1, 0, 0, 0, tzinfo=UTC)
    _, empty_total = await journal_model.journal_page(
        env.db, env.own.id, status="WAITING", occurred_from=future_from
    )
    assert empty_total == 0


async def test_pagination_page_two_shows_next_rows(dispose_env: SimpleNamespace) -> None:
    env = dispose_env
    numbers = [f"ВСЭ-{index:03d}" for index in range(1, 26)]
    for index, number in enumerate(numbers):
        party = await _party(env.db, env, consignor=f"Хозяйство {index}")
        await _examination(
            env.db,
            env,
            party,
            number=number,
            first_completed_at=datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC) + timedelta(hours=index),
        )
    await env.db.commit()

    from backend.src.modules.examinations import journal as journal_model

    items, total = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED")
    assert total == 25
    assert len(items) == 20
    second, _ = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED", page=2)
    assert len(second) == 5
    first_numbers = {item.number for item in items}
    second_numbers = {item.number for item in second}
    assert first_numbers.isdisjoint(second_numbers)


async def test_full_page_runs_a_bounded_number_of_statements(dispose_env: SimpleNamespace) -> None:
    """No N+1: one full journal page of 20 rows stays within a small budget."""
    from sqlalchemy import event

    env = dispose_env
    for index in range(20):
        party = await _party(env.db, env, consignor=f"Хозяйство N+1 {index}")
        await _examination(
            env.db,
            env,
            party,
            number=f"ВСЭ-n{index}",
            first_completed_at=datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC) + timedelta(hours=index),
        )
    await env.db.commit()

    statements: list[str] = []

    def _before(conn: Any, cursor: Any, statement: str, parameters: Any, context: Any, executemany: Any) -> None:
        statements.append(statement)

    engine = env.db.bind
    event.listen(engine.sync_engine, "before_cursor_execute", _before)
    try:
        from backend.src.modules.examinations import journal as journal_model

        items, _total = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED")
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _before)
    assert len(items) == 20
    assert all(item.specialist_name is not None for item in items)
    # ТЗ DR56 §6.2: the page query (+count) stays a bounded number of
    # statements even with the page-level bulk conclusion projection added
    # (count + page read + the projector's three set reads).
    assert len(statements) <= 6


async def test_specialist_filter_filters_before_count(dispose_env: SimpleNamespace) -> None:
    """The specialist filter is server-side: page 2 of a filtered query is
    the page 2 of the WHOLE filtered set, and `total` matches the filter."""
    env = dispose_env
    vet = (await env.db.execute(select(User).where(User.id == env.vet.id))).scalar_one()
    other = User(
        login="dr45-colleague",
        full_name="Коллега",
        email="colleague@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    env.db.add(other)
    await env.db.flush()
    numbers = [f"ВСЭ-f{index:02d}" for index in range(1, 26)]
    for index, number in enumerate(numbers):
        party = await _party(env.db, env, consignor=f"Хозяйство {index}")
        await _examination(
            env.db,
            env,
            party,
            number=number,
            specialist=vet if index % 2 == 0 else other,
            first_completed_at=datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC) + timedelta(hours=index),
        )
    await env.db.commit()

    from backend.src.modules.examinations import journal as journal_model

    items, total = await journal_model.journal_page(env.db, env.own.id, status="COMPLETED", specialist_id=vet.id)
    assert total == 13  # 13 of 25 cards name the vet
    assert len(items) == 13
    second, _ = await journal_model.journal_page(
        env.db, env.own.id, status="COMPLETED", specialist_id=vet.id, page=2
    )
    assert all(item.specialist_id == str(vet.id) for item in [*items, *second])
    assert {item.number for item in second}.isdisjoint({item.number for item in items})


async def test_journal_authors_are_the_scoped_options(dispose_env: SimpleNamespace) -> None:
    """The author options come from the journal rows of the laboratory (ONE
    query) — the user list is never read and foreign authors never leak."""
    env = dispose_env
    other = User(
        login="dr45-author2",
        full_name="Вторая врач",
        email="author2@example.test",
        password_hash="x" * 60,
        role=UserRole.VET,
        active=True,
    )
    env.db.add(other)
    await env.db.flush()
    mine = await _party(env.db, env, consignor="Хозяйство А")
    theirs = await _party(env.db, env, consignor="Хозяйство Б")
    await _examination(env.db, env, mine, number="ВСЭ-a1", specialist=env.vet)
    await _examination(env.db, env, theirs, number="ВСЭ-b1", specialist=other)
    await env.db.commit()

    from backend.src.modules.examinations import journal as journal_model

    authors = await journal_model.journal_authors(env.db, env.own.id)
    ids = {author.id for author in authors}
    assert str(env.vet.id) in ids
    assert str(other.id) in ids


async def test_unknown_query_parameter_is_422(dispose_env: SimpleNamespace) -> None:
    """An unknown journal query name is an explicit 422 — never ignored."""
    env = dispose_env
    async with client_for(env, env.vet) as (http, _identity):
        answer = await http.get(  # type: ignore[attr-defined]
            "/api/v1/examinations", params={"laboratory_id": str(env.own.id), "author": "x"}
        )
        assert answer.status_code == 422  # type: ignore[attr-defined]
        assert "author" in answer.json()["detail"]  # type: ignore[attr-defined]


async def test_incompatible_query_combination_is_422(dispose_env: SimpleNamespace) -> None:
    """ТЗ DR53 Task 4: the outcome stays COMPLETED-only, while the creation
    window is now meaningful for BOTH tabs (a WAITING query accepts it)."""
    env = dispose_env
    async with client_for(env, env.vet) as (http, _identity):
        for params in (
            {"status": "WAITING", "outcome": "FIT"},
        ):
            answer = await http.get(  # type: ignore[attr-defined]
                "/api/v1/examinations", params={"laboratory_id": str(env.own.id), **params}
            )
            assert answer.status_code == 422, (params, answer.text)  # type: ignore[attr-defined]
            assert "Итог ВСЭ" in answer.json()["detail"]  # type: ignore[attr-defined]
        # The creation-date window no longer conflicts with WAITING.
        answer = await http.get(  # type: ignore[attr-defined]
            "/api/v1/examinations",
            params={
                "laboratory_id": str(env.own.id),
                "status": "WAITING",
                "occurred_from": "2026-01-01T00:00:00+03:00",
            },
        )
        assert answer.status_code == 200, answer.text  # type: ignore[attr-defined]


async def test_authors_endpoint_scopes_to_the_laboratory(dispose_env: SimpleNamespace) -> None:
    env = dispose_env
    mine = await _party(env.db, env, consignor="Хозяйство авторов")
    await _examination(env.db, env, mine, number="ВСЭ-aut", specialist=env.vet)
    await env.db.commit()
    async with client_for(env, env.vet) as (http, _identity):
        answer = await http.get(  # type: ignore[attr-defined]
            "/api/v1/examinations/authors", params={"laboratory_id": str(env.own.id)}
        )
        assert answer.status_code == 200, answer.text  # type: ignore[attr-defined]
        authors = answer.json()  # type: ignore[attr-defined]
        assert authors == [{"id": str(env.vet.id), "full_name": env.vet.full_name}]
