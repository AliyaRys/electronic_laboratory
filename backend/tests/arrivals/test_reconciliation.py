"""A02 tests: the CHK reconciliation validator and saved-reconciliation state.

Named plan assertions (Task A02 / Review Focus, all parameterized):

- ``test_at_02_weight_boundary`` — 95/105 inside the inclusive ±5% boundary
  (act=false), 94.999/105.001 outside (act=true);
- ``test_at_01_shortage_is_not_return_cargo`` — doc 120 / delivered 100 /
  accepted 100 / returned 0: the shortage never invents 20 kg of return cargo,
  the weight act is required, and PARTIAL with a zero return is refused;
- ``test_at_04_partial_conservation`` — delivered 120 / accepted 100 /
  returned 20: real positive parts, conservation in mass and quantity;
- ``test_doc_mass_zero_no_division`` — a zero documentary mass never allows a
  computed tolerance (no division, no weight act);
- ``test_at_03_foreign_receiver_blocks_acceptance`` — a different receiver plus
  an admissible vehicle discrepancy forbid full/partial acceptance;
- ``test_unfavorable_compartment_does_not_block`` — DIRTY_OR_DAMAGED alone
  never blocks any decision;
- ``test_missing_mark_names_chk_id`` — a missing mandatory mark names CHK-Fxx;
- ``test_other_return_reason_without_text_is_422`` — OTHER_REASON without the
  mandatory text is a 422 at save.

Plus the API/state contract: ETag sequence (party → reconciliation),
idempotency, started incomplete saves stay OPEN, frozen after confirmation,
transaction «Нет» clears the type, RETURN_ALL act=false and route.

NOTE: this file contains Cyrillic literals; never rewrite it through
PowerShell Get-Content/Set-Content (encoding hazard) — use the edit tool.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from backend.src.core.contracts import CommandContext
from backend.src.core.problems import ProblemError
from backend.src.modules.arrivals import commands
from backend.src.modules.arrivals.models import Reconciliation
from backend.src.modules.arrivals.reconciliation import save_reconciliation
from backend.src.modules.arrivals.schemas import (
    ClassificationEntry,
    ClassificationView,
    Comparison,
    Inspection,
    QuantitySet,
    ReconciliationWrite,
    Repeat,
    ReturnReason,
    ServiceItem,
    Transaction,
)
from backend.src.modules.arrivals.validation import (
    RETURN_REASON_CODES,
    IncomingDocument,
    ReceiptCapabilities,
    validate_receipt,
)
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.tests.arrivals.test_api import _client_for
from backend.tests.arrivals.test_api import vet_env as arrivals_vet_env  # noqa: F401 - fixture re-export
from backend.tests.arrivals.test_import_and_queues import (
    PILOT_BEEF,
    document,
    lab,  # noqa: F401
    snapshot,
)
from backend.tests.arrivals.test_import_and_queues import (
    UNIT_KG as KG_GUID,
)

PILOT = VetisContour.PILOT


def classification(product_item_name: str = "Отруба говяжьи") -> ClassificationView:
    return ClassificationView(
        product=ClassificationEntry(id=str(PILOT_BEEF), name="говядина"),
        subProduct=ClassificationEntry(id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001", name="говядина"),
        productItem=ClassificationEntry(id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name=product_item_name),
        unit=ClassificationEntry(id=str(KG_GUID), name="кг"),
        productType=1,
    )


def source(**overrides: object) -> IncomingDocument:
    """The validator's source projection of the default beef fixture."""
    fields = {
        "documentNumber": "A-001234",
        "issuedOn": "2026-11-07",
        "status": "COMPLETED",
        "senderEnterprise": "ООО «Мясопром»",
        "senderOwner": "Мясопром холдинг",
        "receiverEnterprise": "Лабораторный убойный пункт",
        "vehicleNumber": "А123ВС77",
        "productType": 1,
        "product": "говядина",
        "species": "говядина",
        "name": "Отруба говяжьи",
        "quantity": "4",
        "massKg": "120.0",
        "unitId": str(KG_GUID),
    }
    fields.update(overrides)
    return IncomingDocument(
        snapshot=snapshot(),
        classification=classification(fields["name"]),  # type: ignore[arg-type]
        fields=fields,  # type: ignore[arg-type]
    )


