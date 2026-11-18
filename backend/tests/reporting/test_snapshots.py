"""R02: session-bound preview and immutable saved 5-vet snapshot."""

from __future__ import annotations

import asyncio
import base64
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from backend.src.core.commands import CommandContext
from backend.src.core.keyring import OLD_KEY_GRACE, PreviewKeyring, SigningKey
from backend.src.core.problems import ProblemError
from backend.src.infrastructure.config.enums import EnvironmentOption
from backend.src.infrastructure.config.settings import Settings
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation
from backend.src.modules.catalog_pricing.models import ReportClassification
from backend.src.modules.examinations.models import Examination
from backend.src.modules.identity.models import Laboratory, Territory, User
from backend.src.modules.reporting.commands import delete_report, load_report, save_report
from backend.src.modules.reporting.schemas import ReportCodesWrite, ReportPreviewParams
from backend.src.modules.reporting.snapshots import MAX_PAYLOAD_BYTES, canonical_json, preview_report, verify_preview

ACTIVATED = datetime(2026, 1, 1, tzinfo=UTC)
NOW = datetime(2027, 1, 2, tzinfo=UTC)
SPECIES = "mercury-pig-meat"


def keyring() -> PreviewKeyring:
    # The active key may sign for 90 days, so use a fresh key for NOW.
    return PreviewKeyring(SigningKey("r02", b"r" * 32, NOW - timedelta(days=1)))


def codes(**overrides: str) -> ReportCodesWrite:
    names = ("okud", "okpo", "okved", "oktmo", "okogu", "okopf", "okfs")
    values = {name: f"00{index}" for index, name in enumerate(names, 1)}
    values.update(overrides)
    return ReportCodesWrite(**values)


async def seed_source(
    db: AsyncSession,
    *,
    species: str = SPECIES,
    column: str = "PIG",
    kind: str = "MEAT",
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    territory = Territory(name="Территория")
    db.add(territory)
    await db.flush()
    lab = Laboratory(territory_id=territory.id, name="Лаборатория", address="Адрес", organization="Организация")
    actor = User(
        login=f"head-{uuid.uuid4()}",
        full_name="Руководитель",
        email=f"{uuid.uuid4()}@example.test",
        password_hash="unused",
        role="HEAD",
        active=True,
    )
    db.add_all([lab, actor])
    await db.flush()
    incoming = IncomingDocument(
        contour="PILOT",
        evsd_uuid=uuid.uuid4(),
        laboratory_id=lab.id,
        external_status="CONFIRMED",
        source_snapshot={},
        content_hash="0" * 64,
        fetched_at=NOW,
    )
    db.add(incoming)
    await db.flush()
    party = Party(
        incoming_document_id=incoming.id,
        laboratory_id=lab.id,
        classification_snapshot={"product": {"id": species}},
    )
    db.add(party)
    await db.flush()
    db.add_all(
        [
            ReceiptConfirmation(
                party_id=party.id,
                operation_id=uuid.uuid4(),
                source_evsd_uuid=incoming.evsd_uuid,
                fingerprint="1" * 64,
                evidence={},
                accepted_mass_kg=Decimal("250"),
                accepted_quantity=Decimal("1"),
                accepted_unit_id="kg",
                returned_mass_kg=Decimal("0"),
                returned_quantity=Decimal("0"),
                classification_snapshot={},
                confirmed_at=datetime(2026, 2, 1, tzinfo=UTC),
            ),
            ReportClassification(
                version="2026-v1",
                mercury_species_id=species,
                supported=True,
                animal_column=column,
                material_kind=kind,
                rev=1,
            ),
        ]
    )
    examination = Examination(
        party_id=party.id,
        laboratory_id=lab.id,
        number="VSE-1",
        stamp="stamp",
        status="COMPLETED",
        sent_to_lab=False,
        research_snapshot=[],
        findings_snapshot={},
        pricing_snapshot={},
        outcome="UNFIT",
        direction="DESTRUCTION",
        created_by=actor.id,
        created_at=datetime(2026, 2, 1, tzinfo=UTC),
        first_completed_at=datetime(2026, 2, 1, tzinfo=UTC),
        rev=1,
    )
    db.add(examination)
    await db.commit()
    return actor.id, lab.id, examination.id


@pytest.mark.asyncio
async def test_preview_builds_with_the_real_buivol_guid_on_the_seeded_map(db_session: AsyncSession) -> None:
    """DR49: the completed «буйволятина» ВСЭ is classified by its real Mercury
    second-level GUID — the preview adds +1 to the CATTLE column of row 166."""
    actor_id, lab_id, _source_id = await seed_source(
        db_session,
        species="e84f3cb2-0fd9-403e-8abf-9a2c7f1aa71f",  # буйволятина
        column="CATTLE",
        kind="MEAT",
    )
    preview = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=keyring(),
        now=NOW,
    )
    matrix = preview.payload["matrix"]
    columns = preview.payload["columns"]
    cattle_index = list(columns).index("CATTLE")
    # Row "166" (index 0 of row_codes): exactly +1 in the CATTLE column.
    assert list(preview.payload["row_codes"])[0] == "166"
    row166 = list(matrix)[0]
    assert row166[cattle_index] == "1"
    assert preview.payload["classification_version"] == "2026-v1"


