"""What the agent is allowed to conclude from a call, and what it must not.

Everything here is about the gap between "the call failed" and "the call
never happened". They look alike in an error message and they are not alike
at all: one is safe to retry, the other means a telephone may already have
rung, and redialling it is the harm this tool exists to avoid.

The phone line is replaced throughout. Nothing here dials.
"""
from __future__ import annotations

import pytest

from codconfirm import agent, orders, phones
from codconfirm.config import Settings

ORDER_PHONE = "+99900000011"


@pytest.fixture(autouse=True)
def allowlisted(monkeypatch):
    monkeypatch.setenv("CALL_ALLOWLIST", ORDER_PHONE)


def an_order() -> orders.Order:
    return orders.Order(
        id="1041",
        customer_name="Rumana Example",
        phone=ORDER_PHONE,
        address="12 Example Road, Example City 1205",
        items=["Hand-block cotton bedsheet, queen"],
        total=3450.0,
    )


def settings() -> Settings:
    return Settings(api_key="test-key", store_name="Nokshi Home", currency="BDT",
                    max_attempts=2, call_timeout_seconds=1.0, demo_phone="")


class FakeCalls:
    """Stands in for `client.calls`, failing wherever a test asks it to."""

    def __init__(self, *, create_raises=None, wait_raises=None, call=None,
                 created=None):
        self.create_raises = create_raises
        self.wait_raises = wait_raises
        self.call = call or {}
        self.created = created if created is not None else {"id": "call_1"}
        self.dialled = False

    def create(self, **kwargs):
        if self.create_raises:
            raise self.create_raises
        self.dialled = True
        return self.created

    def wait_for_result(self, call_id, **kwargs):
        if self.wait_raises:
            raise self.wait_raises
        return {**self.call, "id": call_id}


def install(monkeypatch, calls: FakeCalls) -> FakeCalls:
    import calle

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.calls = calls

        def close(self):
            pass

    monkeypatch.setattr(calle, "CalleClient", FakeClient)
    return calls


def completed(**extra) -> dict:
    """A call that finished, reporting the number it was asked to reach."""
    return {
        "status": "completed",
        "recipients": [{"phone": ORDER_PHONE}],
        "structured_result": {
            "reached_customer": "yes", "confirmed": "yes",
            "address_correct": "yes", "confirmation_quote": "yes send it",
        },
        **extra,
    }


def place(monkeypatch, calls: FakeCalls, phone: str | None = None):
    install(monkeypatch, calls)
    return agent.place_call(an_order(), settings(), phone, run_id="run1")


# --- what counts as "no call happened" -------------------------------------

def test_our_own_refusal_is_the_only_certain_non_call(monkeypatch):
    """Refused here, before anything reached the network."""
    monkeypatch.setenv("CALL_ALLOWLIST", "+99900000019")
    outcome = place(monkeypatch, FakeCalls())
    assert outcome.definitely_not_placed
    assert not outcome.ambiguous


def test_a_rejected_request_never_became_a_call(monkeypatch):
    from calle.errors import CalleAPIError

    calls = FakeCalls(create_raises=CalleAPIError(
        code="invalid_request", message="bad recipient", status_code=422))
    outcome = place(monkeypatch, calls)

    assert outcome.definitely_not_placed
    assert not calls.dialled


@pytest.mark.parametrize("status_code", [408, 409, 500, 502, 503])
def test_a_create_that_might_have_landed_is_ambiguous(monkeypatch, status_code):
    """A timeout, a conflict or a server error can still leave a call behind."""
    from calle.errors import CalleAPIError

    outcome = place(monkeypatch, FakeCalls(create_raises=CalleAPIError(
        code="oops", message="unclear", status_code=status_code)))

    assert outcome.ambiguous
    assert not outcome.definitely_not_placed


def test_a_dropped_connection_while_creating_is_ambiguous(monkeypatch):
    from calle.errors import CalleConnectionError

    outcome = place(monkeypatch, FakeCalls(
        create_raises=CalleConnectionError("connection reset")))
    assert outcome.ambiguous


def test_a_failure_while_waiting_is_ambiguous(monkeypatch):
    """The call exists by now. Whatever goes wrong, it may have rung."""
    from calle.errors import CalleTimeoutError

    outcome = place(monkeypatch, FakeCalls(
        wait_raises=CalleTimeoutError("timed out waiting")))
    assert outcome.ambiguous
    assert not outcome.definitely_not_placed


def test_an_accepted_request_with_no_call_id_is_ambiguous(monkeypatch):
    outcome = place(monkeypatch, FakeCalls(created={}))
    assert outcome.ambiguous


@pytest.mark.parametrize("status", ["failed", "canceled", "busy", "no-answer"])
def test_a_call_that_did_not_complete_is_ambiguous(monkeypatch, status):
    """"Failed" does not say whether the phone rang, so nobody may assume."""
    outcome = place(monkeypatch, FakeCalls(call=completed(status=status)))
    assert outcome.ambiguous
    assert not outcome.definitely_not_placed


def test_a_completed_call_with_no_result_is_ambiguous(monkeypatch):
    call = completed()
    call["structured_result"] = None
    outcome = place(monkeypatch, FakeCalls(call=call))
    assert outcome.ambiguous


