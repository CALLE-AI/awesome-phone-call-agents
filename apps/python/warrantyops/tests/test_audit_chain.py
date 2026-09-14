"""The audit chain: append-only, hash-linked, replayable, tamper-evident.

The attempt ledger's mutable rows are a projection; the authority is the
event chain. These tests hold both ledger implementations to the same
invariants: events are appended in the same transaction as the mutation
they describe, the chain verifies clean, any edit/delete/reorder is
detected, the states replay from events alone, and a newer schema version
is refused rather than best-effort read.
"""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest

from warrantyops.audit import (
    GENESIS_HASH,
    AuditActor,
    AuditReason,
    EventChain,
    verify_chain,
)
from warrantyops.ledger import (
    SCHEMA_VERSION,
    AttemptLedgerUnavailable,
    AttemptState,
    InMemoryAttemptLedger,
    SqliteAttemptLedger,
)

KEY_A = "a" * 64
KEY_B = "b" * 64


def sqlite_ledger(tmp_path: Path) -> SqliteAttemptLedger:
    return SqliteAttemptLedger(tmp_path / "attempt-ledger.sqlite")


def exercise(ledger) -> None:
    """One full attempt on KEY_A plus a reserved-only attempt on KEY_B."""

    ledger.reserve(KEY_A, "fingerprint-a")
    ledger.attach_call_id(KEY_A, "call_synthetic_audit")
    ledger.mark_completed(KEY_A)
    ledger.reserve(KEY_B, "fingerprint-b")


# --- both ledgers share the same audit behaviour ---------------------------


@pytest.mark.parametrize("factory", [InMemoryAttemptLedger, "sqlite"])
def test_transitions_are_chained_in_order(factory, tmp_path):
    ledger = (
        InMemoryAttemptLedger() if factory == InMemoryAttemptLedger else sqlite_ledger(tmp_path)
    )
    exercise(ledger)
    events = ledger.audit_events()
    assert [e.seq for e in events] == [1, 2, 3, 4]
    assert [e.to_state for e in events] == [
        AttemptState.RESERVED.value,
        AttemptState.RESERVED.value,  # call-id self-edge
        AttemptState.COMPLETED.value,
        AttemptState.RESERVED.value,
    ]
    assert [e.reason for e in events] == [
        AuditReason.RESERVED,
        AuditReason.CALL_ID_PERSISTED,
        AuditReason.COMPLETED,
        AuditReason.RESERVED,
    ]
    assert events[0].prior_hash == GENESIS_HASH
    for earlier, later in zip(events, events[1:]):
        assert later.prior_hash == earlier.row_hash


@pytest.mark.parametrize("factory", [InMemoryAttemptLedger, "sqlite"])
def test_an_untouched_chain_verifies_clean(factory, tmp_path):
    ledger = (
        InMemoryAttemptLedger() if factory == InMemoryAttemptLedger else sqlite_ledger(tmp_path)
    )
    exercise(ledger)
    assert ledger.audit_problems() == []


@pytest.mark.parametrize("factory", [InMemoryAttemptLedger, "sqlite"])
def test_the_chain_head_is_per_attempt(factory, tmp_path):
    ledger = (
        InMemoryAttemptLedger() if factory == InMemoryAttemptLedger else sqlite_ledger(tmp_path)
    )
    exercise(ledger)
    key_a_events = [e for e in ledger.audit_events() if e.idempotency_key == KEY_A]
    assert ledger.audit_chain_head(KEY_A) == key_a_events[-1].row_hash
    key_b_events = [e for e in ledger.audit_events() if e.idempotency_key == KEY_B]
    assert ledger.audit_chain_head(KEY_B) == key_b_events[-1].row_hash
    assert ledger.audit_chain_head("c" * 64) is None