@pytest.mark.asyncio
async def test_preview_save_preserves_deleted_source(db_session: AsyncSession) -> None:
    actor_id, lab_id, source_id = await seed_source(db_session)
    preview = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=keyring(),
        now=NOW,
    )
    source = await db_session.get(Examination, source_id)
    assert source is not None
    await db_session.delete(source)
    await db_session.commit()

    saved = await save_report(
        CommandContext(actor_id=actor_id, idempotency_key="save-1"),
        preview,
        codes(okud=" 001 "),
        session_id="session-a",
        db=db_session,
        keyring=keyring(),
        now=NOW,
    )
    await db_session.commit()
    assert saved.payload == preview.payload
    assert saved.codes["okud"] == "001"
    assert saved.source_count == 1

    replay = await save_report(
        CommandContext(actor_id=actor_id, idempotency_key="save-1"),
        preview,
        codes(okud=" 001 "),
        session_id="session-a",
        db=db_session,
        keyring=keyring(),
        now=NOW,
    )
    assert replay.id == saved.id
    assert (await load_report(db_session, saved.id)).payload == preview.payload

    await delete_report(
        CommandContext(actor_id=actor_id, idempotency_key="delete-1", expected_revision=1),
        saved.id,
        db=db_session,
    )
    await db_session.commit()
    await delete_report(
        CommandContext(actor_id=actor_id, idempotency_key="delete-1", expected_revision=1),
        saved.id,
        db=db_session,
    )
    await db_session.commit()
    with pytest.raises(ProblemError) as removed:
        await load_report(db_session, saved.id)
    assert removed.value.code == "NOT_FOUND"


@pytest.mark.asyncio
async def test_tampered_payload_and_other_session_are_rejected(db_session: AsyncSession) -> None:
    actor_id, lab_id, _source_id = await seed_source(db_session)
    preview = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=keyring(),
        now=NOW,
    )
    tampered = preview.model_copy(deep=True)
    tampered.payload["date_from"] = "2025-01-01"
    with pytest.raises(ProblemError, match="изменён") as changed:
        verify_preview(tampered, actor_id, "session-a", keyring=keyring(), now=NOW)
    assert changed.value.code == "REPORT_PREVIEW_INVALID"
    with pytest.raises(ProblemError) as other_session:
        verify_preview(preview, actor_id, "session-b", keyring=keyring(), now=NOW)
    assert other_session.value.code == "REPORT_PREVIEW_INVALID"


@pytest.mark.asyncio
async def test_foreign_payload_version_is_rejected(db_session: AsyncSession) -> None:
    """A preview signed for another payload schema version is REPORT_PREVIEW_INVALID."""
    actor_id, lab_id, _source_id = await seed_source(db_session)
    preview = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=keyring(),
        now=NOW,
    )
    assert preview.payload["version"] == 2
    foreign = preview.model_copy(deep=True)
    foreign.payload["version"] = 1
    with pytest.raises(ProblemError, match="верси") as wrong:
        verify_preview(foreign, actor_id, "session-a", keyring=keyring(), now=NOW)
    assert wrong.value.code == "REPORT_PREVIEW_INVALID"


def test_codes_preserve_leading_zeroes_and_reject_blank() -> None:
    assert codes(okud=" 001 ").okud == "001"
    with pytest.raises(ValidationError):
        codes(okud="   ")


@pytest.mark.asyncio
async def test_no_data_is_honest_for_any_range(db_session: AsyncSession) -> None:
    actor_id, lab_id, source_id = await seed_source(db_session)
    source = await db_session.get(Examination, source_id)
    assert source is not None
    await db_session.delete(source)
    await db_session.commit()
    with pytest.raises(ProblemError) as no_data:
        await preview_report(
            db_session,
            actor_id,
            "session-a",
            ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
            keyring=keyring(),
            now=NOW,
        )
    assert no_data.value.code == "REPORT_NO_DATA"
    # DR48 §3.1: a current (unfinished) calendar range is allowed — the old
    # REPORT_PERIOD_UNFINISHED gate no longer exists; an empty future range
    # answers the same honest REPORT_NO_DATA.
    with pytest.raises(ProblemError) as future_empty:
        await preview_report(
            db_session,
            actor_id,
            "session-a",
            ReportPreviewParams(laboratory_id=lab_id, date_from=date(2027, 1, 1), date_to=date(2027, 6, 30)),
            keyring=keyring(),
            now=NOW,
        )
    assert future_empty.value.code == "REPORT_NO_DATA"