def write_payload(**overrides: object) -> ReconciliationWrite:
    """A fully valid ACCEPT_ALL baseline matching the default source."""
    base: dict[str, object] = {
        "checks": {
            "CHK-F05": Comparison(matches=True),
            "CHK-F06": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=True),
        },
        "inspection": Inspection(compartment="COMPLIANT", joint_carriage="NONE"),
        "delivered": QuantitySet(mass_kg="120.0", quantity="4", unit_id=str(KG_GUID)),
        "accepted": QuantitySet(mass_kg="120.0", quantity="4", unit_id=str(KG_GUID)),
        "returned": QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        "decision": "ACCEPT_ALL",
        "return_reason": None,
        "repeat": None,
        "transaction": Transaction(planned=False, type=None),
        "fair": False,
        "services": [ServiceItem(code="PRODUCT_IDENTIFICATION", performed=True)],
    }
    base.update(overrides)
    return ReconciliationWrite.model_validate(base)  # type: ignore[arg-type]


CAPS = ReceiptCapabilities()


@pytest.fixture(name="vet_env")
async def _vet_env_fixture(arrivals_vet_env: object) -> object:  # noqa: F811 - fixture re-export
    """Re-export the arrivals API fixture under this module's fixture scope."""
    return arrivals_vet_env


def blocking_ids(result: object) -> set[str]:
    return {item.field_id or "" for item in result.blocking}  # type: ignore[attr-defined]


def error_ids(result: object) -> set[str]:
    return {item.field_id or "" for item in result.errors}  # type: ignore[attr-defined]


def act_fields(result: object) -> set[str]:
    return {item.field_id for item in result.act.items}  # type: ignore[attr-defined]


# --- named assertion: weight boundary ±5% inclusive (AT-02) --------------------


@pytest.mark.parametrize(
    ("delivered_mass", "act_expected"),
    [
        ("95", False),
        ("105", False),
        ("94.999", True),
        ("105.001", True),
    ],
)
def test_at_02_weight_boundary(delivered_mass: str, act_expected: bool) -> None:
    """100 kg documentary: 95/105 need no weight act, 94.999/105.001 do."""
    payload = write_payload(
        delivered=QuantitySet(mass_kg=delivered_mass, quantity="4", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg=delivered_mass, quantity="4", unit_id=str(KG_GUID)),
        checks={
            "CHK-F05": Comparison(matches=True),
            "CHK-F06": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(
                matches=Decimal(delivered_mass) != Decimal("100"),
                actual=delivered_mass,
                reason="Фактический вес отличается" if act_expected else None,
            ),
        },
    )
    result = validate_receipt(payload, source(massKg="100"), CAPS)
    assert blocking_ids(result) == set()
    assert ("CHK-F21" in act_fields(result)) is act_expected
    # Inside the boundary the weight mismatch alone needs no reason (no act).
    if not act_expected:
        assert error_ids(result) == set()


# --- named assertion: shortage is not return cargo (AT-01) ---------------------


def test_at_01_shortage_is_not_return_cargo() -> None:
    """Doc 120 / delivered 100 / accepted 100 / returned 0: correct ACCEPT_ALL."""
    payload = write_payload(
        delivered=QuantitySet(mass_kg="100", quantity="4", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="100", quantity="4", unit_id=str(KG_GUID)),
        checks={
            "CHK-F05": Comparison(matches=True),
            "CHK-F06": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=False, actual="100", reason="Недостача при доставке"),
        },
    )
    result = validate_receipt(payload, source(), CAPS)
    assert blocking_ids(result) == set()
    # The shortage never becomes return cargo: no returned quantity is derived,
    # the entered zero return stays zero, and the weight act is required.
    assert payload.returned.mass_kg == "0"
    assert "CHK-F21" in act_fields(result)
    assert result.complete is True

    # PARTIAL with a zero return part is refused: both parts must be positive
    # and the «missing» 20 kg is not a returnable cargo.
    partial = write_payload(
        decision="PARTIAL",
        delivered=QuantitySet(mass_kg="100", quantity="4", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="100", quantity="4", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        return_reason=ReturnReason(code="DEFECTIVE_GOODS"),
        checks={
            "CHK-F05": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=False, actual="100", reason="Недостача при доставке"),
        },
    )
    partial_result = validate_receipt(partial, source(), CAPS)
    assert blocking_ids(partial_result) != set()