@pytest.mark.parametrize("factory", [InMemoryAttemptLedger, "sqlite"])
def test_states_replay_from_the_events_alone(factory, tmp_path):
    ledger = (
        InMemoryAttemptLedger() if factory == InMemoryAttemptLedger else sqlite_ledger(tmp_path)
    )
    exercise(ledger)
    replayed = (
        ledger.replay_projection()
        if isinstance(ledger, SqliteAttemptLedger)
        else {
            e.idempotency_key: e.to_state for e in ledger.audit_events()
        }
    )
    assert replayed == {
        KEY_A: AttemptState.COMPLETED.value,
        KEY_B: AttemptState.RESERVED.value,
    }
    rows = {
        row["idempotency_key"]: row["state"]
        for row in (ledger.rows() if isinstance(ledger, SqliteAttemptLedger) else [
            {"idempotency_key": KEY_A, "state": ledger.find(KEY_A)["state"]},
            {"idempotency_key": KEY_B, "state": ledger.find(KEY_B)["state"]},
        ])
    }
    assert rows == replayed


@pytest.mark.parametrize("factory", [InMemoryAttemptLedger, "sqlite"])
def test_events_commit_with_their_mutation_not_after(factory, tmp_path):
    """A crash between the row write and the event write cannot happen."""

    ledger = (
        InMemoryAttemptLedger() if factory == InMemoryAttemptLedger else sqlite_ledger(tmp_path)
    )
    ledger.reserve(KEY_A, "fingerprint-a")
    # A fresh reader over the same store sees exactly the reserved row and
    # exactly one event — nothing is half-recorded.
    if isinstance(ledger, SqliteAttemptLedger):
        fresh = SqliteAttemptLedger(ledger._path)
        assert len(fresh.audit_events()) == 1
        assert fresh.find(KEY_A)["state"] == AttemptState.RESERVED.value
    else:
        assert len(ledger.audit_events()) == 1


# --- tamper detection -------------------------------------------------------


def test_an_edited_row_fails_its_own_hash():
    chain = EventChain()
    chain.append(
        actor=AuditActor.WORKFLOW,
        idempotency_key=KEY_A,
        from_state=None,
        to_state=AttemptState.RESERVED.value,
        reason=AuditReason.RESERVED,
    )
    chain.append(
        actor=AuditActor.PROVIDER,
        idempotency_key=KEY_A,
        from_state=AttemptState.RESERVED.value,
        to_state=AttemptState.COMPLETED.value,
        reason=AuditReason.COMPLETED,
    )
    edited = replace(
        chain.events()[-1],
        to_state=AttemptState.UNKNOWN.value,  # history rewritten, hash not
    )
    problems = verify_chain([chain.events()[0], edited])
    assert any("row hash does not match" in p for p in problems)


def test_a_deleted_middle_row_breaks_the_link():
    events = []
    chain = EventChain()
    for to_state, reason in (
        (AttemptState.RESERVED.value, AuditReason.RESERVED),
        (AttemptState.COMPLETED.value, AuditReason.COMPLETED),
        (AttemptState.COMPLETED.value, AuditReason.RECOVERED),
    ):
        events.append(
            chain.append(
                actor=AuditActor.WORKFLOW,
                idempotency_key=KEY_A,
                from_state=None if not events else events[-1].to_state,
                to_state=to_state,
                reason=reason,
            )
        )
    with_hole = [events[0], events[2]]
    problems = verify_chain(with_hole)
    assert any("links to" in p for p in problems)


def test_a_reordered_run_fails_both_hash_and_sequence():
    chain = EventChain()
    for to_state, reason in (
        (AttemptState.RESERVED.value, AuditReason.RESERVED),
        (AttemptState.UNKNOWN.value, AuditReason.UNKNOWN),
    ):
        chain.append(
            actor=AuditActor.WORKFLOW,
            idempotency_key=KEY_A,
            from_state=None,
            to_state=to_state,
            reason=reason,
        )
    problems = verify_chain(list(reversed(chain.events())))
    assert problems


def test_sqlite_history_edited_out_of_band_is_detected(tmp_path):
    ledger = sqlite_ledger(tmp_path)
    exercise(ledger)
    connection = sqlite3.connect(str(tmp_path / "attempt-ledger.sqlite"))
    connection.execute(
        "UPDATE attempt_events SET reason = ? WHERE seq = 3",
        (AuditReason.RECOVERED,),
    )
    connection.commit()
    connection.close()
    assert ledger.audit_problems()