@pytest.mark.asyncio
async def test_rejected_bounds_and_overlapping_ranges(db_session: AsyncSession) -> None:
    actor_id, lab_id, _source_id = await seed_source(db_session)
    with pytest.raises(ValidationError):
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2025, 12, 31))
    ring = keyring()
    first = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=ring,
        now=NOW,
    )
    await save_report(
        CommandContext(actor_id=actor_id, idempotency_key="dup-1"),
        first,
        codes(),
        session_id="session-a",
        db=db_session,
        keyring=ring,
        now=NOW,
    )
    await db_session.commit()
    # An exact duplicate of the range is forbidden...
    again = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=ring,
        now=NOW,
    )
    with pytest.raises(ProblemError) as duplicate:
        await save_report(
            CommandContext(actor_id=actor_id, idempotency_key="dup-2"),
            again,
            codes(),
            session_id="session-a",
            db=db_session,
            keyring=ring,
            now=NOW,
        )
    assert duplicate.value.code == "REPORT_PERIOD_EXISTS"
    # ...while an overlapping but different range is allowed.
    overlap = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 2, 1), date_to=date(2026, 9, 30)),
        keyring=ring,
        now=NOW,
    )
    saved = await save_report(
        CommandContext(actor_id=actor_id, idempotency_key="dup-3"),
        overlap,
        codes(),
        session_id="session-a",
        db=db_session,
        keyring=ring,
        now=NOW,
    )
    await db_session.commit()
    assert (saved.date_from, saved.date_to) == (date(2026, 2, 1), date(2026, 9, 30))
    assert first.payload["version"] == 2
    assert first.payload["date_from"] == "2026-01-01" and first.payload["date_to"] == "2026-06-30"
    assert "year" not in first.payload and "half" not in first.payload


@pytest.mark.asyncio
async def test_concurrent_period_save(db_session: AsyncSession, test_db_engine: AsyncEngine) -> None:
    actor_id, lab_id, _source_id = await seed_source(db_session)
    ring = keyring()
    preview = await preview_report(
        db_session,
        actor_id,
        "session-a",
        ReportPreviewParams(laboratory_id=lab_id, date_from=date(2026, 1, 1), date_to=date(2026, 6, 30)),
        keyring=ring,
        now=NOW,
    )
    factory = async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False)

    async def attempt(key: str) -> str:
        async with factory() as session:
            try:
                await save_report(
                    CommandContext(actor_id=actor_id, idempotency_key=key),
                    preview,
                    codes(),
                    session_id="session-a",
                    db=session,
                    keyring=ring,
                    now=NOW,
                )
                await session.commit()
                return "created"
            except ProblemError as exc:
                await session.rollback()
                return exc.code

    assert sorted(await asyncio.gather(attempt("concurrent-a"), attempt("concurrent-b"))) == [
        "REPORT_PERIOD_EXISTS",
        "created",
    ]


def test_key_rotation_grace_and_100k_payload_budget() -> None:
    retired_at = NOW - timedelta(hours=1)
    old = SigningKey("old", b"o" * 32, ACTIVATED, retired_at=retired_at)
    ring = PreviewKeyring(SigningKey("new", b"n" * 32, NOW - timedelta(hours=1)), (old,))
    assert ring.verification_key("old", retired_at + OLD_KEY_GRACE) is old
    assert ring.verification_key("old", retired_at + OLD_KEY_GRACE + timedelta(microseconds=1)) is None

    payload = {"sources": [[uuid.uuid4().hex, 1, [[0, 1, "1"]]] for _ in range(100_000)]}
    assert len(canonical_json(payload)) <= MAX_PAYLOAD_BYTES


def test_production_requires_shared_keyring() -> None:
    with pytest.raises(RuntimeError, match="REPORT_PREVIEW_KEYS"):
        PreviewKeyring.from_settings(Settings(environment=EnvironmentOption.PRODUCTION, report_preview_keys=None))

    configured = PreviewKeyring.from_settings(
        Settings(
            environment=EnvironmentOption.PRODUCTION,
            report_preview_keys=json.dumps(
                {
                    "active": "new",
                    "keys": [
                        {
                            "id": "new",
                            "secret": base64.urlsafe_b64encode(b"n" * 32).decode().rstrip("="),
                            "activated_at": NOW.isoformat(),
                        }
                    ],
                }
            ),
        )
    )
    assert configured.active.key_id == "new"