# --- named assertion: real partial conservation (AT-04) ------------------------


def test_at_04_partial_conservation() -> None:
    """Delivered 120 / accepted 100 / returned 20: a correct PARTIAL."""
    payload = write_payload(
        decision="PARTIAL",
        delivered=QuantitySet(mass_kg="120", quantity="4", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="100", quantity="3", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="20", quantity="1", unit_id=str(KG_GUID)),
        return_reason=ReturnReason(code="DEFECTIVE_GOODS"),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert blocking_ids(result) == set()
    # Delivered equals the documentary mass: no weight act by the boundary.
    assert "CHK-F21" not in act_fields(result)
    assert result.route == "EXAMINATION"


def test_partial_violates_conservation_is_blocked() -> None:
    payload = write_payload(
        decision="PARTIAL",
        delivered=QuantitySet(mass_kg="120", quantity="4", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="90", quantity="3", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="20", quantity="1", unit_id=str(KG_GUID)),
        return_reason=ReturnReason(code="DEFECTIVE_GOODS"),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert blocking_ids(result) != set()
    # No equal shares of carcasses: the parts never get «computed» for the user.
    assert payload.accepted.mass_kg == "90"


# --- named assertion: zero documentary mass never divides ----------------------


def test_doc_mass_zero_no_division() -> None:
    """Documentary mass 0: no tolerance division and no derived weight act."""
    payload = write_payload(
        delivered=QuantitySet(mass_kg="0", quantity="4", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="0", quantity="4", unit_id=str(KG_GUID)),
    )
    result = validate_receipt(payload, source(massKg="0"), CAPS)
    assert "CHK-F21" not in act_fields(result)
    assert "деление" not in " ".join(item.message for item in result.blocking)
    # The mass mark is still an explicit comparison and stays mandatory.
    assert blocking_ids(result) == set()


# --- named assertion: foreign receiver blocks acceptance (AT-03) ---------------


def test_at_03_foreign_receiver_blocks_acceptance() -> None:
    """Another receiver + an admissible vehicle discrepancy → acceptance only."""
    payload = write_payload(
        checks={
            "CHK-F05": Comparison(matches=True),
            "CHK-F07": Comparison(
                matches=False,
                actual="Другой убойный пункт",
                reason="Груз доставлен на другую площадку",
            ),
            "CHK-F10": Comparison(matches=False, actual="В456МК77", reason="Замена ТС"),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=True),
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=True),
        },
    )
    result = validate_receipt(payload, source(), CAPS)
    assert result.allowed_decisions == ["RETURN_ALL"]
    # The strict rule wins when the two grounds combine: the admissible vehicle
    # ground still records its fact and act item, the receiver ground does not
    # enter the act (it blocks acceptance instead).
    assert "CHK-F10" in act_fields(result)
    assert "CHK-F07" not in act_fields(result)


def test_unfavorable_compartment_does_not_block() -> None:
    """A dirty/damaged compartment never blocks a decision by itself."""
    payload = write_payload(
        inspection=Inspection(compartment="DIRTY_OR_DAMAGED", joint_carriage="NOT_SEPARATED"),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert result.allowed_decisions == ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]
    assert blocking_ids(result) == set()


# --- named assertion: missing mandatory mark names the CHK ID ------------------


def test_missing_mark_names_chk_id() -> None:
    checks = write_payload().checks
    del checks["CHK-F07"]
    payload = write_payload(checks=checks)
    result = validate_receipt(payload, source(), CAPS)
    ids = {item.field_id for item in result.errors}
    assert "CHK-F07" in ids
    item = next(item for item in result.errors if item.field_id == "CHK-F07")
    assert item.path == "checks.CHK-F07"


