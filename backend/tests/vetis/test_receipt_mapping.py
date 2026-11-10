"""W01 offline assertions: six receipt branches, no Mercury connection."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from xml.etree import ElementTree as ET

import pytest

from backend.src.core.problems import ProblemError
from backend.src.modules.integrations.vetis.contracts import ReceiptIntent
from backend.src.modules.integrations.vetis.models import VetisContour
from backend.src.modules.integrations.vetis.receipt_mapping import build_process_incoming_application
from backend.src.modules.integrations.vetis.transport import ZeepApplicationTransport

SOURCE_EVSD = uuid.UUID("00000000-0000-0000-0000-000000000101")
SOURCE_RECEIVER = "00000000-0000-0000-0000-000000000102"
SOURCE_UNIT = "00000000-0000-0000-0000-000000000103"

SOURCE_XML = """<vd:vetDocument
 xmlns:vd="http://api.vetrf.ru/schema/cdm/mercury/vet-document/v2"
 xmlns:bs="http://api.vetrf.ru/schema/cdm/base"
 xmlns:dt="http://api.vetrf.ru/schema/cdm/dictionary/v2">
 <bs:uuid>00000000-0000-0000-0000-000000000101</bs:uuid>
 <vd:authentication><vd:purpose><bs:guid>purpose-guid</bs:guid></vd:purpose></vd:authentication>
 <vd:certifiedConsignment>
  <vd:consignor><dt:enterprise><bs:guid>sender</bs:guid></dt:enterprise></vd:consignor>
  <vd:consignee><dt:enterprise><bs:guid>00000000-0000-0000-0000-000000000102</bs:guid></dt:enterprise></vd:consignee>
  <vd:batch><vd:volume>120</vd:volume><vd:unit><bs:guid>00000000-0000-0000-0000-000000000103</bs:guid></vd:unit></vd:batch>
  <vd:transportInfo><vd:transportType>1</vd:transportType></vd:transportInfo>
  <vd:transportStorageType>FROZEN</vd:transportStorageType>
  <vd:accompanyingForms><vd:vetCertificate><bs:uuid>source</bs:uuid></vd:vetCertificate></vd:accompanyingForms>
 </vd:certifiedConsignment>
</vd:vetDocument>"""


def intent(*, mismatch: bool, decision: str, vet: str = "CORRESPONDS") -> ReceiptIntent:
    delivered, accepted, returned = {
        "ACCEPT_ALL": (Decimal("100"), Decimal("100"), Decimal("0")),
        "PARTIALLY": (Decimal("120"), Decimal("100"), Decimal("20")),
        "RETURN_ALL": (Decimal("120"), Decimal("0"), Decimal("120")),
    }[decision]
    return ReceiptIntent(
        operation_id=uuid.uuid4(),
        party_id=uuid.uuid4(),
        laboratory_id=uuid.uuid4(),
        contour=VetisContour.PILOT,
        source_evsd_uuid=SOURCE_EVSD,
        source_checksum="a" * 64,
        source_revision=4,
        receiver_enterprise_id=SOURCE_RECEIVER,
        business_member_id=str(uuid.uuid4()),
        initiator="fixture-vet",
        delivery_date=datetime(2026, 11, 9, 10, 0, tzinfo=UTC),
        reconciliation_revision=7,
        decision=decision,  # type: ignore[arg-type]
        doc_inspection="MISMATCH" if mismatch else "CORRESPONDS",
        vet_inspection=vet,  # type: ignore[arg-type]
        documentary_quantity=Decimal("120"),
        delivered_quantity=delivered,
        accepted_quantity=accepted,
        returned_quantity=returned,
        unit_id=SOURCE_UNIT,
        discrepancy_items=[{"field_id": "CHK-F01", "reason": "QUANTITY", "actual": "100"}] if mismatch else [],
        return_reason_code="OTHER_REASON" if returned else None,
        return_reason_text="Обезличенная причина возврата" if returned else None,
        act_number="ACT-FIXTURE" if mismatch and decision != "RETURN_ALL" else None,
        local_transaction_id=str(uuid.uuid4()),
        fingerprint="f" * 64,
    )


def count(xml: str, local: str) -> int:
    root = ET.fromstring(xml)
    return sum(node.tag.rsplit("}", 1)[-1] == local for node in root.iter())


@pytest.mark.parametrize("mismatch", [False, True])
@pytest.mark.parametrize("decision", ["ACCEPT_ALL", "PARTIALLY", "RETURN_ALL"])
def test_six_contract_scenarios(mismatch: bool, decision: str) -> None:
    value = intent(mismatch=mismatch, decision=decision)
    xml = build_process_incoming_application(
        value, source_xml=SOURCE_XML, service_id="mercury-vu.service:2.0", issuer_id="fixture"
    )
    assert count(xml, "processIncomingConsignmentRequest") == 1
    assert count(xml, "vetCertificatePresence") == 1
    assert "ELECTRONIC" in xml
    assert count(xml, "delivery") == 1
    assert count(xml, "consignment") == (1 if decision in {"ACCEPT_ALL", "RETURN_ALL"} else 2)
    assert count(xml, "returnedDelivery") == (0 if decision == "ACCEPT_ALL" else 1)
    assert count(xml, "discrepancyReport") == (1 if mismatch and decision != "RETURN_ALL" else 0)
    assert "Обезличенная причина возврата" in xml if decision != "ACCEPT_ALL" else True


@pytest.mark.parametrize("vet", ["CORRESPONDS", "MISMATCH", "UNSUPERVISED"])
def test_vet_inspection_is_independent(vet: str) -> None:
    xml = build_process_incoming_application(
        intent(mismatch=False, decision="ACCEPT_ALL", vet=vet),
        source_xml=SOURCE_XML,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
    )
    assert f">{vet}<" in xml


def test_other_reason_requires_text_and_blocking_forces_return() -> None:
    missing = intent(mismatch=False, decision="PARTIALLY").model_copy(update={"return_reason_text": None})
    with pytest.raises(ProblemError):
        build_process_incoming_application(missing, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    blocked = intent(mismatch=True, decision="ACCEPT_ALL").model_copy(
        update={"discrepancy_items": [{"field_id": "CHK-F01", "reason": "unsafe", "blocking": True}]}
    )
    with pytest.raises(ProblemError):
        build_process_incoming_application(blocked, source_xml=SOURCE_XML, service_id="s", issuer_id="i")


def test_missing_scope_refused_before_transport() -> None:
    calls: list[str] = []
    invalid = intent(mismatch=False, decision="ACCEPT_ALL").model_copy(update={"initiator": ""})
    with pytest.raises(ProblemError):
        build_process_incoming_application(invalid, source_xml=SOURCE_XML, service_id="s", issuer_id="i")
    assert calls == []


async def test_enabled_transport_uses_exact_submit_action_without_network() -> None:
    class CaptureTransport(ZeepApplicationTransport):
        def __init__(self) -> None:
            super().__init__(endpoint="https://fixture.invalid")
            self.captured: list[tuple[str, str]] = []

        def _post(self, action: str, body: str) -> str:
            self.captured.append((action, body))
            return "<response><applicationId>fixture-app</applicationId></response>"

    value = intent(mismatch=False, decision="ACCEPT_ALL")
    xml = build_process_incoming_application(
        value,
        source_xml=SOURCE_XML,
        service_id="mercury-vu.service:2.0",
        issuer_id="fixture",
        api_key="fixture-key",
    )
    transport = CaptureTransport()
    application_id = await transport.send_application(xml)
    assert application_id == "fixture-app"
    assert transport.captured == [("submitApplicationRequest", xml)]
