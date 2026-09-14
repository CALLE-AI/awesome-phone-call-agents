"""The key comes from the authorization, and it survives a restart."""

from __future__ import annotations

import pytest

from positive_contact.dispatch import (
    LiveCallBudget,
    build_metadata,
    dispatch_intent,
)
from positive_contact.escalate import build_intent
from positive_contact.ledger import Ledger
from positive_contact.models import (
    IDEMPOTENCY_KEY_MAX_LENGTH,
    Contact,
    IntentState,
    LadderTarget,
    derive_idempotency_key,
)
from positive_contact.script import SCHEMA_VERSION, TASK_VERSION


def seed_contact(ledger, event, contact_id="pc-001", phone="+14155550101"):
    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id=contact_id,
            event_id=event.event_id,
            first_name="Maria",
            phone_e164=phone,
            locale="en-US",
            tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )


def make_intent(ledger, event, now, step=1, target=LadderTarget.PRIMARY, contact_id="pc-001"):
    return ledger.reserve_intent(
        build_intent(
            event, contact_id, step, target, not_before=now,
            task_version=TASK_VERSION, schema_version=SCHEMA_VERSION, created_at=now,
        )
    )


def test_the_key_has_the_documented_shape():
    key = derive_idempotency_key("psps-demo", "pc-001", 2, LadderTarget.PRIMARY)
    assert key == "pc:psps-demo:pc-001:2:primary"


def test_the_key_is_a_pure_function_of_the_authorization():
    first = derive_idempotency_key("e", "c", 1, LadderTarget.PRIMARY)
    second = derive_idempotency_key("e", "c", 1, LadderTarget.PRIMARY)
    assert first == second


def test_different_ladder_steps_get_different_keys():
    assert derive_idempotency_key("e", "c", 1, LadderTarget.PRIMARY) != derive_idempotency_key(
        "e", "c", 2, LadderTarget.PRIMARY
    )


def test_different_targets_get_different_keys():
    assert derive_idempotency_key("e", "c", 3, LadderTarget.PRIMARY) != derive_idempotency_key(
        "e", "c", 3, LadderTarget.ALTERNATE
    )


def test_an_over_long_key_is_refused_rather_than_truncated():
    with pytest.raises(ValueError, match="over the CALL-E limit"):
        derive_idempotency_key("e" * 300, "c", 1, LadderTarget.PRIMARY)


def test_the_demo_keys_fit_the_header_limit(event, demo_preflight):
    for contact in demo_preflight.callable_contacts:
        for step in (1, 2, 3, 4):
            key = derive_idempotency_key(event.event_id, contact.contact_id, step,
                                         LadderTarget.PRIMARY)
            assert 1 <= len(key) <= IDEMPOTENCY_KEY_MAX_LENGTH


def test_the_same_intent_yields_the_same_key_across_a_restart(event, now, tmp_path):
    """Kill the process after reserving; reopen; the key is re-derived, not re-minted."""
    db_path = tmp_path / "restart.db"
    first = Ledger(db_path)
    seed_contact(first, event)
    intent = make_intent(first, event, now)
    original_key = intent.idempotency_key
    first.close()

    reopened = Ledger(db_path)
    try:
        again = make_intent(reopened, event, now)
        assert again.idempotency_key == original_key
        assert again.intent_id == intent.intent_id
        # One intent, not two.
        assert len(reopened.list_intents_for_contact("pc-001")) == 1
    finally:
        reopened.close()


def test_a_second_submit_of_the_same_intent_is_a_no_op(
    ledger, event, policy, now, fixture_transport
):
    seed_contact(ledger, event)
    intent = make_intent(ledger, event, now)

    first = dispatch_intent(ledger, fixture_transport, event, policy, intent, now=now)
    assert first.action == "submitted"
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMITTED

    second = dispatch_intent(ledger, fixture_transport, event, policy, intent, now=now)
    assert second.action == "skipped"
    assert ledger.count_calls_for_contact("pc-001") == 1
    assert len(fixture_transport.submitted_payloads) == 1


def test_replaying_the_key_returns_the_original_call(ledger, event, policy, now,
                                                     fixture_transport):
    """The provider contract: the same key with the same request returns the same call."""
    seed_contact(ledger, event)
    intent = make_intent(ledger, event, now)
    metadata = build_metadata(intent)
    first = fixture_transport.submit(
        task_text="t", phone_e164="+14155550101", locale="en-US", region="US",
        recipient_result_schema={}, idempotency_key=intent.idempotency_key, metadata=metadata,
    )
    second = fixture_transport.submit(
        task_text="t", phone_e164="+14155550101", locale="en-US", region="US",
        recipient_result_schema={}, idempotency_key=intent.idempotency_key, metadata=metadata,
    )
    assert first.call_id == second.call_id
    assert len(fixture_transport.submitted_payloads) == 1


def test_the_call_id_is_bound_before_the_transition_is_appended(
    ledger, event, policy, now, fixture_transport
):
    """A crash between the two must leave a call we can still account for."""
    seed_contact(ledger, event)
    intent = make_intent(ledger, event, now)
    dispatch_intent(ledger, fixture_transport, event, policy, intent, now=now)
    attempt = ledger.get_attempt(intent.intent_id)
    assert attempt is not None
    assert attempt.call_id.startswith("call_")


def test_an_orphaned_binding_is_recovered_instead_of_redialled(
    ledger, event, policy, now, fixture_transport
):
    """Simulate a crash after `bind_attempt` but before the transition landed."""
    from positive_contact.models import Attempt

    seed_contact(ledger, event)
    intent = make_intent(ledger, event, now)
    ledger.bind_attempt(
        Attempt(intent_id=intent.intent_id, call_id="call_orphan_1", submitted_at=now)
    )
    assert ledger.reconstruct(intent.intent_id) is IntentState.RESERVED

    outcome = dispatch_intent(ledger, fixture_transport, event, policy, intent, now=now)
    assert outcome.action == "skipped"
    assert outcome.call_id == "call_orphan_1"
    assert ledger.reconstruct(intent.intent_id) is IntentState.SUBMITTED
    # No new call was submitted to recover the binding.
    assert fixture_transport.submitted_payloads == []


def test_the_metadata_carries_the_binding(event, now, ledger):
    seed_contact(ledger, event)
    intent = make_intent(ledger, event, now)
    metadata = build_metadata(intent)
    assert metadata["pc_event_id"] == event.event_id
    assert metadata["pc_contact_id"] == "pc-001"
    assert metadata["pc_intent_id"] == intent.intent_id
    assert metadata["pc_ladder_step"] == "1"
    assert metadata["pc_target"] == "primary"
    assert metadata["pc_task_version"] == TASK_VERSION
    assert metadata["pc_schema_version"] == SCHEMA_VERSION


def test_the_live_budget_is_a_hard_ceiling():
    from positive_contact.dispatch import BudgetExceeded

    budget = LiveCallBudget(2)
    budget.reserve()
    budget.reserve()
    assert budget.remaining == 0
    with pytest.raises(BudgetExceeded, match="max-calls"):
        budget.reserve()


def test_an_unlimited_budget_is_only_for_offline_modes():
    budget = LiveCallBudget(None)
    assert budget.unlimited
    for _ in range(50):
        budget.reserve()