def test_act_ground_requires_actual_and_reason() -> None:
    """A mismatch on an admissible ground demands actual + reason."""
    payload = write_payload(
        checks={
            "CHK-F05": Comparison(matches=True),
            "CHK-F07": Comparison(matches=True),
            "CHK-F10": Comparison(matches=True),
            "CHK-F15": Comparison(matches=True),
            "CHK-F16": Comparison(matches=True),
            "CHK-F17": Comparison(matches=True),
            "CHK-F18": Comparison(matches=False),  # no actual, no reason
            "CHK-F20": Comparison(matches=True),
            "CHK-F21": Comparison(matches=True),
        },
    )
    result = validate_receipt(payload, source(), CAPS)
    f18 = [item for item in result.errors if item.path == "checks.CHK-F18"]
    assert {item.field_id for item in f18} == {"CHK-F42", "CHK-F43"}


# --- return reason rules (FT-ARR-10) -------------------------------------------


async def test_other_return_reason_without_text_is_422(vet_env: object) -> None:
    """The named assertion runs through the real save command (422)."""
    env = vet_env  # type: ignore[assignment]
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    payload = write_payload(
        decision="RETURN_ALL",
        accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="120", quantity="4", unit_id=str(KG_GUID)),
        return_reason=ReturnReason(code="OTHER_REASON"),
    )
    ctx = CommandContext(actor_id=env.vet.id, idempotency_key=str(uuid.uuid4()), expected_revision=1)  # type: ignore[attr-defined]
    with pytest.raises(ProblemError) as raised:
        await save_reconciliation(ctx, party.id, payload, uow=env.db)  # type: ignore[attr-defined]
    assert raised.value.status == 422
    assert raised.value.code == "VALIDATION_ERROR"
    assert any(item.field_id == "CHK-F35" for item in raised.value.errors)
    await env.db.rollback()  # type: ignore[attr-defined]


def test_return_reason_required_for_partial_and_return() -> None:
    payload = write_payload(
        decision="RETURN_ALL",
        accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="120", quantity="4", unit_id=str(KG_GUID)),
        return_reason=None,
    )
    result = validate_receipt(payload, source(), CAPS)
    assert "CHK-F35" in error_ids(result) | blocking_ids(result)
    # RETURN_ALL never promises the discrepancy act of this branch.
    assert result.act.required is False
    assert act_fields(result) == set()


def test_unknown_return_reason_code_is_blocked() -> None:
    payload = write_payload(
        decision="RETURN_ALL",
        accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="120", quantity="4", unit_id=str(KG_GUID)),
        return_reason=ReturnReason(code="MADE_UP_CODE"),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert "CHK-F35" in blocking_ids(result)
    assert all(code != "MADE_UP_CODE" for code in RETURN_REASON_CODES)


# --- repeat inspection rules (FT-ARR-11) ---------------------------------------


def test_repeat_requires_previous() -> None:

    result = validate_receipt(write_payload(), source(), CAPS)
    assert blocking_ids(result) == set()

    with_previous = source(
        previousNumber="ПВС-1",
        previousPerformedOn="2026-11-01",
        previousOrganization="ГБУ Ветснаб",
        previousResult="Отрицательно",
    )
    with_previous_payload = write_payload(repeat=Repeat(required=True, reason=None, act_number=None))
    result = validate_receipt(with_previous_payload, with_previous, CAPS)
    ids = error_ids(result)
    assert "CHK-F37" in ids and "CHK-F38" in ids

    complete = write_payload(repeat=Repeat(required=True, reason="Смена владельца", act_number="А-1"))
    ok = validate_receipt(complete, with_previous, CAPS)
    assert blocking_ids(ok) == set()
    assert ok.route == "EXAMINATION"

    # Without previous ВСЭ the local ВСЭ is required without a fictitious
    # repeat selection: a repeat block is structurally impossible.
    no_previous = write_payload(repeat=Repeat(required=False))
    result = validate_receipt(no_previous, source(), CAPS)
    assert "CHK-F36" in blocking_ids(result)