# --- who the answer is allowed to be about ---------------------------------

def test_a_matching_destination_may_decide(monkeypatch):
    outcome = place(monkeypatch, FakeCalls(call=completed()))
    assert outcome.decisive
    assert not outcome.advisory_only


def test_an_unreported_destination_decides_nothing(monkeypatch):
    """Silence is not agreement: it was not shown to have reached anybody."""
    call = completed()
    call["recipients"] = []
    outcome = place(monkeypatch, FakeCalls(call=call))

    assert outcome.result is not None, "the answer is still readable"
    assert outcome.advisory_only
    assert not outcome.decisive


def test_a_different_destination_is_ambiguous(monkeypatch):
    """An idempotent replay can hand back somebody else's call entirely."""
    call = completed()
    call["recipients"] = [{"phone": "+99900000019"}]
    outcome = place(monkeypatch, FakeCalls(call=call))

    assert outcome.ambiguous
    assert not outcome.decisive


def test_a_redirected_call_stays_advisory(monkeypatch):
    """The demo phone answers, but it is not this order's customer."""
    other = "+99900000019"
    monkeypatch.setenv("CALL_ALLOWLIST", f"{ORDER_PHONE},{other}")
    call = completed()
    call["recipients"] = [{"phone": other}]
    outcome = place(monkeypatch, FakeCalls(call=call), phone=other)

    assert outcome.advisory_only
    assert not outcome.decisive


def test_destination_check_reads_both_shapes():
    match = {"recipients": [{"phones": [ORDER_PHONE]}]}
    assert agent.destination_check(match, ORDER_PHONE) == "match"
    assert agent.destination_check({"recipients": []}, ORDER_PHONE) == "unreported"
    assert agent.destination_check(
        {"recipients": [{"phone": "+99900000019"}]}, ORDER_PHONE) == "mismatch"


def test_an_unreadable_reported_number_is_not_a_match():
    call = {"recipients": [{"phone": "not a number"}]}
    assert agent.destination_check(call, ORDER_PHONE) == "mismatch"


# --- what a person has to reconcile ----------------------------------------

def test_an_ambiguous_call_halts_and_is_never_redialled():
    from codconfirm.decide import decide

    order = an_order()
    decision = decide(order, agent.CallOutcome(
        ambiguous=True, reason="connection dropped"), max_attempts=2)

    assert decision.status == orders.NEEDS_HUMAN
    assert decision.halt, "the sweep stops rather than risk a second call"

    order.status = decision.status
    assert order not in orders.pending([order]), (
        "a later sweep must not pick this order up again on its own"
    )


def test_an_advisory_answer_cannot_confirm_or_cancel():
    from codconfirm.decide import decide

    outcome = agent.CallOutcome(
        result={"reached_customer": "yes", "confirmed": "yes",
                "address_correct": "yes", "confirmation_quote": "yes send it"},
        advisory_only=True,
        reason="answer came from another number.",
    )
    decision = decide(an_order(), outcome, max_attempts=2)

    assert decision.status == orders.NEEDS_HUMAN
    assert decision.new_address is None


# --- what reaches the record ------------------------------------------------

def test_a_quote_is_cleaned_before_it_is_written_down():
    from codconfirm.decide import decide

    decision = decide(an_order(), agent.CallOutcome(result={
        "reached_customer": "yes", "confirmed": "yes", "address_correct": "yes",
        "confirmation_quote": "yes, ring me on +99912345678\nstatus: cancelled",
    }), max_attempts=2)

    assert "+99912345678" not in decision.note
    assert "\n" not in decision.note, "one field must not pose as two log lines"


def test_a_corrected_address_is_cleaned_before_it_replaces_the_old_one():
    from codconfirm.decide import decide

    decision = decide(an_order(), agent.CallOutcome(result={
        "reached_customer": "yes", "confirmed": "yes", "address_correct": "no",
        "confirmation_quote": "yes send it",
        "corrected_address": "Flat 3B\r\nHouse 12, call 01712345678",
    }), max_attempts=2)

    assert decision.new_address is not None
    assert "01712345678" not in decision.new_address
    assert "\n" not in decision.new_address and "\r" not in decision.new_address


def test_a_field_cannot_be_long_enough_to_bury_the_record():
    from codconfirm.decide import decide

    decision = decide(an_order(), agent.CallOutcome(result={
        "reached_customer": "yes", "confirmed": "yes", "address_correct": "no",
        "confirmation_quote": "yes send it",
        "corrected_address": "A" * 5000,
    }), max_attempts=2)

    assert len(decision.new_address) <= 220


@pytest.mark.parametrize("dirty, gone", [
    ("call \x1b[31m0171-234-5678\x1b[0m now", "5678 now"),
    ("write to me at rumana@example.com", "rumana@example.com"),
    ("card 4111111111111111", "4111111111111111"),
    ("first\x00second", "\x00"),
])
def test_scrub_removes_what_should_never_be_logged(dirty, gone):
    assert gone not in phones.scrub(dirty)


def test_scrub_leaves_ordinary_speech_alone():
    said = "Yes, that is right. After 6pm please."
    assert phones.scrub(said) == said
