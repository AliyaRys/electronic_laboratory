"""ТЗ DR39 §3: server-side sorting/filtering by the completed reconciliation date.

WORK/ACCEPTED sort by ``Reconciliation.completed_at`` (never the receipt
``confirmed_at``) in BOTH directions, ``nulls last`` in both, with the stable
tie-breaker ``Party.created_at DESC, Party.id DESC``. The date filter runs in
SQL BEFORE count/offset/limit; the SAME where serves rows and ``total``.
``reconciled_*`` params are ACCEPTED-only (an honest 422 elsewhere).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from backend.src.modules.arrivals import commands
from backend.tests.arrivals.test_api import _client_for, vet_env  # noqa: F401,F811
from backend.tests.arrivals.test_dr11_pricing import full_body, headers
from backend.tests.arrivals.test_import_and_queues import document
from backend.tests.fixtures.receipt_evidence import (
    FixtureReceiptEvidenceReader,
    confirm_via_reader,
    party_evsd_uuid,
    receipt_evidence,
)

pytestmark = pytest.mark.integration

MSK = timezone(timedelta(hours=3))


async def _accept_queue_rows(env) -> None:
    """The 'examinations' table exists (0009) — the ACCEPTED queue needs one."""
    exists = (await env.db.execute(text("SELECT to_regclass('examinations')"))).scalar()
    assert exists is not None


async def _party_with_reconciliation(env) -> object:
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()
    async with _client_for(env) as (http, identity):
        response = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=full_body(),
            headers=headers(identity),
        )
        assert response.status_code == 200, response.text
    reader = FixtureReceiptEvidenceReader()
    reader.plant(party.id, receipt_evidence(await party_evsd_uuid(env.db, party.id)))
    assert await confirm_via_reader(env.db, reader, party.id) is not None
    await env.db.commit()
    return party


async def _mark_examination_done(env, party) -> None:
    await env.db.execute(
        text(
            "INSERT INTO examinations (party_id, laboratory_id, number, stamp, status,"
            " research_snapshot, findings_snapshot, pricing_snapshot, created_by, created_at, first_completed_at)"
            " VALUES (:p, :l, :n, 'КМ-1', 'COMPLETED', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, :u, now(), now())"
        ),
        {"p": party.id, "l": party.laboratory_id, "n": f"ВСЭ-{uuid.uuid4().hex[:8]}", "u": env.vet.id},
    )
    await env.db.commit()


async def _set_completed(env, party, moment: datetime) -> None:
    await env.db.execute(
        text("UPDATE reconciliations SET completed_at = :m WHERE party_id = :p"),
        {"m": moment, "p": party.id},
    )
    await env.db.commit()


async def _work_party(env, moment: datetime) -> object:
    party = await _party_with_reconciliation(env)
    await _set_completed(env, party, moment)
    return party


async def _accepted_party(env, moment: datetime) -> object:
    party = await _party_with_reconciliation(env)
    await _mark_examination_done(env, party)
    await _set_completed(env, party, moment)
    return party


async def _list(env, **params: object) -> tuple[list[dict], int]:
    async with _client_for(env) as (http, _):
        response = await http.get(
            "/api/v1/arrivals",
            params={"laboratory_id": str(env.own.id), **params},
        )
        body = response.json()
        return body.get("items", []), int(body.get("total", 0))


def _insts(items: list[dict]) -> list[str | None]:
    return [item["reconciliation"]["completed_at"] for item in items]


def _msk(item: dict) -> str:
    """The московский wall-clock string of one row's completed instant."""
    instant = _insts([item])[0]
    assert instant is not None
    return datetime.fromisoformat(instant.replace("Z", "+00:00")).astimezone(MSK).isoformat()


# --- queue-aware sorting ----------------------------------------------------------