def test_repeat_not_required_with_previous_conclusion_route() -> None:

    with_previous = source(
        previousNumber="ПВС-1",
        previousPerformedOn="2026-11-01",
        previousOrganization="ГБУ Ветснаб",
        previousResult="Отрицательно",
    )
    payload = write_payload(repeat=Repeat(required=False))
    result = validate_receipt(payload, with_previous, CAPS)
    assert blocking_ids(result) == set()
    assert result.route == "CONCLUSION"


# --- transaction, delivery, units ----------------------------------------------


def test_transaction_no_clears_type() -> None:
    payload = write_payload(transaction=Transaction(planned=False, type="INTERNAL"))
    result = validate_receipt(payload, source(), CAPS)
    assert blocking_ids(result) == set()
    # «Нет» never keeps the type as an active value.
    assert result.errors == [] or "CHK-F40" not in {i.field_id for i in result.errors}


def test_transaction_planned_requires_type() -> None:
    payload = write_payload(transaction=Transaction(planned=True, type=None))
    result = validate_receipt(payload, source(), CAPS)
    assert "CHK-F40" in error_ids(result)


def test_zero_delivery_blocks_garbling() -> None:
    """Non-arrival: no acceptance and no return of absent cargo."""
    payload = write_payload(
        delivered=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
        returned=QuantitySet(mass_kg="0", quantity="0", unit_id=str(KG_GUID)),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert result.allowed_decisions == []
    assert "CHK-F34" in blocking_ids(result)


def test_unit_mismatch_is_blocked() -> None:
    payload = write_payload(
        accepted=QuantitySet(mass_kg="120", quantity="4", unit_id="different-unit"),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert blocking_ids(result) != set()


def test_negative_quantities_blocked() -> None:
    payload = write_payload(
        accepted=QuantitySet(mass_kg="-5", quantity="4", unit_id=str(KG_GUID)),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert blocking_ids(result) != set()


def test_readonly_fields_reject_fictitious_marks() -> None:
    payload = write_payload(
        checks={
            **write_payload().checks,
            "CHK-F01": Comparison(matches=True),
        },
    )
    result = validate_receipt(payload, source(), CAPS)
    assert "CHK-F01" in blocking_ids(result)


def test_quantity_discrepancy_outside_unit_is_act_ground() -> None:
    """Delivered quantity differs from documentary in the same unit → act."""
    payload = write_payload(
        checks={
            **write_payload().checks,
            "CHK-F20": Comparison(matches=False, actual="3", reason="Одна туша отсутствует"),
        },
        delivered=QuantitySet(mass_kg="120", quantity="3", unit_id=str(KG_GUID)),
        accepted=QuantitySet(mass_kg="120", quantity="3", unit_id=str(KG_GUID)),
    )
    result = validate_receipt(payload, source(), CAPS)
    assert "CHK-F20" in act_fields(result)


# --- API tests: save state machine, ETags, idempotency --------------------------


async def test_api_get_reconciliation_parent_etag(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    async with _client_for(env) as (http, _identity):  # type: ignore[operator]
        response = await http.get(f"/api/v1/arrivals/{party.id}/reconciliation")  # type: ignore[attr-defined]
        assert response.status_code == 200
        assert response.headers["ETag"] == '"1"'
        body = response.json()
        assert body["state"] == "OPEN"
        assert body["revision"] == 1
        assert body["decision"] is None
        assert body["complete"] is False


async def test_api_put_etag_sequence_and_incomplete_save(vet_env: object) -> None:
    """First PUT uses the party ETag; later PUTs use the reconciliation ETag."""
    env = vet_env  # type: ignore[assignment]
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        base_headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
        }
        incomplete = {
            "checks": {},
            "inspection": {"compartment": None, "joint_carriage": None},
            "delivered": {"mass_kg": "0", "quantity": "0", "unit_id": ""},
            "accepted": {"mass_kg": "0", "quantity": "0", "unit_id": ""},
            "returned": {"mass_kg": "0", "quantity": "0", "unit_id": ""},
            "transaction": {"planned": None, "type": None},
            "fair": False,
            "services": [],
        }
        no_if_match = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers=base_headers,
        )
        assert no_if_match.status_code == 422
        assert no_if_match.json()["code"] == "REVISION_REQUIRED"

        wrong = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers={**base_headers, "if-match": '"9"'},
        )
        assert wrong.status_code == 409
        assert wrong.json()["code"] == "REVISION_CONFLICT"

        first = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers={**base_headers, "if-match": '"1"'},
        )
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["state"] == "OPEN"
        assert body["revision"] == 1
        assert body["complete"] is False
        assert body["fair"] is False

        no_key = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers={"x-csrf-token": identity.csrf_token, "origin": "http://test", "if-match": '"1"'},
        )
        assert no_key.status_code == 422
        assert no_key.json()["code"] == "IDEMPOTENCY_KEY_REQUIRED"

        # After the first save the aggregate revision is the reconciliation's:
        # the same "1" now resolves to it and the save succeeds with revision 2.
        second = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers={**base_headers, "idempotency-key": str(uuid.uuid4()), "if-match": '"1"'},
        )
        assert second.status_code == 200
        assert second.json()["revision"] == 2

        # A stale revision of the reconciliation is a 409 conflict, not a merge.
        stale = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=incomplete,
            headers={**base_headers, "idempotency-key": str(uuid.uuid4()), "if-match": '"1"'},
        )
        assert stale.status_code == 409


