"""The audit trail is the truth. `intents.state` is only a cache of it."""

from __future__ import annotations

import sqlite3
from datetime import timedelta

import pytest

from positive_contact.escalate import IllegalTransition, build_intent
from positive_contact.ledger import Ledger, LedgerError
from positive_contact.models import Contact, IntentState, LadderTarget
from positive_contact.script import SCHEMA_VERSION, TASK_VERSION


def _seed(ledger: Ledger, event, now, contact_id="pc-001"):
    ledger.put_event(event)
    ledger.put_contact(
        Contact(
            contact_id=contact_id,
            event_id=event.event_id,
            first_name="Maria",
            phone_e164="+14155550101",
            locale="en-US",
            tz="America/Los_Angeles",
            service_address_short="1200 block of Elm St",
        )
    )
    intent = build_intent(
        event,
        contact_id,
        1,
        LadderTarget.PRIMARY,
        not_before=now,
        task_version=TASK_VERSION,
        schema_version=SCHEMA_VERSION,
        created_at=now,
    )
    return ledger.reserve_intent(intent)


def test_reconstruct_returns_the_opening_state(ledger, event, now):
    intent = _seed(ledger, event, now)
    assert ledger.reconstruct(intent.intent_id) is IntentState.RESERVED


def test_reconstruct_replays_a_chain(ledger, event, now):
    intent = _seed(ledger, event, now)
    ledger.append_transition(
        intent.intent_id, IntentState.RESERVED, IntentState.SUBMITTED, "call_submitted", at=now
    )
    ledger.append_transition(
        intent.intent_id,
        IntentState.SUBMITTED,
        IntentState.TERMINAL_UNVERIFIED,
        "terminal_status_completed",
        at=now,
    )
    assert ledger.reconstruct(intent.intent_id) is IntentState.TERMINAL_UNVERIFIED


def test_a_crash_between_two_transitions_leaves_a_reconstructible_state(
    ledger, event, now, tmp_path
):
    """Write one transition, drop the process, reopen the file, and read the state back."""
    db_path = tmp_path / "crash.db"
    first = Ledger(db_path)
    intent = _seed(first, event, now)
    first.append_transition(
        intent.intent_id, IntentState.RESERVED, IntentState.SUBMITTED, "call_submitted", at=now
    )
    # The process dies here, before the next transition is ever appended.
    first.close()

    reopened = Ledger(db_path)
    try:
        assert reopened.reconstruct(intent.intent_id) is IntentState.SUBMITTED
        # And the ladder can carry on from exactly where it stopped.
        reopened.append_transition(
            intent.intent_id,
            IntentState.SUBMITTED,
            IntentState.TERMINAL_UNVERIFIED,
            "terminal_status_completed",
            at=now + timedelta(minutes=1),
        )
        assert reopened.reconstruct(intent.intent_id) is IntentState.TERMINAL_UNVERIFIED
        assert len(reopened.list_transitions(intent.intent_id)) == 3
    finally:
        reopened.close()


def test_transitions_cannot_be_updated(ledger, event, now):
    intent = _seed(ledger, event, now)
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        ledger.conn.execute(
            "UPDATE transitions SET to_state = 'CONFIRMED' WHERE intent_id = ?",
            (intent.intent_id,),
        )


def test_transitions_cannot_be_deleted(ledger, event, now):
    intent = _seed(ledger, event, now)
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        ledger.conn.execute(
            "DELETE FROM transitions WHERE intent_id = ?", (intent.intent_id,)
        )


def test_a_non_contiguous_trail_is_detected(ledger, event, now):
    intent = _seed(ledger, event, now)
    # A row whose from_state does not follow the previous row's to_state.
    ledger.conn.execute(
        "INSERT INTO transitions (intent_id, from_state, to_state, reason_code, "
        "evidence_refs_json, actor, at) VALUES (?,?,?,?,?,?,?)",
        (
            intent.intent_id,
            IntentState.ADJUDICATED.value,
            IntentState.CONFIRMED.value,
            "forged",
            "{}",
            "system",
            now.isoformat(),
        ),
    )
    ledger.conn.commit()
    with pytest.raises(LedgerError, match="not contiguous"):
        ledger.reconstruct(intent.intent_id)


def test_a_trail_with_an_impossible_edge_is_detected(ledger, event, now):
    intent = _seed(ledger, event, now)
    ledger.conn.execute(
        "INSERT INTO transitions (intent_id, from_state, to_state, reason_code, "
        "evidence_refs_json, actor, at) VALUES (?,?,?,?,?,?,?)",
        (
            intent.intent_id,
            IntentState.RESERVED.value,
            IntentState.CONFIRMED.value,
            "forged_shortcut_to_confirmed",
            "{}",
            "system",
            now.isoformat(),
        ),
    )
    ledger.conn.commit()
    with pytest.raises(IllegalTransition):
        ledger.reconstruct(intent.intent_id)


def test_reserving_the_same_key_twice_returns_the_first_intent(ledger, event, now):
    intent = _seed(ledger, event, now)
    again = _seed(ledger, event, now)
    assert again.intent_id == intent.intent_id
    assert len(ledger.list_transitions(intent.intent_id)) == 1
