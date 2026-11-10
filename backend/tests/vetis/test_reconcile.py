"""W02 evidence-link assertions on sanitized result fixtures."""

from __future__ import annotations

from backend.src.modules.integrations.vetis.evidence import parse_receipt_result
from backend.tests.vetis.test_receipt_mapping import intent


def result_xml(source: str, receiver: str, accepted: str, returned: str, *, status: str = "COMPLETED") -> str:
    return f"""<response><status>{status}</status><processIncomingConsignmentResponse>
      <sourceVetDocumentUuid>{source}</sourceVetDocumentUuid>
      <receiverEnterpriseGuid>{receiver}</receiverEnterpriseGuid>
      <acceptedConsignment><volume>{accepted}</volume></acceptedConsignment>
      <returnedDelivery><volume>{returned}</volume></returnedDelivery>
    </processIncomingConsignmentResponse></response>"""


def test_complete_partial_evidence_confirms_frozen_composition() -> None:
    frozen = intent(mismatch=True, decision="PARTIALLY")
    result = parse_receipt_result(
        result_xml(str(frozen.source_evsd_uuid), frozen.receiver_enterprise_id, "100", "20"),
        frozen,
        application_id="app-fixture",
    )
    assert result.state == "CONFIRMED"
    assert result.detail is not None
    assert result.detail["evidence"]["accepted_quantity"] == "100"  # type: ignore[index]


def test_manual_partial_without_linked_composition_is_unknown() -> None:
    frozen = intent(mismatch=True, decision="PARTIALLY")
    result = parse_receipt_result(
        result_xml(str(frozen.source_evsd_uuid), frozen.receiver_enterprise_id, "100", "0"),
        frozen,
        application_id="app-fixture",
    )
    assert result.state == "UNKNOWN"
    assert result.detail == {
        "problem": "INTEGRATION_EVIDENCE_INCOMPLETE",
        "links": {
            "source": True,
            "receiver": True,
            "accepted": True,
            "returned": False,
            "unit": True,
            "return_reason": True,
        },
    }


def test_receiver_or_source_mismatch_never_confirms() -> None:
    frozen = intent(mismatch=False, decision="ACCEPT_ALL")
    result = parse_receipt_result(
        result_xml("00000000-0000-0000-0000-000000000001", "foreign", "100", "0"),
        frozen,
        application_id="app-fixture",
    )
    assert result.state == "UNKNOWN"


def test_rejected_and_processing_are_not_confirmation() -> None:
    frozen = intent(mismatch=False, decision="ACCEPT_ALL")
    rejected = parse_receipt_result(
        "<response><status>REJECTED</status><message>denied</message></response>",
        frozen,
        application_id="a",
    )
    processing = parse_receipt_result("<response><status>IN_PROCESS</status></response>", frozen, application_id="b")
    assert rejected.state == "REJECTED"
    assert processing.state == "PROCESSING"


def test_full_return_does_not_require_absent_accepted_consignment() -> None:
    frozen = intent(mismatch=True, decision="RETURN_ALL")
    xml = f"""<response><status>COMPLETED</status><processIncomingConsignmentResponse>
      <sourceVetDocumentUuid>{frozen.source_evsd_uuid}</sourceVetDocumentUuid>
      <receiverEnterpriseGuid>{frozen.receiver_enterprise_id}</receiverEnterpriseGuid>
      <returnedDelivery><volume>120</volume></returnedDelivery>
    </processIncomingConsignmentResponse></response>"""
    result = parse_receipt_result(xml, frozen, application_id="full-return")
    assert result.state == "CONFIRMED"


def test_accept_all_does_not_require_absent_returned_delivery() -> None:
    frozen = intent(mismatch=False, decision="ACCEPT_ALL")
    xml = f"""<response><status>COMPLETED</status><processIncomingConsignmentResponse>
      <sourceVetDocumentUuid>{frozen.source_evsd_uuid}</sourceVetDocumentUuid>
      <receiverEnterpriseGuid>{frozen.receiver_enterprise_id}</receiverEnterpriseGuid>
      <acceptedConsignment><volume>100</volume></acceptedConsignment>
    </processIncomingConsignmentResponse></response>"""
    result = parse_receipt_result(xml, frozen, application_id="accept-all")
    assert result.state == "CONFIRMED"


def test_real_v2_stock_and_documents_prove_partial_receipt() -> None:
    frozen = intent(mismatch=True, decision="PARTIALLY")
    xml = f"""<response><status>COMPLETED</status><processIncomingConsignmentResponse>
      <stockEntry><batch><volume>100</volume><unit><guid>{frozen.unit_id}</guid></unit></batch></stockEntry>
      <vetDocument><uuid>{frozen.source_evsd_uuid}</uuid><vetDType>TRANSPORT</vetDType>
       <vetDStatus>UTILIZED</vetDStatus><certifiedConsignment><consignee><enterprise>
       <guid>{frozen.receiver_enterprise_id}</guid></enterprise></consignee></certifiedConsignment></vetDocument>
      <vetDocument><uuid>00000000-0000-0000-0000-000000000199</uuid><vetDType>RETURNABLE</vetDType>
       <vetDStatus>CONFIRMED</vetDStatus><certifiedConsignment><batch><volume>20</volume>
       <unit><guid>{frozen.unit_id}</guid></unit></batch></certifiedConsignment>
       <authentication><specialMarks>Причина возврата: OTHER_REASON fixture</specialMarks></authentication>
      </vetDocument>
    </processIncomingConsignmentResponse></response>"""
    result = parse_receipt_result(xml, frozen, application_id="real-v2")
    assert result.state == "CONFIRMED"