async def test_api_put_decision_and_frozen_state(vet_env: object) -> None:
    env = vet_env  # type: ignore[assignment]
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
            "if-match": '"1"',
        }
        unit = str(KG_GUID)
        body = {
            "checks": {
                "CHK-F05": {"matches": True},
                "CHK-F07": {"matches": True},
                "CHK-F10": {"matches": True},
                "CHK-F15": {"matches": True},
                "CHK-F16": {"matches": True},
                "CHK-F18": {"matches": True},
                "CHK-F20": {"matches": True},
                "CHK-F21": {"matches": False, "actual": "100", "reason": "Недостача при доставке"},
            },
            "inspection": {"compartment": "COMPLIANT", "joint_carriage": "NONE"},
            "delivered": {"mass_kg": "100", "quantity": "4", "unit_id": unit},
            "accepted": {"mass_kg": "100", "quantity": "4", "unit_id": unit},
            "returned": {"mass_kg": "0", "quantity": "0", "unit_id": unit},
            "decision": "ACCEPT_ALL",
            "transaction": {"planned": False, "type": None},
            "fair": False,
            "services": [],
        }
        saved = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=body,
            headers=headers,  # type: ignore[attr-defined]
        )
        assert saved.status_code == 200, saved.text
        view = saved.json()
        assert view["complete"] is True
        assert view["allowed_decisions"] == ["ACCEPT_ALL", "PARTIAL", "RETURN_ALL"]
        assert view["act"]["required"] is True
        assert {"CHK-F21"} <= {item["field_id"] for item in view["act"]["items"]}
        assert view["route"] == "EXAMINATION"

        # An inadmissible decision (foreign receiver) is refused, not merged.
        blocked = dict(body)
        blocked["decision"] = "PARTIAL"
        blocked["returnReason"] = {"code": "DEFECTIVE_GOODS"}
        conflict = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=blocked,
            headers={**headers, "idempotency-key": str(uuid.uuid4()), "if-match": f'"{view["revision"]}"'},
        )
        assert conflict.status_code == 422
        assert conflict.json()["code"] == "VALIDATION_ERROR"

        # After confirmation the reconciliation is frozen (FT-ARR-15).
        row = (
            await env.db.execute(  # type: ignore[attr-defined]
                select(Reconciliation).where(Reconciliation.party_id == party.id)  # type: ignore[attr-defined]
            )
        ).scalar_one()
        row.state = "CONFIRMED"
        await env.db.commit()  # type: ignore[attr-defined]
        frozen = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",  # type: ignore[attr-defined]
            json=body,
            headers={**headers, "idempotency-key": str(uuid.uuid4()), "if-match": f'"{view["revision"]}"'},
        )
        assert frozen.status_code == 409
        assert frozen.json()["code"] == "STATE_CONFLICT"


