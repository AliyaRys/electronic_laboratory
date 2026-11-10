"""W02 fault semantics that prohibit blind repeat of a legal write."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals.models import IncomingDocument, Party, ReceiptConfirmation, Reconciliation
from backend.src.modules.identity.models import Laboratory, OutboxEntry, Territory, User
from backend.src.modules.integrations.vetis.contracts import UserConfirmation
from backend.src.modules.integrations.vetis.models import (
    VetisBinding,
    VetisContour,
    VetisOperation,
    VetisOperationState,
    VetisSourceDocument,
)
from backend.src.modules.integrations.vetis.polling import MAX_PROCESSING, poll_delay
from backend.src.modules.integrations.vetis.receipt import build_receipt_preview, queue_receipt
from backend.src.modules.integrations.vetis.worker import run_receipt_operation
from backend.tests.vetis.test_receipt_mapping import SOURCE_EVSD, SOURCE_RECEIVER, SOURCE_UNIT, SOURCE_XML


@pytest.fixture
async def receipt_env(db_session: AsyncSession, test_db_engine) -> SimpleNamespace:
    territory = Territory(name="Тестовая территория")
    db_session.add(territory)
    await db_session.flush()
    lab = Laboratory(territory_id=territory.id, name="Тестовая лаборатория", address="адрес", organization="ГБУ")
    actor = User(
        login=f"vet-{uuid.uuid4()}",
        full_name="Ветеринар fixture",
        email=f"{uuid.uuid4()}@example.test",
        password_hash="fixture",
        role="VET",
    )
    db_session.add_all([lab, actor])
    await db_session.flush()
    enterprise = SOURCE_RECEIVER
    member = str(uuid.uuid4())
    unit = SOURCE_UNIT
    evsd = SOURCE_EVSD
    document = IncomingDocument(
        contour=VetisContour.PILOT,
        evsd_uuid=evsd,
        laboratory_id=lab.id,
        external_status="CONFIRMED",
        source_snapshot={
            "vdDocument": {
                "type": "TRANSPORT",
                "status": "CONFIRMED",
                "issueNumber": "FIXTURE-1",
                "consignor": {"name": "Поставщик"},
                "consignee": {"name": "Получатель", "enterprise": {"guid": enterprise}},
                "batch": {
                    "product": {"guid": str(uuid.uuid4()), "name": "Мясо"},
                    "volume": "100",
                    "quantity": "100",
                    "unit": {"guid": unit, "name": "кг"},
                },
            },
            "vetDocuments": [],
        },
        content_hash="c" * 64,
        fetched_at=datetime.now(UTC),
    )
    db_session.add(document)
    await db_session.flush()
    party = Party(
        incoming_document_id=document.id,
        laboratory_id=lab.id,
        classification_snapshot={"product": {"name": "Мясо"}},
    )
    db_session.add(party)
    await db_session.flush()
    reconciliation = Reconciliation(
        party_id=party.id,
        checks={"CHK-F35": {"matches": True, "actual": "OTHER_REASON", "reason": "fixture reason"}},
        delivered_mass_kg=100,
        delivered_quantity=100,
        delivered_unit_id=unit,
        accepted_mass_kg=80,
        accepted_quantity=80,
        accepted_unit_id=unit,
        returned_mass_kg=20,
        returned_quantity=20,
        returned_unit_id=unit,
        decision="PARTIAL",
        fair=False,
        services=[],
        actor_id=actor.id,
        state="OPEN",
        rev=2,
    )
    raw = SOURCE_XML
    db_session.add_all(
        [
            reconciliation,
            VetisBinding(
                laboratory_id=lab.id,
                contour=VetisContour.PILOT,
                business_member_id=member,
                enterprise_id=enterprise,
                initiator="fixture-vet",
            ),
            VetisSourceDocument(
                contour=VetisContour.PILOT,
                evsd_uuid=evsd,
                laboratory_id=lab.id,
                raw_xml=raw,
                checksum=hashlib.sha256(raw.encode()).hexdigest(),
                revision=3,
            ),
        ]
    )
    await db_session.commit()
    return SimpleNamespace(
        db=db_session,
        party=party,
        reconciliation=reconciliation,
        actor=actor,
        factory=async_sessionmaker(test_db_engine, class_=AsyncSession, expire_on_commit=False),
    )


def test_poll_schedule_and_fifteen_minute_unknown_boundary() -> None:
    assert [poll_delay(i).total_seconds() for i in range(7)] == [2, 5, 10, 30, 60, 60, 60]
    assert timedelta(minutes=15) == MAX_PROCESSING


def test_submit_recovery_contract_is_explicit_in_worker_source() -> None:
    """Regression guard: SUBMITTING without app id must never call submit again."""
    from inspect import getsource

    from backend.src.modules.integrations.vetis.worker import run_receipt_operation

    source = getsource(run_receipt_operation)
    recovery = source.index("VetisOperationState.SUBMITTING and not operation.application_id")
    send = source.index("transport.send_application")
    assert recovery < send
    assert "VETIS_SUBMIT_OUTCOME_UNKNOWN" in source
    assert "state = VetisOperationState.UNKNOWN" in source


async def test_disabled_capability_creates_no_intent_or_outbox(receipt_env: SimpleNamespace, monkeypatch) -> None:
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "false")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="UNSUPERVISED",
    )
    with pytest.raises(ProblemError) as error:
        await queue_receipt(
            receipt_env.db,
            preview=preview,
            confirmation=UserConfirmation(
                actor_id=receipt_env.actor.id,
                fingerprint=preview.fingerprint,
                confirmed_at=datetime.now(UTC),
            ),
        )
    assert error.value.code == "INTEGRATION_WRITE_DISABLED"
    assert (await receipt_env.db.execute(select(func.count()).select_from(OutboxEntry))).scalar_one() == 0


async def test_enabled_confirmation_freezes_one_intent_and_outbox(receipt_env: SimpleNamespace, monkeypatch) -> None:
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
    )
    repeated = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        delivery_date=preview.intent.delivery_date,
    )
    assert repeated.fingerprint == preview.fingerprint
    confirmation = UserConfirmation(
        actor_id=receipt_env.actor.id,
        fingerprint=preview.fingerprint,
        confirmed_at=datetime.now(UTC),
    )
    operation = await queue_receipt(receipt_env.db, preview=preview, confirmation=confirmation)
    same = await queue_receipt(receipt_env.db, preview=preview, confirmation=confirmation)
    await receipt_env.db.commit()
    assert same.id == operation.id
    assert operation.local_transaction_id != operation.application_id
    assert (await receipt_env.db.execute(select(func.count()).select_from(OutboxEntry))).scalar_one() == 1


async def test_lost_submit_response_becomes_unknown_without_resubmit(receipt_env: SimpleNamespace, monkeypatch) -> None:
    class LostResponse:
        def __init__(self) -> None:
            self.sends = 0

        async def send_application(self, application_xml: str) -> str:
            self.sends += 1
            raise TimeoutError("fixture: response lost")

        async def receive_result(self, application_id: str) -> str:
            raise AssertionError("application id was not received")

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
    )
    operation = await queue_receipt(
        receipt_env.db,
        preview=preview,
        confirmation=UserConfirmation(
            actor_id=receipt_env.actor.id,
            fingerprint=preview.fingerprint,
            confirmed_at=datetime.now(UTC),
        ),
    )
    await receipt_env.db.commit()
    transport = LostResponse()
    await run_receipt_operation(operation.id, transport=transport, session_factory=receipt_env.factory)
    await run_receipt_operation(operation.id, transport=transport, session_factory=receipt_env.factory)
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        assert saved is not None
        assert saved.state == VetisOperationState.UNKNOWN
        assert saved.application_id is None
    assert transport.sends == 1


async def test_confirmed_result_is_idempotent_and_opens_gate_once(receipt_env: SimpleNamespace, monkeypatch) -> None:
    class ConfirmedTransport:
        def __init__(self, source_uuid: uuid.UUID, receiver: str) -> None:
            self.sends = 0
            self.source_uuid = source_uuid
            self.receiver = receiver

        async def send_application(self, application_xml: str) -> str:
            self.sends += 1
            assert "processIncomingConsignmentRequest" in application_xml
            return "fixture-application-id"

        async def receive_result(self, application_id: str) -> str:
            assert application_id == "fixture-application-id"
            return f"""<response><status>COMPLETED</status><processIncomingConsignmentResponse>
              <sourceVetDocumentUuid>{self.source_uuid}</sourceVetDocumentUuid>
              <receiverEnterpriseGuid>{self.receiver}</receiverEnterpriseGuid>
              <acceptedConsignment><volume>80</volume></acceptedConsignment>
              <returnedDelivery><volume>20</volume></returnedDelivery>
            </processIncomingConsignmentResponse></response>"""

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
    )
    operation = await queue_receipt(
        receipt_env.db,
        preview=preview,
        confirmation=UserConfirmation(
            actor_id=receipt_env.actor.id,
            fingerprint=preview.fingerprint,
            confirmed_at=datetime.now(UTC),
        ),
    )
    await receipt_env.db.commit()
    transport = ConfirmedTransport(preview.intent.source_evsd_uuid, preview.intent.receiver_enterprise_id)
    await run_receipt_operation(operation.id, transport=transport, session_factory=receipt_env.factory)
    async with receipt_env.factory() as db:
        await db.execute(delete(ReceiptConfirmation).where(ReceiptConfirmation.party_id == receipt_env.party.id))
        await db.commit()
    # Durable operation evidence restores a locally lost projection without a
    # second external submit or poll.
    await run_receipt_operation(operation.id, transport=transport, session_factory=receipt_env.factory)
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        confirmations = (await db.execute(select(func.count()).select_from(ReceiptConfirmation))).scalar_one()
        assert saved is not None
        assert saved.state == VetisOperationState.CONFIRMED
        assert confirmations == 1
    assert transport.sends == 1


async def test_processing_timeout_becomes_unknown_without_network(receipt_env: SimpleNamespace, monkeypatch) -> None:
    class NoNetwork:
        async def send_application(self, application_xml: str) -> str:
            raise AssertionError("must not resubmit")

        async def receive_result(self, application_id: str) -> str:
            raise AssertionError("expired operation must not poll")

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
    )
    operation = await queue_receipt(
        receipt_env.db,
        preview=preview,
        confirmation=UserConfirmation(
            actor_id=receipt_env.actor.id,
            fingerprint=preview.fingerprint,
            confirmed_at=datetime.now(UTC),
        ),
    )
    operation.state = VetisOperationState.PROCESSING
    operation.application_id = "fixture-expired"
    operation.submitted_at = datetime.now(UTC) - timedelta(minutes=16)
    await receipt_env.db.commit()
    await run_receipt_operation(operation.id, transport=NoNetwork(), session_factory=receipt_env.factory)
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        assert saved is not None
        assert saved.state == VetisOperationState.UNKNOWN
        assert saved.problem_code == "VETIS_RESULT_TIMEOUT"
