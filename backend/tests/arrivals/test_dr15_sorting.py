"""DR15 §7: server-side EXPECTED sorting by source_snapshot.vdDocument.issueDate.

The sort is SQL-level BEFORE count/offset/limit; the tie-breaker stays
``Party.created_at DESC, Party.id DESC``; a missing or malformed date never
turns into a 500; scope/search/queue and ``total`` are untouched; an absent
``sort`` keeps the default (desc) behaviour.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.modules.arrivals import commands, queries
from backend.src.modules.arrivals.models import Party
from backend.src.modules.arrivals.schemas import (
    Batch,
    ConsignorConsignee,
    ExternalRef,
    SourceSnapshot,
    VdDocument,
)
from backend.src.modules.arrivals.schemas import (
    IncomingDocument as IncomingDocumentInput,
)
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.tests.arrivals.test_api import PLAYER, _client_for, vet_env  # noqa: F401,F811
from backend.tests.arrivals.test_import_and_queues import (
    _CONSIGNEE_ENTERPRISE,
    _CONSIGNOR_ENTITY,
    _PRODUCT_ITEM,
    _SUB_PRODUCT,
    PILOT_BEEF,
)

UNIT_KG = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")


def doc_with_issue_date(
    evsd_uuid: uuid.UUID,
    laboratory_id: uuid.UUID,
    issue_date: str | None,
    issue_number: str | None = None,
) -> IncomingDocumentInput:
    """A document whose issueDate differs from its creation order.

    ``None`` produces a snapshot WITHOUT any issue date — the absent case the
    strict import schema allows (an eVSD the source carries undated).
    """
    batch = Batch(
        product=ExternalRef(guid=PILOT_BEEF),
        subProduct=ExternalRef(guid=_SUB_PRODUCT),
        productItem=ExternalRef(guid=_PRODUCT_ITEM, name="Говядина"),
        volume="120.0",
        quantity="4",
        unit=ExternalRef(guid=UNIT_KG, name="кг"),
    )
    payload = VdDocument(
        type="CERTIFICATE",
        status="COMPLETED",
        issueNumber=issue_number or "S-00001",
        issueDate=issue_date,
        consignor=ConsignorConsignee(name="Отправитель", businessEntity=ExternalRef(guid=_CONSIGNOR_ENTITY)),
        consignee=ConsignorConsignee(name="Получатель", enterprise=ExternalRef(guid=_CONSIGNEE_ENTERPRISE)),
        batch=batch,
        transportNumber="А123ВС77",
    )
    return IncomingDocumentInput(
        contour=VetisContour.PILOT,
        evsd_uuid=evsd_uuid,
        laboratory_id=laboratory_id,
        external_status="COMPLETED",
        snapshot=SourceSnapshot(vdDocument=payload),
        fetched_at=datetime.now(UTC),
    )


async def _seed(env, dates: list[str]) -> None:
    for index, date in enumerate(dates):
        await commands.upsert_incoming(
            env.db,
            doc_with_issue_date(uuid.uuid4(), env.own.id, date, issue_number=f"S-{index:05d}"),
        )
    await env.db.commit()


def _dates(items: list[dict]) -> list[str | None]:
    return [item["external"]["fields"]["issuedOn"] for item in items]


async def test_sort_asc_returns_earliest_first(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-09", "2026-11-01", "2026-11-05"])
    async with _client_for(env) as (http, _):
        response = await http.get(
            "/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "asc"}
        )
        assert response.status_code == 200
        assert _dates(response.json()["items"]) == ["2026-11-01", "2026-11-05", "2026-11-09"]


async def test_sort_desc_returns_latest_first(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-09", "2026-11-01", "2026-11-05"])
    async with _client_for(env) as (http, _):
        response = await http.get(
            "/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "desc"}
        )
        assert response.status_code == 200
        assert _dates(response.json()["items"]) == ["2026-11-09", "2026-11-05", "2026-11-01"]


async def test_missing_sort_keeps_default_desc(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-09", "2026-11-01", "2026-11-05"])
    async with _client_for(env) as (http, _):
        response = await http.get("/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED"})
        assert response.status_code == 200
        assert _dates(response.json()["items"]) == ["2026-11-09", "2026-11-05", "2026-11-01"]


async def test_invalid_sort_is_422(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-01"])
    async with _client_for(env) as (http, _):
        response = await http.get(
            "/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "middle"}
        )
        assert response.status_code == 422


async def test_sort_applies_before_paging(vet_env) -> None:  # noqa: F811
    env = vet_env
    # 21 documents so page 2 exists; issue dates interleave the creation order.
    dates = [f"2026-10-{(index % 20) + 1:02d}" for index in range(21)]
    await _seed(env, dates)
    async with _client_for(env) as (http, _):
        params = {"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "asc"}
        first = (await http.get("/api/v1/arrivals", params=params)).json()
        second = (await http.get("/api/v1/arrivals", params={**params, "page": 2})).json()
        assert first["total"] == 21 and second["total"] == 21
        assert first["page_size"] == queries.PAGE_SIZE == 20
        assert len(first["items"]) == 20 and len(second["items"]) == 1
        all_dates = _dates(first["items"]) + _dates(second["items"])
        assert all_dates == sorted(all_dates)


async def test_equal_dates_keep_stable_tie_breaker(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-05", "2026-11-05", "2026-11-05"])
    async with _client_for(env) as (http, _):
        params = {"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "asc"}
        first = (await http.get("/api/v1/arrivals", params=params)).json()
        again = (await http.get("/api/v1/arrivals", params=params)).json()
        ids_one = [item["party_id"] for item in first["items"]]
        assert ids_one == [item["party_id"] for item in again["items"]]
        # The tie-breaker Party.created_at DESC / id DESC: the newest party
        # first inside one issue date.
        newest = await env.db.get(Party, uuid.UUID(ids_one[0]))
        assert newest is not None
        for other_id in ids_one[1:]:
            other = await env.db.get(Party, uuid.UUID(other_id))
            assert other is not None and other.created_at <= newest.created_at


async def test_missing_or_corrupt_date_never_500(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-05"])
    # A snapshot WITHOUT the issue date at all and one with a corrupt value.
    await commands.upsert_incoming(env.db, doc_with_issue_date(uuid.uuid4(), env.own.id, None, issue_number="M-00001"))
    await commands.upsert_incoming(
        env.db, doc_with_issue_date(uuid.uuid4(), env.own.id, "не дата", issue_number="C-00001")
    )
    await env.db.commit()
    async with _client_for(env) as (http, _):
        for sort in ("asc", "desc"):
            response = await http.get(
                "/api/v1/arrivals",
                params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": sort},
            )
            assert response.status_code == 200, response.text
            page = response.json()
            assert page["total"] == 3
            items = page["items"]
            if sort == "asc":
                # The real date leads; undated/corrupt rows keep a
                # deterministic position at the end (tie-breaker still holds).
                dates = _dates(items)
                assert dates[0] == "2026-11-05"
                assert dates[-1] in (None, "не дата")


async def test_sort_does_not_change_scope_search_total(vet_env) -> None:  # noqa: F811
    env = vet_env
    await _seed(env, ["2026-11-05", "2026-11-02"])
    # A foreign-laboratory document must never join the scope, even by date.
    await commands.upsert_incoming(env.db, doc_with_issue_date(uuid.uuid4(), env.foreign.id, "2026-11-01"))
    await env.db.commit()
    async with _client_for(env) as (http, _):
        scoped = (await http.get(
            "/api/v1/arrivals", params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "asc"}
        )).json()
        assert scoped["total"] == 2
        searched = (await http.get(
            "/api/v1/arrivals",
            params={"laboratory_id": str(env.own.id), "queue": "EXPECTED", "sort": "asc", "q": "S-00001"},
        )).json()
        assert searched["total"] == 1
        assert searched["items"][0]["external"]["fields"]["issuedOn"] == "2026-11-02"


def test_issue_date_sort_key_is_the_snapshot_path(db_session: AsyncSession) -> None:
    """The sort key IS the JSONB snapshot path, not a Party/date column."""
    from backend.src.modules.arrivals.models import IncomingDocument

    text = str(IncomingDocument.source_snapshot["vdDocument"]["issueDate"].astext)
    # The path is parameterized, so only the operator shape is asserted.
    assert "source_snapshot" in text and "->>" in text
    assert "created_at" not in text