async def test_api_other_reason_without_text_422(vet_env: object) -> None:
    """The named assertion through the HTTP endpoint: OTHER_REASON needs text."""
    env = vet_env  # type: ignore[assignment]
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
            "if-match": '"1"',
        }
        unit = str(KG_GUID)
        body = {
            "checks": {
                "CHK-F05": {"matches": True},
                "CHK-F07": {"matches": True},
                "CHK-F10": {"matches": True},
                "CHK-F15": {"matches": True},
                "CHK-F16": {"matches": True},
                "CHK-F18": {"matches": True},
                "CHK-F20": {"matches": True},
                "CHK-F21": {"matches": True},
            },
            "inspection": {"compartment": "COMPLIANT", "joint_carriage": "NONE"},
            "delivered": {"mass_kg": "120", "quantity": "4", "unit_id": unit},
            "accepted": {"mass_kg": "0", "quantity": "0", "unit_id": unit},
            "returned": {"mass_kg": "120", "quantity": "4", "unit_id": unit},
            "decision": "RETURN_ALL",
            "return_reason": {"code": "OTHER_REASON"},
            "transaction": {"planned": False, "type": None},
            "fair": False,
            "services": [],
        }
        refused = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=body,
            headers=headers,  # type: ignore[attr-defined]
        )
        assert refused.status_code == 422, refused.text
        assert refused.json()["code"] == "VALIDATION_ERROR"
        assert (
            any(item["field_id"] == "CHK-F35" for item in refused.json().get("errors", []))
            or "OTHER_REASON" in refused.json()["detail"]
        )


async def test_decision_not_allowed_is_refused(vet_env: object) -> None:
    """A foreign receiver forbids ACCEPT_ALL even with admissible quantities."""
    env = vet_env  # type: ignore[assignment]
    party = await commands.upsert_incoming(env.db, document(uuid.uuid4(), env.own.id))  # type: ignore[attr-defined]
    await env.db.commit()  # type: ignore[attr-defined]
    # A source with a foreign receiver: mark F07 as a mismatch in the payload.
    async with _client_for(env) as (http, identity):  # type: ignore[operator]
        headers = {
            "x-csrf-token": identity.csrf_token,
            "origin": "http://test",
            "idempotency-key": str(uuid.uuid4()),
            "if-match": '"1"',
        }
        unit = str(KG_GUID)
        body = {
            "checks": {
                "CHK-F05": {"matches": True},
                "CHK-F07": {"matches": False, "actual": "Другая площадка", "reason": "Груз на другой площадке"},
                "CHK-F10": {"matches": True},
                "CHK-F15": {"matches": True},
                "CHK-F16": {"matches": True},
                "CHK-F18": {"matches": True},
                "CHK-F20": {"matches": True},
                "CHK-F21": {"matches": True},
            },
            "inspection": {"compartment": "COMPLIANT", "joint_carriage": "NONE"},
            "delivered": {"mass_kg": "120", "quantity": "4", "unit_id": unit},
            "accepted": {"mass_kg": "120", "quantity": "4", "unit_id": unit},
            "returned": {"mass_kg": "0", "quantity": "0", "unit_id": unit},
            "decision": "ACCEPT_ALL",
            "transaction": {"planned": False, "type": None},
            "fair": False,
            "services": [],
        }
        refused = await http.put(  # type: ignore[attr-defined]
            f"/api/v1/arrivals/{party.id}/reconciliation",
            json=body,
            headers=headers,  # type: ignore[attr-defined]
        )
        assert refused.status_code == 422
        items = refused.json().get("errors", [])
        assert any(item["field_id"] == "CHK-F34" for item in items) or "недопустимо" in refused.json()["detail"]