async def test_work_sorts_by_completed_date_desc_and_asc(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    await _work_party(env, datetime(2026, 11, 3, 10, 0, tzinfo=MSK))
    await _work_party(env, datetime(2026, 11, 5, 10, 0, tzinfo=MSK))
    await _work_party(env, datetime(2026, 11, 1, 10, 0, tzinfo=MSK))
    desc, _ = await _list(env, queue="WORK")
    asc, _ = await _list(env, queue="WORK", sort="asc")
    assert len(desc) == 3 and len(asc) == 3
    assert [entry[:10] for entry in _insts(desc)] == ["2026-11-05", "2026-11-03", "2026-11-01"]
    assert [entry[:10] for entry in _insts(asc)] == ["2026-11-01", "2026-11-03", "2026-11-05"]


async def test_accepted_sorts_by_completed_date_both_directions(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    await _accepted_party(env, datetime(2026, 11, 4, 12, 0, tzinfo=MSK))
    await _accepted_party(env, datetime(2026, 11, 8, 12, 0, tzinfo=MSK))
    desc, total = await _list(env, queue="ACCEPTED")
    asc, _ = await _list(env, queue="ACCEPTED", sort="asc")
    assert total == 2
    assert [entry[:10] for entry in _insts(desc)] == ["2026-11-08", "2026-11-04"]
    assert [entry[:10] for entry in _insts(asc)] == ["2026-11-04", "2026-11-08"]


async def test_null_completed_at_always_last_in_both_directions(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    # A legacy WORK row: the receipt exists, the reconciliation row does not.
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()
    reader = FixtureReceiptEvidenceReader()
    reader.plant(party.id, receipt_evidence(await party_evsd_uuid(env.db, party.id)))
    assert await confirm_via_reader(env.db, reader, party.id) is not None
    await env.db.commit()
    await _work_party(env, datetime(2026, 11, 2, 9, 0, tzinfo=MSK))
    for sort in ("asc", "desc", None):
        params = {"queue": "WORK"}
        if sort is not None:
            params["sort"] = sort
        items, _ = await _list(env, **params)
        assert len(items) == 2
        assert items[-1]["reconciliation"] is None, f"sort={sort}"


async def test_equal_completed_dates_keep_the_stable_tie_breaker(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    moment = datetime(2026, 11, 6, 9, 0, tzinfo=MSK)
    for _ in range(3):
        await _work_party(env, moment)
    items, _ = await _list(env, queue="WORK")
    again, _ = await _list(env, queue="WORK")
    ids = [item["party_id"] for item in items]
    assert ids == [item["party_id"] for item in again]
    assert len(set(ids)) == 3  # the unique left join never duplicates a row
    # Tie-breaker Party.created_at DESC: the newest party leads.
    created = await env.db.execute(
        text("SELECT created_at FROM parties WHERE id = :p"), {"p": uuid.UUID(ids[0])}
    )
    newest = created.scalar()
    for other in ids[1:]:
        row = await env.db.execute(text("SELECT created_at FROM parties WHERE id = :p"), {"p": uuid.UUID(other)})
        assert row.scalar() <= newest


async def test_completed_sort_paginates_before_filters_across_pages(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    for index in range(21):
        await _work_party(env, datetime(2026, 11, (index % 20) + 1, 8, 0, tzinfo=MSK))
    async with _client_for(env) as (http, _):
        params = {"laboratory_id": str(env.own.id), "queue": "WORK", "sort": "asc"}
        first = (await http.get("/api/v1/arrivals", params=params)).json()
        second = (await http.get("/api/v1/arrivals", params={**params, "page": 2})).json()
        assert first["total"] == second["total"] == 21
        assert len(first["items"]) == 20 and len(second["items"]) == 1
        days = [item["reconciliation"]["completed_at"][:10] for item in first["items"]]
        assert days == sorted(days)


# --- reconciled_* filters ----------------------------------------------------------


async def test_reconciled_on_filters_one_moscow_day(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    # 00:00 of the day passes; the previous day's last minute and the next
    # day's midnight are excluded — a half-open [00:00, next 00:00) range.
    await _accepted_party(env, datetime(2026, 11, 6, 0, 0, 0, tzinfo=MSK))
    await _accepted_party(env, datetime(2026, 11, 5, 23, 59, 59, tzinfo=MSK))
    await _accepted_party(env, datetime(2026, 11, 7, 0, 0, 0, tzinfo=MSK))
    items, total = await _list(env, queue="ACCEPTED", reconciled_on="2026-11-06")
    assert total == 1
    assert len(items) == 1
    assert _msk(items[0])[:10] == "2026-11-06"


async def test_reconciled_range_is_inclusive_of_the_end_minute(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    # The wire stores an EXCLUSIVE upper bound of the next minute: 10:00:30
    # passes, 10:01:00 itself does not.
    await _accepted_party(env, datetime(2026, 11, 6, 10, 0, 30, tzinfo=MSK))
    await _accepted_party(env, datetime(2026, 11, 6, 10, 1, 0, tzinfo=MSK))
    await _accepted_party(env, datetime(2026, 11, 6, 9, 59, 0, tzinfo=MSK))
    items, total = await _list(
        env,
        queue="ACCEPTED",
        reconciled_from="2026-11-06T10:00:00+03:00",
        reconciled_to="2026-11-06T10:01:00+03:00",
    )
    assert total == 1
    assert _msk(items[0])[:16] == "2026-11-06T10:00"


async def test_reconciled_filter_runs_before_paging(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    for index in range(5):
        await _accepted_party(env, datetime(2026, 11, 6, 9, index, tzinfo=MSK))
    for index in range(3):
        await _accepted_party(env, datetime(2026, 11, 7, 9, index, tzinfo=MSK))
    async with _client_for(env) as (http, _):
        params = {
            "laboratory_id": str(env.own.id),
            "queue": "ACCEPTED",
            "reconciled_on": "2026-11-06",
            "sort": "asc",
        }
        first = (await http.get("/api/v1/arrivals", params=params)).json()
        assert first["total"] == 5
        assert len(first["items"]) == 5
        second = (await http.get("/api/v1/arrivals", params={**params, "page": 2})).json()
        assert second["total"] == 5 and len(second["items"]) == 0


async def test_null_dates_never_pass_an_active_reconciled_filter(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    await _accepted_party(env, datetime(2026, 11, 6, 9, 0, tzinfo=MSK))
    # A legacy WORK row without a reconciliation row never passes the filter.
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))
    await env.db.commit()
    reader = FixtureReceiptEvidenceReader()
    reader.plant(party.id, receipt_evidence(await party_evsd_uuid(env.db, party.id)))
    assert await confirm_via_reader(env.db, reader, party.id) is not None
    await env.db.commit()
    items, total = await _list(env, queue="ACCEPTED", reconciled_on="2026-11-06")
    assert total == 1 and len(items) == 1


# --- 422 matrix ---------------------------------------------------------------------


@pytest.mark.parametrize("queue", ["WORK", "EXPECTED", None])
async def test_reconciled_params_outside_accepted_are_422(vet_env, queue: str | None) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    async with _client_for(env) as (http, _):
        params: dict[str, object] = {"laboratory_id": str(env.own.id), "reconciled_on": "2026-11-06"}
        if queue is not None:
            params["queue"] = queue
        response = await http.get("/api/v1/arrivals", params=params)
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "VALIDATION_ERROR"


async def test_reconciled_validation_matrix(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _accept_queue_rows(env)
    cases = [
        # single day mixed with a range
        {"queue": "ACCEPTED", "reconciled_on": "2026-11-06", "reconciled_from": "2026-11-05T10:00:00+03:00"},
        # an incomplete range
        {"queue": "ACCEPTED", "reconciled_from": "2026-11-05T10:00:00+03:00"},
        {"queue": "ACCEPTED", "reconciled_to": "2026-11-06T10:00:00+03:00"},
        # a reversed range
        {
            "queue": "ACCEPTED",
            "reconciled_from": "2026-11-06T10:00:00+03:00",
            "reconciled_to": "2026-11-05T10:00:00+03:00",
        },
        # a datetime without the offset
        {"queue": "ACCEPTED", "reconciled_from": "2026-11-06T10:00:00", "reconciled_to": "2026-11-07T10:00:00"},
        # a malformed calendar day
        {"queue": "ACCEPTED", "reconciled_on": "2026-02-30"},
    ]
    async with _client_for(env) as (http, _):
        for params in cases:
            response = await http.get(
                "/api/v1/arrivals", params={"laboratory_id": str(env.own.id), **params}
            )
            assert response.status_code == 422, (params, response.text)
            assert response.json()["code"] == "VALIDATION_ERROR", params
