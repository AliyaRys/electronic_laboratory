"""W02 fault semantics that prohibit blind repeat of a legal write."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
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
from backend.src.modules.integrations.vetis.transport import TransportOutcome, VetisTransportError
from backend.src.modules.integrations.vetis.worker import (
    resolve_unknown_receipt_not_applied,
    run_receipt_operation,
)
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
        classification_snapshot={"product": {"id": "product-1", "name": "Мясо"}},
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
        return_date=datetime.now(UTC),
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
        return_date=datetime.now(UTC),
    )
    repeated = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        delivery_date=preview.intent.delivery_date,
        return_date=preview.intent.return_date,
        issue_date=preview.intent.issue_date,
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


async def test_documentary_quantity_without_package_source_is_absent(receipt_env: SimpleNamespace, monkeypatch) -> None:
    """ТЗ DR8 §13: the intent keeps the documentary quantity ABSENT when the
    source carries no package quantity — the mass is never a fallback."""
    import copy as _copy

    document = await receipt_env.db.get(IncomingDocument, receipt_env.party.incoming_document_id)
    assert document is not None
    snapshot = _copy.deepcopy(document.source_snapshot)
    snapshot["vdDocument"]["batch"].pop("quantity", None)  # type: ignore[union-attr,index]
    document.source_snapshot = snapshot
    await receipt_env.db.commit()
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
    )
    assert preview.intent.documentary_quantity is None
    assert preview.intent.documentary_mass_kg == Decimal("100")  # mass stays intact


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
        return_date=datetime.now(UTC),
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


async def test_soap_fault_is_rejected_not_unknown(receipt_env: SimpleNamespace, monkeypatch) -> None:
    class Rejected:
        async def send_application(self, application_xml: str) -> str:
            raise VetisTransportError(
                code="VETIS_SOAP_FAULT",
                detail="Incorrect request fixture",
                outcome=TransportOutcome.DEFINITE_REJECTION,
            )

        async def receive_result(self, application_id: str) -> str:
            raise AssertionError("rejected submit has no application id")

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
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
    await run_receipt_operation(operation.id, transport=Rejected(), session_factory=receipt_env.factory)
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        assert saved is not None
        assert saved.state == VetisOperationState.REJECTED
        assert saved.problem_code == "VETIS_SOAP_FAULT"
        assert saved.problem_detail == "Incorrect request fixture"


async def test_unknown_is_closed_only_after_fresh_confirmed_read(receipt_env: SimpleNamespace, monkeypatch) -> None:
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
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
    operation.state = VetisOperationState.UNKNOWN
    operation.problem_code = "VETIS_SUBMIT_OUTCOME_UNKNOWN"
    await receipt_env.db.commit()

    class FreshConfirmed:
        async def get_document_status(self, evsd_uuid, initiator):  # type: ignore[no-untyped-def]
            return "CONFIRMED"

    resolved = await resolve_unknown_receipt_not_applied(
        operation.id,
        adapter=FreshConfirmed(),  # type: ignore[arg-type]
        session_factory=receipt_env.factory,
    )
    assert resolved is True
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        assert saved is not None
        assert saved.state == VetisOperationState.REJECTED
        assert saved.problem_code == "VETIS_SUBMIT_NOT_APPLIED"

    retry = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
    )
    assert retry.intent.operation_id != operation.id
    assert retry.intent.local_transaction_id == str(retry.intent.operation_id)


async def test_unknown_stays_blocked_when_fresh_read_does_not_contain_document(
    receipt_env: SimpleNamespace, monkeypatch
) -> None:
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
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
    operation.state = VetisOperationState.UNKNOWN
    await receipt_env.db.commit()

    class FreshMissing:
        async def get_document_status(self, evsd_uuid, initiator):  # type: ignore[no-untyped-def]
            return "UTILIZED"

    resolved = await resolve_unknown_receipt_not_applied(
        operation.id,
        adapter=FreshMissing(),  # type: ignore[arg-type]
        session_factory=receipt_env.factory,
    )
    assert resolved is False
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        assert saved is not None
        assert saved.state == VetisOperationState.UNKNOWN


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
              <acceptedConsignment><volume>80</volume><quantity>80</quantity></acceptedConsignment>
              <returnedDelivery><volume>20</volume><quantity>20</quantity></returnedDelivery>
            </processIncomingConsignmentResponse></response>"""

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
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
        return_date=datetime.now(UTC),
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


# --- ТЗ DR38 Task 4: preview/retry/async result safety -----------------------------


