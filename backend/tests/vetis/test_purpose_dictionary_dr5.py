"""ТЗ DR5 §14.2: the local purpose dictionary, its seed resource and the
read-only GetPurposeList sync (mock transport only — the real network is
never touched in tests)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio.engine import AsyncEngine

from backend.src.modules.integrations.vetis.models import (
    MercuryPurposeGuid,
    MercuryPurposeSyncState,
    VetisContour,
)
from backend.src.modules.integrations.vetis.purpose_sync import (
    PURPOSE_SYNC_INTERVAL,
    purpose_due,
    run_purpose_sync,
)
from backend.src.modules.integrations.vetis.queries import find_purpose_name
from backend.src.modules.integrations.vetis.transport import parse_purpose_list

RESOURCES = Path(__file__).resolve().parents[2] / "resources" / "vetis"
TARGET_GUID = uuid.UUID("0778b8cb-f49d-4ed9-88b9-5f70af00a211")
PURPOSE_LIST_NS = {
    "bs": "http://api.vetrf.ru/schema/cdm/base",
    "dt": "http://api.vetrf.ru/schema/cdm/dictionary/v2",
    "v2": "http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2",
}


def purpose_page(records: list[dict[str, object]], *, total: int, offset: int) -> str:
    def record(rec: dict[str, object]) -> str:
        return (
            "<dt:purpose>"
            f"<bs:uuid>{rec.get('uuid') or ''}</bs:uuid>"
            f"<bs:guid>{rec['guid']}</bs:guid>"
            f"<bs:active>{'true' if rec.get('active', True) else 'false'}</bs:active>"
            f"<bs:last>{'true' if rec.get('last', True) else 'false'}</bs:last>"
            f"<bs:status>{rec.get('status', 200)}</bs:status>"
            f"<bs:createDate>2026-01-01T00:00:00+03:00</bs:createDate>"
            f"<bs:updateDate>2026-01-01T00:00:00+03:00</bs:updateDate>"
            f"<dt:name>{rec['name']}</dt:name>"
            "</dt:purpose>"
        )

    return (
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soap:Body><v2:getPurposeListResponse '
        'xmlns:v2="http://api.vetrf.ru/schema/cdm/registry/ws-definitions/v2" '
        'xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2" '
        'xmlns:bs="http://api.vetrf.ru/schema/cdm/base">'
        f'<dt:purposeList count="{len(records)}" total="{total}" offset="{offset}">'
        + "".join(record(rec) for rec in records)
        + "</dt:purposeList></v2:getPurposeListResponse></soap:Body></soap:Envelope>"
    )


class SpyPurposeTransport:
    """A recording mock of the DictionaryService boundary; no network, no writes."""

    def __init__(self, pages: list[str]) -> None:
        self._pages = list(pages)
        self.calls: list[dict[str, int]] = []

    async def get_purpose_list_page(self, *, offset: int, count: int) -> str:
        self.calls.append({"offset": offset, "count": count})
        if not self._pages:
            raise RuntimeError("spy: no pages prepared")
        return self._pages.pop(0)


def _factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# --- the seed resource ------------------------------------------------------------


def test_resource_has_151_unique_records() -> None:
    raw = json.loads((RESOURCES / "purpose_dictionary.json").read_text(encoding="utf-8"))
    records = raw["records"]
    assert len(records) == 151
    assert len({r["guid"] for r in records}) == 151


def test_resource_resolves_the_target_purpose() -> None:
    raw = json.loads((RESOURCES / "purpose_dictionary.json").read_text(encoding="utf-8"))
    record = next(r for r in raw["records"] if r["guid"] == str(TARGET_GUID))
    assert record["name"] == "реализация в пищу людям"
    assert record["uuid"] == "d4f9b0ea-f4d9-4cd7-92f0-016e1299160e"


def test_resource_carries_no_secrets_or_envelope() -> None:
    text_raw = (RESOURCES / "purpose_dictionary.json").read_text(encoding="utf-8").lower()
    for forbidden in ("apikey", "password", "issuerid", "cookie", "soap:envelope", "login"):
        assert forbidden not in text_raw, forbidden


# --- parse + lookup ---------------------------------------------------------------


def test_parse_purpose_list_page() -> None:
    records, total = parse_purpose_list(
        purpose_page(
            [{"guid": str(TARGET_GUID), "name": "реализация в пищу людям", "uuid": "d4f9b0ea-0000"}],
            total=151,
            offset=0,
        )
    )
    assert total == 151
    assert records[0]["name"] == "реализация в пищу людям"


def test_parse_rejects_a_record_without_guid_or_name() -> None:
    from backend.src.core.problems import ProblemError

    page = purpose_page([{"guid": "", "name": "x"}], total=1, offset=0)
    with pytest.raises(ProblemError):
        parse_purpose_list(page)


async def test_find_purpose_name_and_contour_isolation(db_session: AsyncSession) -> None:
    db_session.add(
        MercuryPurposeGuid(
            contour=VetisContour.PILOT,
            guid=TARGET_GUID,
            current_uuid=uuid.uuid4(),
            name="реализация в пищу людям",
            active=True,
            is_last=True,
            external_status=200,
            source="test",
        )
    )
    db_session.add(
        MercuryPurposeGuid(
            contour=VetisContour.PRODUCTION,
            guid=TARGET_GUID,
            current_uuid=uuid.uuid4(),
            name="другой контур",
            active=True,
            is_last=True,
            external_status=200,
            source="test",
        )
    )
    await db_session.commit()
    assert await find_purpose_name(db_session, VetisContour.PILOT, TARGET_GUID) == "реализация в пищу людям"
    assert await find_purpose_name(db_session, VetisContour.PRODUCTION, TARGET_GUID) == "другой контур"
    missing = uuid.UUID("eeeeeeee-1111-4222-8333-444444444444")
    assert await find_purpose_name(db_session, VetisContour.PILOT, missing) is None


# --- the sync ---------------------------------------------------------------------


async def test_full_pass_paginates_until_total(test_db_engine: AsyncEngine) -> None:
    first = purpose_page(
        [{"guid": str(uuid.UUID(int=i)), "name": f"назначение {i}"} for i in range(160)], total=161, offset=0
    )
    second = purpose_page([{"guid": str(uuid.UUID(int=160)), "name": "назначение 160"}], total=161, offset=160)
    spy = SpyPurposeTransport([first, second])
    result = await run_purpose_sync(
        "PILOT", transport=spy, session_factory=_factory(test_db_engine), page_count=160
    )
    assert result["result"] == "SUCCESS"
    assert len(spy.calls) == 2
    assert spy.calls[0] == {"offset": 0, "count": 160}
    assert spy.calls[1] == {"offset": 160, "count": 160}
    factory = _factory(test_db_engine)
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(MercuryPurposeGuid)) == 161
        state = (
            await db.execute(select(MercuryPurposeSyncState).where(MercuryPurposeSyncState.contour == "PILOT"))
        ).scalar_one()
        assert state.last_success is not None
        assert state.records == 161 and state.pages == 2 and state.failures == 0


async def test_partial_failure_never_moves_checkpoint_or_corrupts(test_db_engine: AsyncEngine) -> None:
    good = purpose_page(
        [{"guid": str(uuid.UUID(int=1)), "name": "старое название"}], total=300, offset=0
    )

    class FailingTransport(SpyPurposeTransport):
        async def get_purpose_list_page(self, *, offset: int, count: int) -> str:
            if offset > 0:
                raise RuntimeError("network down")
            return await super().get_purpose_list_page(offset=offset, count=count)

    spy = FailingTransport([good])
    with pytest.raises(Exception):  # noqa: B017 - any transport failure is honest
        await run_purpose_sync("PILOT", transport=spy, session_factory=_factory(test_db_engine))
    factory = _factory(test_db_engine)
    async with factory() as db:
        state = (
            await db.execute(select(MercuryPurposeSyncState).where(MercuryPurposeSyncState.contour == "PILOT"))
        ).scalar_one()
        assert state.last_success is None
        assert state.failures == 1
        # The first page was never applied: a partial pass applies NOTHING.
        assert await db.scalar(select(func.count()).select_from(MercuryPurposeGuid)) == 0


async def test_fresh_checkpoint_skips_the_network_for_14_days(test_db_engine: AsyncEngine) -> None:
    now = datetime.now(UTC)
    assert purpose_due(None, now=now) is True
    fresh = MercuryPurposeSyncState(contour="PILOT", last_success=now)
    assert purpose_due(fresh, now=now) is False
    stale = MercuryPurposeSyncState(contour="PILOT", last_success=now - PURPOSE_SYNC_INTERVAL - timedelta(minutes=1))
    assert purpose_due(stale, now=now) is True
    factory = _factory(test_db_engine)
    async with factory() as db:
        db.add(MercuryPurposeSyncState(contour="PILOT", last_success=now))
        await db.commit()
    spy = SpyPurposeTransport([])
    result = await run_purpose_sync(
        "PILOT",
        transport=spy,
        session_factory=factory,
    )
    assert result["result"] == "NOT_DUE"
    assert spy.calls == []  # a fresh checkpoint never triggers the network
    async with factory() as db:
        state = (
            await db.execute(select(MercuryPurposeSyncState).where(MercuryPurposeSyncState.contour == "PILOT"))
        ).scalar_one()
    assert state.last_success == now


async def test_upsert_updates_name_and_version(test_db_engine: AsyncEngine) -> None:
    page = purpose_page(
        [
            {
                "guid": str(TARGET_GUID),
                "name": "старое название",
                "uuid": "11111111-1111-4111-8111-111111111111",
            }
        ],
        total=1,
        offset=0,
    )
    await run_purpose_sync("PILOT", transport=SpyPurposeTransport([page]), session_factory=_factory(test_db_engine))
    updated = purpose_page(
        [
            {
                "guid": str(TARGET_GUID),
                "name": "новое название",
                "uuid": "22222222-2222-4222-8222-222222222222",
            }
        ],
        total=1,
        offset=0,
    )
    result = await run_purpose_sync(
        "PILOT", transport=SpyPurposeTransport([updated]), session_factory=_factory(test_db_engine), force=True
    )
    assert result["upserted"] == 1 and result["unchanged"] == 0
    factory = _factory(test_db_engine)
    async with factory() as db:
        row = (await db.execute(select(MercuryPurposeGuid).where(MercuryPurposeGuid.guid == TARGET_GUID))).scalar_one()
        assert row.name == "новое название"
        assert str(row.current_uuid) == "22222222-2222-4222-8222-222222222222"


async def test_disappeared_records_are_marked_not_deleted(test_db_engine: AsyncEngine) -> None:
    first = purpose_page(
        [
            {"guid": str(uuid.UUID(int=1)), "name": "один"},
            {"guid": str(uuid.UUID(int=2)), "name": "два"},
        ],
        total=2,
        offset=0,
    )
    await run_purpose_sync(
        "PILOT", transport=SpyPurposeTransport([first]), session_factory=_factory(test_db_engine)
    )
    second = purpose_page([{"guid": str(uuid.UUID(int=1)), "name": "один"}], total=1, offset=0)
    result = await run_purpose_sync(
        "PILOT", transport=SpyPurposeTransport([second]), session_factory=_factory(test_db_engine), force=True
    )
    assert result["deactivated"] == 1
    factory = _factory(test_db_engine)
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(MercuryPurposeGuid)) == 2
        gone = (
            await db.execute(
                select(MercuryPurposeGuid).where(MercuryPurposeGuid.guid == uuid.UUID(int=2))
            )
        ).scalar_one()
        assert gone.active is False and gone.is_last is False


async def test_concurrent_due_workers_cannot_both_fetch(test_db_engine: AsyncEngine) -> None:
    """The lock covers the ENTIRE run: a second due worker mid-fetch is skipped.

    The first worker holds the advisory lock while the network pass runs, so
    the second worker's transport must receive zero page calls.
    """
    import asyncio

    started = asyncio.Event()
    release = asyncio.Event()

    class SlowTransport:
        def __init__(self) -> None:
            self.calls = 0

        async def get_purpose_list_page(self, *, offset: int, count: int) -> str:
            self.calls += 1
            started.set()
            await release.wait()
            return purpose_page([{"guid": str(uuid.UUID(int=1)), "name": "один"}], total=1, offset=0)

    slow = SlowTransport()
    factory = _factory(test_db_engine)
    first = asyncio.create_task(run_purpose_sync("PILOT", transport=slow, session_factory=factory))
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
        # The first worker is mid-fetch with the lock held; a second due worker
        # must skip BEFORE its transport is ever called.
        second_transport = SlowTransport()
        second = await run_purpose_sync(
            "PILOT", transport=second_transport, session_factory=_factory(test_db_engine)
        )
        assert second["result"] == "SKIPPED_OVERLAP"
        assert second_transport.calls == 0
    finally:
        release.set()
    first_result = await asyncio.wait_for(first, timeout=30)
    assert first_result["result"] == "SUCCESS"


async def test_unknown_total_never_deactivates_missing_rows(test_db_engine: AsyncEngine) -> None:
    """A provider without the total never wipes rows missing from its pages."""
    first = purpose_page(
        [
            {"guid": str(uuid.UUID(int=1)), "name": "один"},
            {"guid": str(uuid.UUID(int=2)), "name": "два"},
        ],
        total=2,
        offset=0,
    )
    await run_purpose_sync("PILOT", transport=SpyPurposeTransport([first]), session_factory=_factory(test_db_engine))
    # Second pass: the provider reports no total but returns one record.
    second = purpose_page([{"guid": str(uuid.UUID(int=1)), "name": "один"}], total=0, offset=0)
    empty = purpose_page([], total=0, offset=1)
    result = await run_purpose_sync(
        "PILOT",
        transport=SpyPurposeTransport([second, empty]),
        session_factory=_factory(test_db_engine),
        force=True,
    )
    assert result["deactivated"] == 0
    assert result["result"] == "SUCCESS"
    factory = _factory(test_db_engine)
    async with factory() as db:
        survivor = (
            await db.execute(select(MercuryPurposeGuid).where(MercuryPurposeGuid.guid == uuid.UUID(int=2)))
        ).scalar_one()
        assert survivor.active is True and survivor.is_last is True


async def test_overlap_protection_single_sync_per_contour(test_db_engine: AsyncEngine) -> None:
    page = purpose_page([{"guid": str(uuid.UUID(int=1)), "name": "один"}], total=1, offset=0)
    # Hold the contour lock: a parallel run must skip, not duplicate.
    async with _factory(test_db_engine)() as holder:
        await holder.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {
                "k": int.from_bytes(
                    __import__("hashlib").sha256(b"mercury_purpose_sync:PILOT").digest()[:8], "big", signed=True
                )
            },
        )
        result = await run_purpose_sync(
            "PILOT", transport=SpyPurposeTransport([page]), session_factory=_factory(test_db_engine)
        )
        assert result["result"] == "SKIPPED_OVERLAP"
        assert await holder.scalar(select(func.count()).select_from(MercuryPurposeGuid)) == 0


async def test_second_run_is_unchanged_and_state_stays(test_db_engine: AsyncEngine) -> None:
    page = purpose_page([{"guid": str(uuid.UUID(int=1)), "name": "один"}], total=1, offset=0)
    spy = SpyPurposeTransport([page, page])
    await run_purpose_sync("PILOT", transport=spy, session_factory=_factory(test_db_engine))
    result = await run_purpose_sync("PILOT", transport=spy, session_factory=_factory(test_db_engine), force=True)
    assert result["upserted"] == 0 and result["unchanged"] == 1
    assert result["result"] == "SUCCESS"

