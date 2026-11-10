"""A03 tests: the immutable verified receipt boundary (DATA-06 / FT-ARR-12/14/15).

Named plan tests:

- ``test_evidence_gate`` — UNKNOWN / UTILIZED-only / different receiver /
  incomplete partial composition never create a confirmation, and a party
  without real evidence is blocked with an explicit reason (never silent
  success);
- ``test_duplicate_evidence`` — a re-confirmation of the same external
  operation is idempotent (one fact, no second row, no revision churn); an
  incompatible new confirmation is rejected, never an overwrite;
- ``test_freeze_after_confirmation`` — the confirmation freezes the accepted
  composition and the reconciliation state atomically; afterwards a stale PUT
  answers 409 REVISION_CONFLICT and a current PUT 409 STATE_CONFLICT;
- ``test_routes`` — positive + local ВСЭ required → EXAMINATION; previous
  ВСЭ sufficient → CONCLUSION; full return → NONE (no examination);
- ``test_confirmation_survives_deletion`` — deleting the reconciliation (or a
  ВСЭ) never erases the frozen fact;
- ``test_no_http_force_success`` — no HTTP surface accepts verified evidence
  or a client-provided ``verified`` flag (port closure, API-04).

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.confirmation import (
    downstream_route,
    ensure_confirmed,
)
from backend.src.modules.arrivals.models import Party, ReceiptConfirmation, Reconciliation
from backend.src.modules.arrivals.reconciliation import save_reconciliation
from backend.src.modules.arrivals.schemas import (
    Comparison,
    Inspection,
    QuantitySet,
    ReconciliationWrite,
    Repeat,
    ReturnReason,
    Transaction,
)
from backend.src.modules.arrivals.schemas import (
    IncomingDocument as IncomingDocumentInput,
)
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_import_and_queues import (
    UNIT_KG,
    actor,  # noqa: F401
    document,
    lab,  # noqa: F401
)
from backend.tests.fixtures.receipt_evidence import (
    FixtureReceiptEvidenceReader,
    confirm_via_reader,
    receipt_evidence,
)


async def _import(db: AsyncSession, evsd_uuid: uuid.UUID, laboratory_id: uuid.UUID, **kwargs: object) -> Party:
    party = await commands.upsert_incoming(db, document(evsd_uuid, laboratory_id, **kwargs))
    await db.commit()
    return party


def document_with_previous(
    evsd_uuid: uuid.UUID,
    laboratory_id: uuid.UUID,
    **kwargs: object,
) -> IncomingDocumentInput:
    """The default fixture plus a previous-ВСЭ record (linked veterinary document)."""
    base = document(evsd_uuid, laboratory_id, **kwargs)
    with_previous = base.snapshot.model_copy(
        update={
            "vet_documents": [
                {
                    "previousNumber": "ВСЭ-000111",
                    "previousStamp": "КМ-77",
                    "previousPerformedOn": "2026-11-05",
                    "previousOrganization": "Районная СБЖ",
                    "previousResult": "Пригодно",
                    "previousConclusion": "Без патологий",
                }
            ]
        }
    )
    return IncomingDocumentInput(
        contour=base.contour,
        evsd_uuid=base.evsd_uuid,
        laboratory_id=base.laboratory_id,
        external_status=base.external_status,
        snapshot=with_previous,
        fetched_at=base.fetched_at,
    )


async def _save_reconciliation(
    db: AsyncSession,
    actor_id: uuid.UUID,
    party_id: uuid.UUID,
    payload: object,
    expected_revision: int,
) -> None:
    ctx = CommandContext(actor_id=actor_id, idempotency_key=str(uuid.uuid4()), expected_revision=expected_revision)
    await save_reconciliation(ctx, party_id, payload, uow=db)  # type: ignore[arg-type]
    await db.commit()


def real_payload(**overrides: object) -> ReconciliationWrite:
    """A complete ACCEPT_ALL baseline against the real fixture snapshot.

    The default snapshot carries exactly eight compared fields
    (sender/receiver enterprise, vehicle, product type/product/name,
    quantity, mass); the informational owner/species fields are absent, so
    marking them would be a fictitious mark (blocking).
    """
    base: dict[str, object] = {
        "checks": {
            "CHK-F05": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=True),
        },
        "inspection": Inspection(compartment="COMPLIANT", joint_carriage="NONE"),
        "delivered": QuantitySet(mass_kg="120.0", quantity="4", unit_id=str(UNIT_KG)),
        "accepted": QuantitySet(mass_kg="120.0", quantity="4", unit_id=str(UNIT_KG)),
        "returned": QuantitySet(mass_kg="0", quantity="0", unit_id=str(UNIT_KG)),
        "decision": "ACCEPT_ALL",
        "transaction": Transaction(planned=False, type=None),
        "fair": False,
        "services": [],
    }
    base.update(overrides)
    return ReconciliationWrite.model_validate(base)


async def _confirmation_count(db: AsyncSession, party_id: uuid.UUID) -> int:
    return int(
        (
            await db.execute(
                select(func.count()).select_from(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party_id)
            )
        ).scalar_one()
    )


# --- evidence gate (FT-ARR-14) ---------------------------------------------------


async def test_evidence_gate(db_session: AsyncSession, lab, actor) -> None:  # noqa: F811 - pytest fixtures
    """UNKNOWN / UTILIZED-only / foreign receiver / incomplete partial never confirm."""
    evsd = uuid.uuid4()
    party = await _import(db_session, evsd, lab.id)
    party_id = party.id
    reader = FixtureReceiptEvidenceReader()

    # The reader's absence (UNKNOWN external result) plants no fact at all.
    reader.plant(party_id, None)
    assert await confirm_via_reader(db_session, reader, party_id) is None
    await db_session.rollback()
    assert await _confirmation_count(db_session, party_id) == 0

    for status in ("UNKNOWN", "UTILIZED"):
        reader.plant(party_id, receipt_evidence(evsd, external_status=status))
        with pytest.raises(ProblemError) as raised:
            await confirm_via_reader(db_session, reader, party_id)
        assert raised.value.status == 422
        assert raised.value.code == "INTEGRATION_EVIDENCE_INCOMPLETE"
        await db_session.rollback()
        assert await _confirmation_count(db_session, party_id) == 0

    # A receipt fact of another receiver never confirms this arrival.
    reader.plant(party_id, receipt_evidence(evsd, receiver_enterprise_id=str(uuid.uuid4())))
    with pytest.raises(ProblemError) as raised:
        await confirm_via_reader(db_session, reader, party_id)
    assert raised.value.status == 422
    assert raised.value.code == "INTEGRATION_EVIDENCE_INCOMPLETE"
    await db_session.rollback()
    assert await _confirmation_count(db_session, party_id) == 0

    # PARTIALLY without the full composition (no returned part) is refused.
    reader.plant(party_id, receipt_evidence(evsd, decision="PARTIALLY", returned_mass_kg=None, returned_quantity=None))
    with pytest.raises(ProblemError) as raised:
        await confirm_via_reader(db_session, reader, party_id)
    assert raised.value.status == 422
    assert raised.value.code == "INTEGRATION_EVIDENCE_INCOMPLETE"
    await db_session.rollback()
    assert await _confirmation_count(db_session, party_id) == 0

    # Missing real evidence blocks dependent commands with an explicit reason.
    with pytest.raises(ProblemError) as gate:
        await downstream_route(db_session, party_id)
    assert gate.value.status == 422
    assert gate.value.code == "RECEIPT_NOT_CONFIRMED"
    assert "подтвержд" in gate.value.detail
    with pytest.raises(ProblemError) as blocked:
        await ensure_confirmed(db_session, party_id)
    assert blocked.value.code == "RECEIPT_NOT_CONFIRMED"


# --- duplicate evidence (DATA-06 operation/fingerprint dedup) ---------------------


async def test_duplicate_evidence(db_session: AsyncSession, lab, actor) -> None:  # noqa: F811 - pytest fixtures
    """A safe re-confirmation is idempotent; an incompatible one is rejected."""
    evsd = uuid.uuid4()
    party = await _import(db_session, evsd, lab.id)
    pid = party.id
    await _save_reconciliation(db_session, actor, pid, real_payload(), party.rev)
    party_rev_before = (await db_session.execute(select(Party).where(Party.id == pid))).scalar_one().rev

    evidence = receipt_evidence(evsd)
    reader = FixtureReceiptEvidenceReader()
    reader.plant(pid, evidence)
    first = await confirm_via_reader(db_session, reader, pid)
    await db_session.commit()
    assert first is not None
    first_id, first_fingerprint = first.id, first.fingerprint
    assert await _confirmation_count(db_session, pid) == 1
    party_after_first = (await db_session.execute(select(Party).where(Party.id == pid))).scalar_one()
    assert party_after_first.rev == party_rev_before + 1

    # The same evidence again: one fact, no second row, no revision churn.
    second = await confirm_via_reader(db_session, reader, pid)
    await db_session.commit()
    assert second is not None and second.id == first_id
    assert await _confirmation_count(db_session, pid) == 1
    party_after_second = (await db_session.execute(select(Party).where(Party.id == pid))).scalar_one()
    assert party_after_second.rev == party_rev_before + 1

    # A different external operation with the same composition is another
    # fingerprint: the frozen fact is never overwritten — it is rejected.
    reader.plant(pid, receipt_evidence(evsd, operation_id=uuid.uuid4()))
    with pytest.raises(ProblemError) as raised:
        await confirm_via_reader(db_session, reader, pid)
    assert raised.value.status == 409
    assert raised.value.code == "STATE_CONFLICT"
    await db_session.rollback()
    stored = (
        await db_session.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == pid))
    ).scalar_one()
    assert stored.id == first_id
    assert stored.fingerprint == first_fingerprint
    assert await _confirmation_count(db_session, pid) == 1


# --- freeze after confirmation (FT-ARR-15) ----------------------------------------


async def test_freeze_after_confirmation(arrivals_vet_env) -> None:  # noqa: F811 - pytest fixture
    """The frozen composition wins; afterwards the reconciliation is immutable."""
    env = arrivals_vet_env
    evsd = uuid.uuid4()
    party = await commands.upsert_incoming(env.db, document(evsd, env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    pid = party.id
    await _save_reconciliation(env.db, env.vet.id, pid, real_payload(), party.rev)  # type: ignore[attr-defined]
    row = (await env.db.execute(select(Reconciliation).where(Reconciliation.party_id == pid))).scalar_one()
    assert row.state == "OPEN" and row.rev == 1
    party_rev_before = (await env.db.execute(select(Party).where(Party.id == pid))).scalar_one().rev

    reader = FixtureReceiptEvidenceReader()
    reader.plant(pid, receipt_evidence(evsd))
    confirmation = await confirm_via_reader(env.db, reader, pid)
    await env.db.commit()
    assert confirmation is not None

    row = (await env.db.execute(select(Reconciliation).where(Reconciliation.party_id == pid))).scalar_one()
    assert row.state == "CONFIRMED"
    assert row.completed_at is not None
    assert row.rev == 2
    # The external fact freezes the accepted composition atomically.
    assert Decimal(row.accepted_mass_kg) == Decimal("120.0")  # type: ignore[arg-type]
    assert Decimal(row.accepted_quantity) == Decimal("4")  # type: ignore[arg-type]
    assert Decimal(row.returned_quantity) == Decimal("0")  # type: ignore[arg-type]
    party_after = (await env.db.execute(select(Party).where(Party.id == pid))).scalar_one()
    assert party_after.rev == party_rev_before + 1

    # The API surface honours the freeze: a stale PUT answers the revision
    # conflict, a current PUT answers the frozen state (SPEC-04/FT-ARR-15).
    body = {
        "checks": {"CHK-F05": {"matches": True}, "CHK-F07": {"matches": True}},
        "delivered": {"mass_kg": "120.0", "quantity": "4", "unit_id": str(UNIT_KG)},
        "accepted": {"mass_kg": "120.0", "quantity": "4", "unit_id": str(UNIT_KG)},
        "returned": {"mass_kg": "0", "quantity": "0", "unit_id": str(UNIT_KG)},
        "decision": "ACCEPT_ALL",
        "transaction": {"planned": False, "type": None},
        "fair": False,
        "services": [],
    }
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        base_headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
        }
        stale = await http.put(
            f"/api/v1/arrivals/{pid}/reconciliation",
            json=body,
            headers={**base_headers, "if-match": '"1"'},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "REVISION_CONFLICT"

        current = await http.put(
            f"/api/v1/arrivals/{pid}/reconciliation",
            json=body,
            headers={**base_headers, "idempotency-key": str(uuid.uuid4()), "if-match": '"2"'},
        )
        assert current.status_code == 409
        assert current.json()["code"] == "STATE_CONFLICT"

        # The frozen accepted composition is what the read model shows.
        view = await http.get(f"/api/v1/arrivals/{pid}/reconciliation")
        assert view.status_code == 200
        assert view.json()["state"] == "CONFIRMED"
        assert view.json()["accepted"]["mass_kg"] == "120.000000"
        assert view.json()["route"] == "EXAMINATION"


# --- downstream routes (FT-ARR-12) ------------------------------------------------


async def test_routes(db_session: AsyncSession, lab, actor) -> None:  # noqa: F811 - pytest fixtures
    """positive + local ВСЭ required → create; previous sufficient → conclusion; return → none."""
    # 1. Positive confirmation, no previous ВСЭ → the local examination route.
    party_local = await _import(db_session, uuid.uuid4(), lab.id)
    await _save_reconciliation(db_session, actor, party_local.id, real_payload(), party_local.rev)
    reader = FixtureReceiptEvidenceReader()
    evsd_local = await _evsd(db_session, party_local.id)
    reader.plant(party_local.id, receipt_evidence(evsd_local))
    assert await confirm_via_reader(db_session, reader, party_local.id) is not None
    await db_session.commit()
    assert await downstream_route(db_session, party_local.id) == "EXAMINATION"
    confirmed = await ensure_confirmed(db_session, party_local.id)
    assert confirmed.party_id == party_local.id

    # 2. Previous ВСЭ sufficient (repeat not required) → the conclusion route.
    party_prev = await _import_with_previous(db_session, uuid.uuid4(), lab.id)
    payload_with_repeat = real_payload(repeat=Repeat(required=False))
    await _save_reconciliation(db_session, actor, party_prev.id, payload_with_repeat, party_prev.rev)
    evsd_prev = await _evsd(db_session, party_prev.id)
    reader.plant(party_prev.id, receipt_evidence(evsd_prev))
    assert await confirm_via_reader(db_session, reader, party_prev.id) is not None
    await db_session.commit()
    assert await downstream_route(db_session, party_prev.id) == "CONCLUSION"

    # 3. Full return → no examination is ever created.
    party_return = await _import(db_session, uuid.uuid4(), lab.id)
    return_payload = real_payload(
        decision="RETURN_ALL",
        accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=str(UNIT_KG)),
        returned=QuantitySet(mass_kg="120.0", quantity="4", unit_id=str(UNIT_KG)),
        return_reason=ReturnReason(code="DEFECTIVE_GOODS"),
    )
    await _save_reconciliation(db_session, actor, party_return.id, return_payload, party_return.rev)
    evsd_return = await _evsd(db_session, party_return.id)
    reader.plant(party_return.id, receipt_evidence(evsd_return, decision="RETURN_ALL"))
    assert await confirm_via_reader(db_session, reader, party_return.id) is not None
    await db_session.commit()
    assert await downstream_route(db_session, party_return.id) == "NONE"


async def test_confirmation_survives_deletion(db_session: AsyncSession, lab, actor) -> None:  # noqa: F811 - pytest fixtures
    """Deleting the reconciliation (or a later ВСЭ) never erases the frozen fact
    nor the frozen route decision (DATA-02 / FT-ARR-12)."""
    reader = FixtureReceiptEvidenceReader()

    # 1. A local-ВСЭ party keeps its EXAMINATION route after deletion.
    evsd = uuid.uuid4()
    party = await _import(db_session, evsd, lab.id)
    await _save_reconciliation(db_session, actor, party.id, real_payload(), party.rev)
    reader.plant(party.id, receipt_evidence(evsd))
    confirmation = await confirm_via_reader(db_session, reader, party.id)
    await db_session.commit()
    assert confirmation is not None

    row = (await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party.id))).scalar_one()
    await db_session.delete(row)
    await db_session.commit()

    stored = (
        await db_session.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party.id))
    ).scalar_one()
    assert stored.id == confirmation.id
    assert await downstream_route(db_session, party.id) == "EXAMINATION"

    # 2. A previous-sufficient party keeps its CONCLUSION route: the decision
    # is frozen into the confirmation, an audit-row deletion never degrades it.
    evsd_prev = uuid.uuid4()
    party_prev = await _import_with_previous(db_session, evsd_prev, lab.id)
    await _save_reconciliation(
        db_session, actor, party_prev.id, real_payload(repeat=Repeat(required=False)), party_prev.rev
    )
    reader.plant(party_prev.id, receipt_evidence(evsd_prev))
    confirmed_prev = await confirm_via_reader(db_session, reader, party_prev.id)
    await db_session.commit()
    assert confirmed_prev is not None and confirmed_prev.previous_sufficient is True
    assert await downstream_route(db_session, party_prev.id) == "CONCLUSION"

    row_prev = (
        await db_session.execute(select(Reconciliation).where(Reconciliation.party_id == party_prev.id))
    ).scalar_one()
    await db_session.delete(row_prev)
    await db_session.commit()
    assert (
        await db_session.execute(select(ReceiptConfirmation).where(ReceiptConfirmation.party_id == party_prev.id))
    ).scalar_one() is not None
    assert await downstream_route(db_session, party_prev.id) == "CONCLUSION"


# --- cross-party operation dedup (DATA-06 operation identity) ----------------------


async def test_cross_party_operation_dedup(db_session: AsyncSession, lab, actor) -> None:  # noqa: F811 - pytest fixtures
    """One external operation proves one receipt: reuse on another party is an
    honest 409 problem before any insert — never a raw IntegrityError."""
    operation = uuid.uuid4()
    reader = FixtureReceiptEvidenceReader()

    evsd_a = uuid.uuid4()
    party_a = await _import(db_session, evsd_a, lab.id)
    pid_a, pid_b = party_a.id, None
    evidence_a = receipt_evidence(evsd_a, operation_id=operation)
    reader.plant(pid_a, evidence_a)
    confirmed_a = await confirm_via_reader(db_session, reader, pid_a)
    await db_session.commit()
    assert confirmed_a is not None
    confirmed_a_id = confirmed_a.id

    # A second party (a re-imported arrival with its own party PK) replays the
    # same external operation: refused with the stable problem, no row written.
    evsd_b = uuid.uuid4()
    party_b = await _import(db_session, evsd_b, lab.id)
    pid_b = party_b.id
    reader.plant(pid_b, receipt_evidence(evsd_b, operation_id=operation))
    with pytest.raises(ProblemError) as raised:
        await confirm_via_reader(db_session, reader, pid_b)
    assert raised.value.status == 409
    assert raised.value.code == "STATE_CONFLICT"
    assert "другого поступления" in raised.value.detail
    await db_session.rollback()
    assert await _confirmation_count(db_session, pid_b) == 0
    assert await _confirmation_count(db_session, pid_a) == 1

    # The idempotent same-party repeat still answers the one fact.
    reader.plant(pid_a, evidence_a)
    replay = await confirm_via_reader(db_session, reader, pid_a)
    await db_session.commit()
    assert replay is not None and replay.id == confirmed_a_id
    assert await _confirmation_count(db_session, pid_a) == 1


# --- port closure: no HTTP force-success (API-04 / DATA-06) ------------------------


async def test_no_http_force_success(arrivals_vet_env) -> None:  # noqa: F811 - pytest fixture
    """No endpoint accepts verified evidence or a client ``verified`` flag."""
    env = arrivals_vet_env
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
            "if-match": '"1"',
        }
        unit = str(UNIT_KG)
        forged = {
            "verified": True,
            "checks": {"CHK-F05": {"matches": True}, "CHK-F07": {"matches": True}},
            "delivered": {"mass_kg": "120.0", "quantity": "4", "unit_id": unit},
            "accepted": {"mass_kg": "120.0", "quantity": "4", "unit_id": unit},
            "returned": {"mass_kg": "0", "quantity": "0", "unit_id": unit},
            "decision": "ACCEPT_ALL",
            "transaction": {"planned": False, "type": None},
            "fair": False,
            "services": [],
        }
        refused = await http.put(
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=forged,
            headers=headers,  # type: ignore[attr-defined]
        )
        assert refused.status_code == 422
        assert refused.json()["code"] == "VALIDATION_ERROR"

        # W01 provides an intent endpoint, but its strict schema never accepts
        # external evidence or a client-supplied operation id.  Fabricated
        # confirmation input is rejected before any intent/outbox write.
        forced = await http.post(
            f"/api/v1/arrivals/{party.id}/receipt",
            json={"verified": True, "operation_id": str(uuid.uuid4())},
            headers=headers,  # type: ignore[attr-defined]
        )
        assert forced.status_code == 422
        assert forced.json()["code"] == "VALIDATION_ERROR"

    from backend.src.interfaces.main import app

    spec = app.openapi()
    assert "ReceiptEvidence" not in spec.get("components", {}).get("schemas", {})


# --- helpers ----------------------------------------------------------------------


async def _import_with_previous(db: AsyncSession, evsd: uuid.UUID, laboratory_id: uuid.UUID) -> Party:
    party = await commands.upsert_incoming(db, document_with_previous(evsd, laboratory_id))
    await db.commit()
    return party


async def _evsd(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID:
    from backend.tests.fixtures.receipt_evidence import party_evsd_uuid

    return await party_evsd_uuid(db, party_id)