async def test_preview_xml_carries_fixed_structure_and_stale_fingerprint_is_refused(
    receipt_env: SimpleNamespace, monkeypatch
) -> None:
    """ТЗ DR38 §7 Task 4: исправленный preview содержит новый XML, а старый
    (до исправления) подтверждённый fingerprint не переиспользуется."""
    from xml.etree import ElementTree as ET

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    # Документарное расхождение по весу: отметка хранится в frozen checks.
    reconciliation = await receipt_env.db.get(Reconciliation, receipt_env.reconciliation.id)
    assert reconciliation is not None
    reconciliation.checks = {
        "CHK-F21": {
            "matches": False,
            "source": "100",
            "actual": "80",
            "reason": "Фактический вес больше заявленного",
        },
        "CHK-F35": {"matches": True, "actual": "OTHER_REASON", "reason": "fixture reason"},
    }
    await receipt_env.db.commit()
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
    )
    root = ET.fromstring(preview.application_xml)
    # Новый XML: docInspection/info (MISMATCH) + discrepancyReport/description.
    info = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "info")
    assert info.text and "Вес, кг" in info.text
    description = next(node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "description")
    assert description.text == info.text
    assert not any(
        node.tag.rsplit("}", 1)[-1] == "info" and node.tag.startswith("{http://api.vetrf.ru/schema/cdm/mercury/vu")
        for node in root.iter()
    )
    # Старый подтверждённый fingerprint отвергается — подтверждение повторяется.
    with pytest.raises(ProblemError) as error:
        await queue_receipt(
            receipt_env.db,
            preview=preview,
            confirmation=UserConfirmation(
                actor_id=receipt_env.actor.id,
                fingerprint="0" * 64,
                confirmed_at=datetime.now(UTC),
            ),
        )
    assert error.value.code == "PREVIEW_CHANGED"


@pytest.mark.parametrize("state", ["QUEUED", "SUBMITTING", "PROCESSING", "UNKNOWN"])
async def test_repeat_submit_is_blocked_for_active_states(
    receipt_env: SimpleNamespace, monkeypatch, state: str
) -> None:
    """ТЗ DR38 §7 Task 4: повторный submit для активных состояний заблокирован."""
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
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
    operation.state = VetisOperationState[state]
    await receipt_env.db.commit()
    refreshed = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
        delivery_date=preview.intent.delivery_date,
        issue_date=preview.intent.issue_date,
    )
    with pytest.raises(ProblemError) as error:
        await queue_receipt(
            receipt_env.db,
            preview=refreshed,
            confirmation=UserConfirmation(
                actor_id=receipt_env.actor.id,
                fingerprint=refreshed.fingerprint,
                confirmed_at=datetime.now(UTC),
            ),
        )
    assert error.value.code == "STATE_CONFLICT"


async def test_rejected_attempt_is_terminal_and_retry_has_new_transaction_id(
    receipt_env: SimpleNamespace, monkeypatch
) -> None:
    """ТЗ DR38 §7 Task 4: REJECTED терминален; повтор создаёт новую операцию
    с новым localTransactionId и никогда не переотправляет application_id."""
    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")

    class DefiniteReject:
        def __init__(self) -> None:
            self.sends = 0

        async def send_application(self, application_xml: str) -> str:
            self.sends += 1
            raise VetisTransportError(
                code="VETIS_SOAP_FAULT",
                detail="Wrong application data format fixture",
                outcome=TransportOutcome.DEFINITE_REJECTION,
            )

        async def receive_result(self, application_id: str) -> str:
            raise AssertionError("rejected attempt must not poll")

    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
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
    transport = DefiniteReject()
    await run_receipt_operation(operation.id, transport=transport, session_factory=receipt_env.factory)
    assert transport.sends == 1
    async with receipt_env.factory() as db:
        saved = await db.get(VetisOperation, operation.id)
        assert saved is not None
        assert saved.state == VetisOperationState.REJECTED
        assert saved.problem_code == "VETIS_SOAP_FAULT"
        assert saved.problem_detail == "Wrong application data format fixture"
    # Повтор после исправления: НОВАЯ операция и НОВЫЙ localTransactionId.
    retry = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
        delivery_date=preview.intent.delivery_date,
        issue_date=preview.intent.issue_date,
    )
    assert retry.intent.operation_id != operation.id
    assert retry.intent.local_transaction_id != operation.local_transaction_id
    assert retry.intent.local_transaction_id == str(retry.intent.operation_id)


# --- ТЗ DR27 §7: the revision context contract ------------------------------------


async def test_receipt_context_returns_current_revisions(receipt_env: SimpleNamespace, monkeypatch) -> None:
    """§7.1: the context read model answers the CURRENT frozen revisions."""
    from backend.src.modules.arrivals.router import collect_receipt_context

    monkeypatch.setenv("VETIS_WRITE_ENABLED", "true")
    context = await collect_receipt_context(receipt_env.db, receipt_env.party)
    assert context.source_revision == 3
    assert context.reconciliation_revision == 2
    assert context.write_enabled is True
    assert context.operation_id is None
    assert context.operation_state is None


