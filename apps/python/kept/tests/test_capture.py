from __future__ import annotations

from typing import Any

import pytest
from tests.conftest import at, make_customer, make_invoice

from kept.calls.port import PlacedCall, task_digest
from kept.capture import CallBinding, CaptureVerdict, PromiseCapture, RejectionReason
from kept.config import Policy
from kept.models import CallCycle, CallTarget

NOW = at("2026-08-24")

_GOOD_ANSWER = {
    "outcome": "promise_to_pay",
    "right_party_reached": "yes",
    "promise_made": "yes",
    "promised_amount": "1250.00",
    "promised_date": "2026-08-31",
    "payment_method": "bank_transfer",
    "dispute_raised": "no",
    "dispute_reason": "unknown",
    "evidence_quote": "We'll send the twelve fifty on the thirty-first.",
}


def _target(outstanding_minor: int = 125_000) -> CallTarget:
    return CallTarget(
        invoice=make_invoice(amount_minor=outstanding_minor),
        customer=make_customer(),
        cycle=CallCycle.FIRST_CONTACT,
        outstanding_minor=outstanding_minor,
        broken_promise_count=0,
    )


_CALL_ID = "call_sim_0001"
_PHONE = "+12025550101"
_TASK = "Ask about INV-1001."
_METADATA = {"invoice_id": "INV-1001", "customer_id": "CUS-01", "cycle": "first_contact"}


def _placed(result: dict[str, Any] | None, *, status: str = "completed", confidence: float = 0.9):
    return PlacedCall(
        call_id=_CALL_ID,
        status=status,
        task_completed=status == "completed",
        confidence=confidence,
        structured_result=result,
        summary=None,
        task=_TASK,
        metadata=dict(_METADATA),
        phones=(_PHONE,),
    )


def binding(**overrides: Any) -> CallBinding:
    fields: dict[str, Any] = {
        "call_id": _CALL_ID,
        "phone": _PHONE,
        "metadata": dict(_METADATA),
        "task_digest": task_digest(_TASK),
    }
    fields.update(overrides)
    return CallBinding(**fields)


def _capture(policy: Policy, placed: PlacedCall, target: CallTarget | None = None):
    subject = _target() if target is None else target
    return PromiseCapture(policy=policy).capture(placed, subject, NOW, binding())


def test_a_clear_commitment_becomes_a_promise(policy: Policy) -> None:
    result = _capture(policy, _placed(dict(_GOOD_ANSWER)))

    assert result.verdict is CaptureVerdict.PROMISE_RECORDED
    assert result.promise is not None
    assert result.promise.amount_minor == 125_000
    assert result.promise.due_date.isoformat() == "2026-08-31"


def test_a_stated_dispute_stops_collection_and_records_the_reason(policy: Policy) -> None:
    answer = {**_GOOD_ANSWER, "outcome": "dispute", "dispute_raised": "yes", "dispute_reason": "Billed twice."}

    result = _capture(policy, _placed(answer), _target())

    assert result.verdict is CaptureVerdict.DISPUTE_RECORDED
    assert result.dispute is not None
    assert result.dispute.reason == "Billed twice."
    assert result.promise is None


@pytest.mark.parametrize(
    ("override", "expected"),
    [
        ({"promise_made": "no"}, RejectionReason.NO_COMMITMENT),
        ({"outcome": "unclear"}, RejectionReason.NO_COMMITMENT),
        ({"right_party_reached": "no"}, RejectionReason.WRONG_PARTY),
        ({"right_party_reached": "unknown"}, RejectionReason.WRONG_PARTY),
        ({"promised_amount": "most of it"}, RejectionReason.UNREADABLE_AMOUNT),
        ({"promised_amount": "unknown"}, RejectionReason.UNREADABLE_AMOUNT),
        ({"promised_amount": None}, RejectionReason.UNREADABLE_AMOUNT),
        ({"promised_date": "next Friday"}, RejectionReason.UNREADABLE_DATE),
        ({"promised_date": "unknown"}, RejectionReason.UNREADABLE_DATE),
        ({"promised_date": None}, RejectionReason.UNREADABLE_DATE),
        ({"promised_date": "2026-08-01"}, RejectionReason.DATE_IN_PAST),
        ({"promised_date": "2027-06-01"}, RejectionReason.DATE_BEYOND_HORIZON),
    ],
)
def test_anything_short_of_a_dated_commitment_is_handed_to_a_human(
    policy: Policy, override: dict[str, Any], expected: RejectionReason
) -> None:
    result = _capture(policy, _placed({**_GOOD_ANSWER, **override}), _target())

    assert result.verdict is CaptureVerdict.NO_RECORD
    assert result.rejection is expected
    assert result.promise is None


def test_a_confident_sounding_but_low_confidence_call_records_nothing(policy: Policy) -> None:
    result = _capture(policy, _placed(dict(_GOOD_ANSWER), confidence=0.4), _target())

    assert result.rejection is RejectionReason.LOW_CONFIDENCE


def test_a_failed_call_never_produces_a_record(policy: Policy) -> None:
    result = _capture(policy, _placed(None, status="failed"), _target())

    assert result.rejection is RejectionReason.CALL_NOT_COMPLETED


def test_a_completed_call_with_no_structured_result_records_nothing(policy: Policy) -> None:
    result = _capture(policy, _placed(None), _target())

    assert result.rejection is RejectionReason.MISSING_STRUCTURED_RESULT


def test_a_result_missing_required_fields_is_treated_as_malformed(policy: Policy) -> None:
    result = _capture(policy, _placed({"outcome": "promise_to_pay"}), _target())

    assert result.rejection is RejectionReason.MALFORMED_RESULT


def test_an_over_promise_is_clamped_to_what_the_invoice_can_carry(policy: Policy) -> None:
    answer = {**_GOOD_ANSWER, "promised_amount": "5000.00"}

    result = _capture(policy, _placed(answer), _target(125_000))

    assert result.promise is not None
    assert result.promise.amount_minor == 125_000
    assert result.spoken_amount_minor == 500_000
    assert result.was_clamped is True


def test_the_not_stated_sentinel_is_read_as_an_absent_value(policy: Policy) -> None:
    """CALL-E cannot send null, so `unknown` must mean the same thing locally."""
    answer = {**_GOOD_ANSWER, "payment_method": "unknown"}

    result = _capture(policy, _placed(answer), _target())

    assert result.promise is not None
    assert result.promise.method == "unknown"


def test_a_dispute_with_the_sentinel_reason_falls_back_to_the_quote(policy: Policy) -> None:
    answer = {**_GOOD_ANSWER, "dispute_raised": "yes", "dispute_reason": "unknown"}

    result = _capture(policy, _placed(answer), _target())

    assert result.dispute is not None
    assert result.dispute.reason == _GOOD_ANSWER["evidence_quote"]


def test_a_promise_due_today_is_still_a_promise(policy: Policy) -> None:
    answer = {**_GOOD_ANSWER, "promised_date": NOW.date().isoformat()}

    result = _capture(policy, _placed(answer), _target())

    assert result.verdict is CaptureVerdict.PROMISE_RECORDED
