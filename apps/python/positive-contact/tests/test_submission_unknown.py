"""An unknown submission is a state to reconcile, not an error to retry."""

from __future__ import annotations

from positive_contact.dispatch import dispatch_intent, reconcile_unknown_submission
from positive_contact.escalate import build_intent
from positive_contact.models import Contact, IntentState, LadderTarget
from positive_contact.script import SCHEMA_VERSION, TASK_VERSION
from positive_contact.transports.base import SubmitResult


class UnknownTransport:
    """Always leaves the caller unsure whether a call was placed."""

    def __init__(self):
        self.submits = []

    def submit(self, **kwargs):
        self.submits.append(kwargs)
        return SubmitResult.unknown("provider did not confirm", "provider_unavailable")

    def read(self, call_id):  # pragma: no cover - never reached in these tests
        raise AssertionError("read must not be called for an unknown submission")


class RecoveringTransport(UnknownTransport):
    """Unknown first, then returns the original call when the key is replayed."""

    def submit(self, **kwargs):
        self.submits.append(kwargs)
        if len(self.submits) == 1:
            return SubmitResult.unknown("provider did not confirm", "provider_unavailable")
        return SubmitResult.accepted("call_recovered_1")


class RejectingTransport(UnknownTransport):
    def submit(self, **kwargs):
        self.submits.append(kwargs)
        return SubmitResult.rejected("this number is blocked", "recipient_blocked")


def seed(ledger, event, now):
    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id="pc-001",
            event_id=event.event_id,
            first_name="Maria",
            phone_e164="+14155550101",
            locale="en-US",
            tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )
    return ledger.reserve_intent(
        build_intent(
            event, "pc-001", 1, LadderTarget.PRIMARY, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )


def test_an_unknown_submission_sets_submission_unknown_and_stops(ledger, event, policy, now):
    intent = seed(ledger, event, now)
    transport = UnknownTransport()
    outcome = dispatch_intent(ledger, transport, event, policy, intent, now=now)
    assert outcome.action == "unknown"
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMISSION_UNKNOWN
    assert len(transport.submits) == 1


def test_an_unknown_submission_binds_no_call_id(ledger, event, policy, now):
    intent = seed(ledger, event, now)
    dispatch_intent(ledger, UnknownTransport(), event, policy, intent, now=now)
    assert ledger.get_attempt(intent.intent_id) is None
    assert ledger.count_calls_for_contact("pc-001") == 0


def test_an_unknown_submission_never_creates_a_new_intent_or_key(ledger, event, policy, now):
    intent = seed(ledger, event, now)
    transport = UnknownTransport()
    dispatch_intent(ledger, transport, event, policy, intent, now=now)
    dispatch_intent(ledger, transport, event, policy, intent, now=now)

    intents = ledger.list_intents_for_contact("pc-001")
    assert len(intents) == 1
    assert {item.idempotency_key for item in intents} == {intent.idempotency_key}
    # Every submit replayed the identical key.
    assert {call["idempotency_key"] for call in transport.submits} == {intent.idempotency_key}


def test_the_ladder_does_not_advance_past_an_unknown_submission(ledger, event, policy, now):
    intent = seed(ledger, event, now)
    dispatch_intent(ledger, UnknownTransport(), event, policy, intent, now=now)
    # No step 2 was scheduled.
    assert [item.ladder_step for item in ledger.list_intents_for_contact("pc-001")] == [1]


def test_reconciliation_replays_the_same_key_and_recovers_the_call(
    ledger, event, policy, now
):
    intent = seed(ledger, event, now)
    transport = RecoveringTransport()
    dispatch_intent(ledger, transport, event, policy, intent, now=now)
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMISSION_UNKNOWN

    outcome = reconcile_unknown_submission(ledger, transport, event, intent, policy=policy, now=now)
    assert outcome.action == "reconciled"
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMITTED
    assert ledger.get_attempt(intent.intent_id).call_id == "call_recovered_1"
    assert len(transport.submits) == 2
    assert transport.submits[0]["idempotency_key"] == transport.submits[1]["idempotency_key"]


def test_reconciliation_sends_a_byte_identical_body(ledger, event, policy, now):
    """Changing the body behind a key would return 409 idempotency_conflict."""
    intent = seed(ledger, event, now)
    transport = RecoveringTransport()
    dispatch_intent(ledger, transport, event, policy, intent, now=now)
    reconcile_unknown_submission(ledger, transport, event, intent, policy=policy, now=now)
    first, second = transport.submits
    for field in ("task_text", "phone_e164", "locale", "region", "metadata",
                  "recipient_result_schema"):
        assert first[field] == second[field], field


def test_a_reconciliation_that_still_fails_routes_to_a_human(ledger, event, policy, now):
    intent = seed(ledger, event, now)
    dispatch_intent(ledger, UnknownTransport(), event, policy, intent, now=now)
    outcome = reconcile_unknown_submission(
        ledger, RejectingTransport(), event, intent, policy=policy, now=now
    )
    assert outcome.action == "rejected"
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN


def test_a_reconciliation_that_stays_unknown_holds_the_state(ledger, event, policy, now):
    intent = seed(ledger, event, now)
    transport = UnknownTransport()
    dispatch_intent(ledger, transport, event, policy, intent, now=now)
    outcome = reconcile_unknown_submission(ledger, transport, event, intent, policy=policy, now=now)
    assert outcome.action == "unknown"
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMISSION_UNKNOWN


def test_a_definite_rejection_routes_to_a_human_without_dialling_again(
    ledger, event, policy, now
):
    intent = seed(ledger, event, now)
    transport = RejectingTransport()
    outcome = dispatch_intent(ledger, transport, event, policy, intent, now=now)
    assert outcome.action == "rejected"
    assert ledger.reconstruct(intent.intent_id) is IntentState.NEEDS_HUMAN
    assert len(transport.submits) == 1
    assert ledger.count_calls_for_contact("pc-001") == 0


def test_the_rejection_path_is_recorded_through_the_documented_states(
    ledger, event, policy, now
):
    """RESERVED has only two exits in the diagram, so a rejection travels through both."""
    intent = seed(ledger, event, now)
    dispatch_intent(ledger, RejectingTransport(), event, policy, intent, now=now)
    states = [row.to_state for row in ledger.list_transitions(intent.intent_id)]
    assert states == [
        IntentState.RESERVED,
        IntentState.SUBMISSION_UNKNOWN,
        IntentState.NEEDS_HUMAN,
    ]
