"""A call that did not happen is not a warranty decision."""

from __future__ import annotations

import copy

from warrantyops.contract import CoverageStatus, ResolutionStatus, build_extraction_schema
from warrantyops.identifiers import IdentifierState
from warrantyops.outcome import (
    TerminalState,
    TransportOutcome,
    TransportState,
    derive_outcome,
)
from warrantyops.validation import validate_structured_result

SCHEMA = build_extraction_schema()

COVERED_WITH_RMA = {
    "coverage_status": "COVERED",
    "coverage_evidence_quote": "Yes, that unit is still inside the parts warranty.",
    "resolution_status": "RMA_ISSUED",
    "resolution_evidence_quote": "I can raise a return authorization for you now.",
    "authorization_reference_heard": "RMA four eight one seven one",
    "authorization_reference_readback_performed": False,
    "authorization_reference_confirmed": None,
    "authorization_reference_confirmation_quote": None,
    "replacement_eta": None,
    "return_deadline": None,
    "required_documents": [],
    "next_action": None,
}


def outcome_for(payload, transport, **kwargs):
    validation = validate_structured_result(payload, SCHEMA)
    return derive_outcome(transport, validation, **kwargs)


def test_a_failed_call_is_never_a_coverage_decision():
    transport = TransportOutcome(
        state=TransportState.FAILED,
        call_id="call_synthetic_x",
        diagnostic_failure_code="anything_at_all",
    )
    result = outcome_for(copy.deepcopy(COVERED_WITH_RMA), transport)
    assert result.terminal_state is TerminalState.TRANSPORT_FAILED
    assert result.business.coverage_status is CoverageStatus.UNKNOWN
    assert result.business.resolution_status is ResolutionStatus.UNRESOLVED
    assert result.business.coverage_status is not CoverageStatus.NOT_COVERED


def test_the_undocumented_failure_string_is_carried_but_never_branched_on():
    transport = TransportOutcome(
        state=TransportState.FAILED, diagnostic_failure_code="no_answer"
    )
    as_no_answer = outcome_for(None, transport)
    as_other = outcome_for(
        None,
        TransportOutcome(state=TransportState.FAILED, diagnostic_failure_code="declined"),
    )
    assert as_no_answer.terminal_state is as_other.terminal_state
    assert as_no_answer.business.to_dict() == as_other.business.to_dict()
    assert as_no_answer.transport.diagnostic_failure_code == "no_answer"


def test_a_call_still_running_produces_no_business_state():
    result = outcome_for(None, TransportOutcome(state=TransportState.IN_PROGRESS))
    assert result.terminal_state is TerminalState.IN_FLIGHT


def test_a_completed_call_with_no_schema_valid_result_is_its_own_state():
    result = outcome_for(None, TransportOutcome(state=TransportState.COMPLETED))
    assert result.terminal_state is TerminalState.RESULT_UNAVAILABLE
    assert result.business.coverage_status is CoverageStatus.UNKNOWN


def test_an_authorizing_resolution_without_a_confirmed_identifier_is_downgraded():
    result = outcome_for(
        copy.deepcopy(COVERED_WITH_RMA),
        TransportOutcome(state=TransportState.COMPLETED),
        identifier_prefix="RMA",
    )
    assert result.business.resolution_status is ResolutionStatus.HUMAN_ACTION_REQUIRED
    assert result.business.authorization_reference is None
    assert result.identifier is not None
    assert result.identifier.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert any("CONFIRMED_IDENTIFIER" in note for note in result.business.downgrades)


def test_a_coverage_claim_with_no_quote_is_reduced_to_unknown():
    payload = copy.deepcopy(COVERED_WITH_RMA)
    payload["coverage_evidence_quote"] = None
    payload["resolution_status"] = "DOCUMENTATION_REQUIRED"
    result = outcome_for(payload, TransportOutcome(state=TransportState.COMPLETED))
    assert result.business.coverage_status is CoverageStatus.UNKNOWN
    assert any("no evidence quote" in note for note in result.business.downgrades)


def test_evidence_only_carries_quotes_that_survived_every_check():
    payload = copy.deepcopy(COVERED_WITH_RMA)
    payload["resolution_status"] = "DOCUMENTATION_REQUIRED"
    result = outcome_for(payload, TransportOutcome(state=TransportState.COMPLETED))
    fields = {item["field"] for item in result.business.evidence}
    assert "authorization_reference" not in fields
