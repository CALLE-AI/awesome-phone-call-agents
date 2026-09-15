"""Schema checking and evidence groundedness."""
from __future__ import annotations

import json
import os

import pytest

from tests.helpers import FIXTURES_DIR
from trunkline import hold, verify, workflows
from trunkline.models import (
    OUTCOME_ANSWERED,
    OUTCOME_PARTIAL,
    OUTCOME_UNREACHED,
    OUTCOME_UNUSABLE,
    UNKNOWN,
    Claim,
)


def claim(number: str, workflow: str = "claim_status") -> Claim:
    return Claim(id="c_" + number[-4:], practice_id="p", payer_id="pay_meridian",
                 patient_ref="pt_0001", workflow=workflow, claim_number=number,
                 date_of_service="2026-07-29", billed_amount=300.0, filing_deadline="2027-01-25")


def fixture(name: str):
    with open(os.path.join(FIXTURES_DIR, name + ".json"), "r", encoding="utf-8") as handle:
        return json.load(handle)


TRIO = [claim("CLM-2026-004417"), claim("CLM-2026-004612"), claim("CLM-2026-004733")]


def run(name: str, workflow: str = "claim_status", claims=None):
    payload = fixture(name)
    turns = hold.transcript_turns(payload)
    return verify.verify(payload, workflow, claims or TRIO, turns)


def test_a_good_call_is_answered():
    result = run("claim_status_paid")
    assert result.outcome == OUTCOME_ANSWERED
    assert result.grounded_claims == 3
    assert result.reference_number == "MHP-REF-88417203"


def test_a_fabricated_quote_is_caught_and_only_that_claim_is_reset():
    result = run("ungrounded_evidence")
    assert result.outcome == OUTCOME_PARTIAL
    assert result.ungrounded_claims == 1
    reset = result.per_claim["c_4612"]
    assert reset["claim_status"] == UNKNOWN
    assert reset["evidence_quote"] == UNKNOWN
    # The other two claims on the same call keep their answers.
    assert result.per_claim["c_4417"]["claim_status"] == "paid"
    assert result.per_claim["c_4733"]["claim_status"] == "pending"


def test_an_out_of_schema_result_is_refused_whole():
    result = run("schema_violation")
    assert result.outcome == OUTCOME_UNUSABLE
    assert "adjudication_note" in result.findings[0]


def test_a_failed_call_is_unreached():
    assert run("unreached_busy").outcome == OUTCOME_UNREACHED


def test_hold_timeout_records_nothing():
    result = run("hold_timeout")
    assert result.outcome == "hold_timeout"
    assert result.per_claim == {}


def test_a_claim_never_raised_on_the_call_is_blanked():
    result = run("not_on_file", claims=[claim("CLM-2026-004733"), claim("CLM-2026-009999")])
    missing = result.per_claim["c_9999"]
    assert missing["claim_status"] == UNKNOWN
    assert any("9999" in finding for finding in result.findings)


@pytest.mark.parametrize(
    "name,workflow,number",
    [
        ("denial_reason_co97", "denial_reason", "CLM-2026-004612"),
        ("prior_auth_pending", "prior_auth_status", "PA-2026-11832"),
        ("eligibility_active", "eligibility", "CLM-2026-004901"),
    ],
)
def test_every_workflow_reaches_answered(name, workflow, number):
    result = run(name, workflow, [claim(number, workflow)])
    assert result.outcome == OUTCOME_ANSWERED


def test_claim_number_matching_ignores_formatting():
    assert verify.normalize_claim_number("CLM-2026-004417") == verify.normalize_claim_number("clm 2026 004417")


def test_groundedness_accepts_a_tidied_quote():
    spoken = "okay that one processed and paid on August twenty first, one hundred forty two dollars"
    assert verify.is_grounded("that one processed and paid on August twenty first", spoken)


def test_groundedness_rejects_an_invented_sentence():
    spoken = "the claim is still in process and nothing has been determined"
    assert not verify.is_grounded("it denied under adjustment code CO ninety seven", spoken)


def test_groundedness_rejects_a_quote_too_short_to_confirm():
    assert not verify.is_grounded("paid", "the claim was paid last week")


def test_schema_rejects_a_missing_field():
    with pytest.raises(verify.SchemaError):
        verify.validate_against_schema({"call_outcome": "answered"}, workflows.get("claim_status").schema)


def test_schema_rejects_a_value_outside_an_enum():
    with pytest.raises(verify.SchemaError):
        verify.validate_against_schema(
            {"claim_number": "x", "claim_status": "processed", "paid_amount": "1",
             "allowed_amount": "1", "patient_responsibility": "1", "check_number": "1",
             "paid_date": "2026-01-01", "evidence_quote": "q"},
            workflows.CLAIM_STATUS_ITEM,
        )


def test_completeness_is_status_aware():
    """A denied claim has no allowed amount; that is a complete answer, not a partial one."""
    workflow = workflows.get("claim_status")
    denied = {"claim_status": "denied", "paid_amount": UNKNOWN, "paid_date": UNKNOWN}
    paid_without_amount = {"claim_status": "paid", "paid_amount": UNKNOWN, "paid_date": UNKNOWN}
    assert workflow.is_complete(denied)
    assert not workflow.is_complete(paid_without_amount)
