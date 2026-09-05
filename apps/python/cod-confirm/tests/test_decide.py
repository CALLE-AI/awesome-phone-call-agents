"""The decision table. These run with no API key and no calls."""
from __future__ import annotations

from codconfirm.agent import CallOutcome
from codconfirm.decide import decide
from codconfirm.orders import CANCELLED, CONFIRMED, NEEDS_HUMAN, PENDING, Order


def order(**kwargs) -> Order:
    base = dict(
        id="1",
        customer_name="Test",
        phone="+8801700000000",
        address="House 1, Dhaka",
        items=["Item"],
        total=1000.0,
    )
    base.update(kwargs)
    return Order(**base)


def test_clear_yes_confirms():
    result = {
        "reached_customer": "yes",
        "confirmed": "yes",
        "address_correct": "yes",
        "confirmation_quote": "yes please send it",
    }
    assert decide(order(), CallOutcome(result=result), max_attempts=2).status == CONFIRMED


def test_a_yes_the_customer_never_said_is_not_a_yes():
    result = {"reached_customer": "yes", "confirmed": "yes", "address_correct": "yes"}
    outcome = decide(order(), CallOutcome(result=result), max_attempts=2)
    assert outcome.status == NEEDS_HUMAN
    assert "never said" in outcome.note


def test_declined_cancels():
    result = {
        "reached_customer": "yes",
        "confirmed": "no",
        "address_correct": "unclear",
        "decline_reason": "changed my mind",
    }
    outcome = decide(order(), CallOutcome(result=result), max_attempts=2)
    assert outcome.status == CANCELLED
    assert "changed my mind" in outcome.note


def test_corrected_address_is_carried_through():
    result = {
        "reached_customer": "yes",
        "confirmed": "yes",
        "address_correct": "no",
        "corrected_address": "Flat 3B, House 1, Dhaka",
        "confirmation_quote": "yes I want it",
    }
    outcome = decide(order(), CallOutcome(result=result), max_attempts=2)
    assert outcome.status == CONFIRMED
    assert outcome.new_address == "Flat 3B, House 1, Dhaka"


def test_wrong_address_with_no_correction_needs_a_human():
    result = {
        "reached_customer": "yes",
        "confirmed": "yes",
        "address_correct": "no",
        "confirmation_quote": "yes I want it",
    }
    assert decide(order(), CallOutcome(result=result), max_attempts=2).status == NEEDS_HUMAN


def test_no_answer_retries_then_escalates():
    result = {"reached_customer": "no", "confirmed": "unclear", "address_correct": "unclear"}
    assert decide(order(attempts=0), CallOutcome(result=result), max_attempts=2).status == PENDING
    assert decide(order(attempts=1), CallOutcome(result=result), max_attempts=2).status == NEEDS_HUMAN


def test_ambiguous_answer_never_retries():
    result = {"reached_customer": "yes", "confirmed": "unclear", "address_correct": "yes"}
    assert decide(order(attempts=0), CallOutcome(result=result), max_attempts=3).status == NEEDS_HUMAN


def test_failed_call_is_not_a_cancellation():
    assert decide(order(attempts=0), CallOutcome(), max_attempts=2).status == PENDING
    assert decide(order(attempts=1), CallOutcome(), max_attempts=2).status == NEEDS_HUMAN


# --- what the review asked for --------------------------------------------

def test_an_uncertain_call_is_never_redialled():
    """A timeout leaves nobody knowing whether the phone rang.

    Marking the order pending would let a later sweep ring the same customer
    again to ask the same question. That is the one failure this must not
    cause, so the order escalates and the sweep stops.
    """
    outcome = decide(
        order(attempts=0),
        CallOutcome(ambiguous=True, reason="connection dropped"),
        max_attempts=3,
    )
    assert outcome.status == NEEDS_HUMAN
    assert outcome.halt is True
    assert "will not be redialled" in outcome.note


def test_an_answer_from_another_number_decides_nothing():
    """A redirected demo call is somebody else's conversation."""
    result = {
        "reached_customer": "yes",
        "confirmed": "yes",
        "address_correct": "yes",
        "confirmation_quote": "yes please send it",
    }
    outcome = decide(
        order(),
        CallOutcome(result=result, advisory_only=True,
                    reason="answered on a redirected number."),
        max_attempts=2,
    )
    assert outcome.status == NEEDS_HUMAN
    assert "Advisory" in outcome.note


def test_a_definite_failure_is_still_safe_to_retry():
    outcome = decide(order(attempts=0),
                     CallOutcome(definitely_not_placed=True, reason="refused"),
                     max_attempts=2)
    assert outcome.status == PENDING
    assert outcome.halt is False
