"""The deterministic boundary: which evidence buys which authority.

Every test here is a sentence about what software is allowed to do to a public
record. The invariant they defend together is one line:

    no failed, ambiguous or unsupported call may leave the record less
    trustworthy than it was before the call.
"""

from __future__ import annotations

import pytest

from callibrate.calling.models import CallOutcome, Claim, Confirmation, SafetyEvent, SafetyEventKind
from callibrate.contracts.models import EscalationPolicy, UpdatePolicy
from callibrate.policy.evidence_policy import Authority, classify, classify_claim, overall
from tests.conftest import evidence_with


def confirmed_claim(**overrides) -> Claim:
    base = {
        "field": "schedule",
        "proposed_value": "WE 10:00-13:00",
        "quote": "It moved to ten until one.",
        "explicit_statement": True,
        "ambiguous": False,
        "confidence": 0.99,
        "source_turn_ids": ["t2"],
        "readback_turn_ids": ["t3"],
        "confirmation_turn_ids": ["t4"],
    }
    base.update(overrides)
    return Claim(**base)


def test_a_fully_evidenced_low_judgment_change_applies(contract):
    decision = classify_claim(confirmed_claim(), contract)
    assert decision.authority is Authority.APPLY


def test_a_change_with_no_readback_goes_to_a_person(contract):
    decision = classify_claim(confirmed_claim(readback_turn_ids=[]), contract)
    assert decision.authority is Authority.REVIEW


def test_a_change_with_no_confirmation_goes_to_a_person(contract):
    decision = classify_claim(confirmed_claim(confirmation_turn_ids=[]), contract)
    assert decision.authority is Authority.REVIEW


def test_an_ambiguous_change_goes_to_a_person(contract):
    decision = classify_claim(confirmed_claim(ambiguous=True), contract)
    assert decision.authority is Authority.REVIEW


def test_a_claim_the_transcript_does_not_support_goes_to_a_person(contract):
    decision = classify_claim(
        confirmed_claim(explicit_statement=False, confidence=0.0, source_turn_ids=[]), contract
    )
    assert decision.authority is Authority.REVIEW


def test_a_non_canonical_value_is_never_written(contract):
    """A value that cannot be stored safely is not stored, however well evidenced."""
    decision = classify_claim(confirmed_claim(proposed_value="Wednesday mornings"), contract)
    assert decision.authority is Authority.REVIEW
    assert "canonical" in decision.reason


def test_a_removal_is_always_human(contract):
    decision = classify_claim(
        confirmed_claim(field="status", proposed_value="inactive", removes_service=True), contract
    )
    assert decision.authority is Authority.REVIEW


def test_a_field_the_contract_never_auto_applies_is_human(contract):
    decision = classify_claim(
        confirmed_claim(field="eligibility", proposed_value="County residents only"), contract
    )
    assert decision.authority is Authority.REVIEW


def test_the_contract_can_narrow_what_may_be_applied(contract):
    """The policy is data. A contract that trusts nothing automates nothing."""
    strict = contract.model_copy(update={"update_policy": UpdatePolicy(auto_apply_fields=[])})
    assert classify_claim(confirmed_claim(), strict).authority is Authority.REVIEW


def test_confidence_below_the_contract_threshold_is_human(contract):
    decision = classify_claim(confirmed_claim(confidence=0.5), contract)
    assert decision.authority is Authority.REVIEW


# ----------------------------------------------------------------- whole runs


def test_a_confirmation_refreshes_and_changes_nothing(contract):
    evidence = evidence_with(
        contract, confirmations=[Confirmation(field="schedule", value="WE 09:00-12:00")]
    )
    decisions = classify(evidence, contract)
    assert overall(decisions) is Authority.REFRESH


def test_a_stop_request_stops_the_whole_run(contract):
    evidence = evidence_with(
        contract,
        outcome=CallOutcome.STOP_REQUESTED,
        safety_events=[SafetyEvent(kind=SafetyEventKind.STOP_REQUESTED, detail="take us off")],
    )
    assert overall(classify(evidence, contract)) is Authority.STOP


def test_a_help_seeker_answering_stops_the_run(contract):
    evidence = evidence_with(
        contract,
        outcome=CallOutcome.REACHED_CLIENT,
        safety_events=[SafetyEvent(kind=SafetyEventKind.REACHED_CLIENT, detail="I need food")],
    )
    assert overall(classify(evidence, contract)) is Authority.STOP


def test_one_unresolved_claim_pulls_a_whole_run_to_review(contract):
    """Four right answers and one ambiguous one is not four fifths safe."""
    two_fields = contract.model_copy(update={"fields_to_verify": ["schedule", "phone"]})
    evidence = evidence_with(
        two_fields,
        claims=[confirmed_claim(), confirmed_claim(field="phone", proposed_value="+15550102202", ambiguous=True)],
    )
    assert overall(classify(evidence, two_fields)) is Authority.REVIEW


def test_a_call_that_reached_nobody_produces_no_review_item(contract):
    """Nobody answered. That is a retry, not a decision for a curator."""
    for outcome in (CallOutcome.NO_ANSWER, CallOutcome.VOICEMAIL, CallOutcome.BUSY, CallOutcome.FAILED):
        evidence = evidence_with(contract, outcome=outcome)
        decisions = classify(evidence, contract)
        assert overall(decisions) is Authority.REFRESH
        assert all(decision.claim is None for decision in decisions)


def test_a_call_that_settled_nothing_is_reviewed_not_ignored(contract):
    evidence = evidence_with(contract, outcome=CallOutcome.COMPLETED)
    decisions = classify(evidence, contract)
    assert overall(decisions) is Authority.REVIEW
    assert any("without evidence" in decision.reason for decision in decisions)


def test_a_missing_disclosure_stops_the_run(contract):
    evidence = evidence_with(
        contract,
        disclosure_spoken=False,
        safety_events=[SafetyEvent(kind=SafetyEventKind.NO_DISCLOSURE, detail="never said so")],
        claims=[confirmed_claim()],
    )
    assert overall(classify(evidence, contract)) is Authority.STOP


def test_a_contract_that_does_not_escalate_a_condition_does_not_escalate_it(contract):
    """Escalation is contract data, and a contract can be wrong. It is visible."""
    permissive = contract.model_copy(update={"escalation_policy": EscalationPolicy(escalate_if=[])})
    evidence = evidence_with(
        contract,
        safety_events=[SafetyEvent(kind=SafetyEventKind.NO_DISCLOSURE, detail="never said so")],
        claims=[confirmed_claim()],
    )
    assert overall(classify(evidence, permissive)) is Authority.APPLY


@pytest.mark.parametrize("authority", list(Authority))
def test_the_run_verdict_is_the_most_severe_verdict_in_it(authority, contract):
    from callibrate.policy.evidence_policy import PolicyDecision

    decisions = [PolicyDecision(Authority.REFRESH, "fine"), PolicyDecision(authority, "x")]
    assert overall(decisions) == max(Authority.REFRESH, authority)