async def test_receipt_preview_accepts_exactly_the_current_pair(receipt_env: SimpleNamespace) -> None:
    """§7.2: a preview with the exact current (3, 2) pair builds an intent."""
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
    )
    assert preview.intent.source_revision == 3
    assert preview.intent.reconciliation_revision == 2


@pytest.mark.parametrize(
    ("source_revision", "reconciliation_revision"),
    [(3, 1), (2, 2), (4, 5)],
    ids=["stale-reconciliation", "stale-source", "both-stale"],
)
async def test_any_stale_revision_pair_is_revision_conflict_with_safe_diagnostics(
    receipt_env: SimpleNamespace, source_revision: int, reconciliation_revision: int
) -> None:
    """§7.3/§7.4: any stale revision answers 409 REVISION_CONFLICT; the
    Problem carries ONLY the two safe current-revision diagnostics (§5.2)."""
    from backend.src.modules.integrations.vetis.receipt import write_enabled  # noqa: F401 - contract visibility

    with pytest.raises(ProblemError) as error:
        await build_receipt_preview(
            receipt_env.db,
            party_id=receipt_env.party.id,
            source_revision=source_revision,
            reconciliation_revision=reconciliation_revision,
            vet_inspection="CORRESPONDS",
            return_date=datetime.now(UTC),
        )
    assert error.value.status == 409
    assert error.value.code == "REVISION_CONFLICT"
    assert error.value.extra == {
        "current_source_revision": 3,
        "current_reconciliation_revision": 2,
    }
    # No raw XML, checksum or credential ever leaks through the diagnostics.
    for key in ("raw_xml", "checksum", "application_xml", "initiator", "business_member_id"):
        assert key not in error.value.extra


async def test_source_changed_after_preview_blocks_submit_without_outbox(
    receipt_env: SimpleNamespace,
) -> None:
    """§7.5: a source bump between preview and submit re-runs the locked
    guard inside the submit path — the stale preview never queues and the
    outbox stays empty (no external write is even planned)."""
    document = await receipt_env.db.get(IncomingDocument, receipt_env.party.incoming_document_id)
    assert document is not None
    source = (
        await receipt_env.db.execute(
            select(VetisSourceDocument).where(
                VetisSourceDocument.contour == document.contour,
                VetisSourceDocument.evsd_uuid == document.evsd_uuid,
            )
        )
    ).scalar_one()
    preview = await build_receipt_preview(
        receipt_env.db,
        party_id=receipt_env.party.id,
        source_revision=3,
        reconciliation_revision=2,
        vet_inspection="CORRESPONDS",
        return_date=datetime.now(UTC),
    )
    source.revision = 4
    await receipt_env.db.commit()
    with pytest.raises(ProblemError) as error:
        # submit_receipt re-builds the preview under the party lock; this is
        # the exact call the endpoint performs before queue_receipt.
        await build_receipt_preview(
            receipt_env.db,
            party_id=receipt_env.party.id,
            source_revision=3,
            reconciliation_revision=2,
            vet_inspection="CORRESPONDS",
            return_date=datetime.now(UTC),
            issue_date=preview.intent.issue_date,
        )
    assert error.value.code == "REVISION_CONFLICT"
    assert (await receipt_env.db.execute(select(func.count()).select_from(OutboxEntry))).scalar_one() == 0


async def test_checksum_mismatch_is_not_masked_as_revision_success(receipt_env: SimpleNamespace) -> None:
    """§7.6: a damaged raw XML answers its own checksum problem even when the
    revisions match — it never silently passes the revision guard."""
    document = await receipt_env.db.get(IncomingDocument, receipt_env.party.incoming_document_id)
    assert document is not None
    source = (
        await receipt_env.db.execute(
            select(VetisSourceDocument).where(
                VetisSourceDocument.contour == document.contour,
                VetisSourceDocument.evsd_uuid == document.evsd_uuid,
            )
        )
    ).scalar_one()
    source.raw_xml = source.raw_xml + "<corrupted />"
    await receipt_env.db.commit()
    with pytest.raises(ProblemError) as error:
        await build_receipt_preview(
            receipt_env.db,
            party_id=receipt_env.party.id,
            source_revision=3,
            reconciliation_revision=2,
            vet_inspection="CORRESPONDS",
            return_date=datetime.now(UTC),
        )
    assert error.value.status == 409
    assert error.value.code == "SOURCE_CHECKSUM_MISMATCH"