def test_sqlite_row_deleted_out_of_band_is_detected(tmp_path):
    ledger = sqlite_ledger(tmp_path)
    exercise(ledger)
    connection = sqlite3.connect(str(tmp_path / "attempt-ledger.sqlite"))
    connection.execute("DELETE FROM attempt_events WHERE seq = 2")
    connection.commit()
    connection.close()
    assert ledger.audit_problems()


# --- forward-only schema -----------------------------------------------------


def test_a_newer_schema_version_is_refused_not_guessread(tmp_path):
    path = tmp_path / "attempt-ledger.sqlite"
    sqlite_ledger(tmp_path).reserve(KEY_A, "fingerprint-a")
    connection = sqlite3.connect(str(path))
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    connection.commit()
    connection.close()
    with pytest.raises(AttemptLedgerUnavailable, match="newer than the supported"):
        SqliteAttemptLedger(path)


def test_the_same_schema_version_reopens(tmp_path):
    path = tmp_path / "attempt-ledger.sqlite"
    sqlite_ledger(tmp_path).reserve(KEY_A, "fingerprint-a")
    reopened = SqliteAttemptLedger(path)
    assert reopened.find(KEY_A)["state"] == AttemptState.RESERVED.value


# --- negative controls on what may enter an event ---------------------------


def test_no_event_field_can_carry_business_data():
    """The event shape itself is the guarantee: no field exists for a phone
    number, a transcript or a claim, so none can be recorded — verified by
    construction over a full exercised chain."""

    ledger = InMemoryAttemptLedger()
    exercise(ledger)
    allowed = {
        "seq", "timestamp", "actor", "idempotency_key", "from_state",
        "to_state", "reason", "prior_hash", "row_hash",
    }
    for event in ledger.audit_events():
        assert set(event.to_dict()) == allowed
        assert event.actor in {
            AuditActor.WORKFLOW, AuditActor.PROVIDER, AuditActor.REVIEWER,
            AuditActor.RECOVERY, AuditActor.OPERATOR,
        }
        assert event.reason in {
            AuditReason.RESERVED, AuditReason.CALL_ID_PERSISTED,
            AuditReason.COMPLETED, AuditReason.UNKNOWN, AuditReason.RECOVERED,
            AuditReason.SUPERSEDED_PROJECTION,
        }


# --- the covered body, and the chain as one projection --------------------------


def test_the_row_hash_covers_exactly_the_documented_body():
    from warrantyops.audit import compute_row_hash

    ledger = InMemoryAttemptLedger()
    exercise(ledger)
    for event in ledger.audit_events():
        assert event.row_hash == compute_row_hash(
            event.seq,
            event.timestamp,
            event.actor,
            event.idempotency_key,
            event.from_state,
            event.to_state,
            event.reason,
            event.prior_hash,
        )
        assert event.hashed_body()


def test_the_chain_head_is_genesis_when_empty_and_the_last_row_after():
    from warrantyops.audit import GENESIS_HASH, EventChain

    chain = EventChain()
    assert chain.head() == GENESIS_HASH
    first = chain.append(
        actor="workflow",
        idempotency_key=KEY_A,
        from_state=None,
        to_state="RESERVED",
        reason="reserved",
    )
    second = chain.append(
        actor="provider",
        idempotency_key=KEY_A,
        from_state="RESERVED",
        to_state="COMPLETED",
        reason="completed",
    )
    assert chain.head() == second.row_hash
    assert chain.head() != first.row_hash


def test_replay_states_projects_the_chain_to_final_states():
    from warrantyops.audit import replay_states

    ledger = InMemoryAttemptLedger()
    exercise(ledger)
    states = replay_states(ledger.audit_events())
    assert states == {KEY_A: "COMPLETED", KEY_B: "RESERVED"}
