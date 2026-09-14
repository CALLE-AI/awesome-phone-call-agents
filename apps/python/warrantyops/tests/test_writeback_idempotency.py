"""P11: one approved write is one write, however many times it is replayed.

The same review, re-written, is an idempotent replay: the same note id, the
same content, the first write's timestamp, and a receipt that says it was a
replay. A *different* review landing on the same note identity is a
conflict, refused by name — two approvals of one write is one approval too
many, and which review governs is not this code's decision.
"""

from __future__ import annotations

import dataclasses
from datetime import datetime, timedelta, timezone

from warrantyops.contract import build_extraction_schema
from warrantyops.identifiers import TranscriptTurn
from warrantyops.outcome import TransportOutcome, TransportState, derive_outcome
from warrantyops.review import ReviewDecision, ReviewRecord, prepare_review
from warrantyops.source import InMemorySourceStore
from warrantyops.validation import validate_structured_result
from warrantyops.writeback import (
    InMemoryNoteLedger,
    WriteBackOutcome,
    WriteBackRefusal,
    same_write,
    write_back,
    write_back_outcome,
)

SCHEMA = build_extraction_schema()
NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
LATER = NOW + timedelta(hours=3)

TRANSCRIPT = (
    TranscriptTurn(speaker="bot", text="May I ask about warranty claim CLM-1042?"),
    TranscriptTurn(
        speaker="user",
        text="It is showing returned in our system. The labour line has no "
        "operating-hours reading attached.",
    ),
    TranscriptTurn(speaker="bot", text="What do you need from us?"),
    TranscriptTurn(
        speaker="user",
        text="Send a photograph of the hour meter with the reading visible.",
    ),
)

PAYLOAD = {
    "claim_status": "STATED_RETURNED",
    "claim_status_evidence_quote": "It is showing returned in our system.",
    "stated_reason": "The labour line has no operating-hours reading attached.",
    "required_correction": None,
    "required_documents": ["photograph of the hour meter with the reading visible"],
    "stated_deadline": None,
    "escalation_path": None,
    "stated_next_action": None,
    "reference_kind": "UNKNOWN",
    "reference_heard": None,
    "reference_readback_performed": False,
    "reference_confirmed": None,
    "reference_confirmation_quote": None,
}


def claim():
    from datetime import date
    from decimal import Decimal

    from warrantyops.envelope import ExceptionStatus, OrdinaryRemedy, SourceClaim

    return SourceClaim(
        source_platform="SYNTHETIC-DMS",
        source_claim_id="CLM-1042",
        source_version="v7",
        exception_status=ExceptionStatus.RETURNED,
        submitted_at=date(2026, 8, 1),
        caller_organization="Example Equipment Dealers",
        account_context="dealer account 4471",
        counterparty_phone_e164="+12025550142",
        economic_policy_id="standard-pursuit",
        claim_face_value=Decimal("4820.50"),
        claim_currency="USD",
        ordinary_remedies=(
            OrdinaryRemedy("portal_status_check", "no detail"),
            OrdinaryRemedy("documented_code_resolution", "not covered"),
            OrdinaryRemedy("written_follow_up", "no reply"),
        ),
    )


def completed_outcome():
    validation = validate_structured_result(dict(PAYLOAD), SCHEMA)
    return derive_outcome(
        TransportOutcome(
            state=TransportState.COMPLETED, call_id="call_synthetic_idempotency"
        ),
        validation,
        transcript=TRANSCRIPT,
    )


def approve(packet, **overrides):
    base = {
        "decision": ReviewDecision.APPROVE,
        "reviewer": "test-reviewer",
        "decided_at": NOW,
        "review_id": packet.review_id,
        "packet_sha256": packet.packet_sha256,
        "operator_id": "operator-test",
    }
    base.update(overrides)
    return ReviewRecord(**base)


def seeded_store():
    store = InMemorySourceStore()
    store.set_version("SYNTHETIC-DMS", "CLM-1042", "v7")
    return store


# --- replay -----------------------------------------------------------------


def test_the_same_review_replayed_writes_once_and_documents_the_replay():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    ledger = InMemoryNoteLedger()
    first = write_back(
        claim(), seeded_store(), ledger, packet, approve(packet), outcome,
        idempotency_key="k", written_at=NOW,
    )
    assert not isinstance(first, WriteBackRefusal)
    assert first.replayed is False
    # The identical decision, replayed hours later by the same operator.
    replay = write_back(
        claim(), seeded_store(), ledger, packet, approve(packet), outcome,
        idempotency_key="k", written_at=LATER,
    )
    assert replay is not None and not isinstance(replay, WriteBackRefusal)
    assert replay.note_id == first.note_id  # type: ignore[union-attr]
    assert replay.replayed is True  # type: ignore[union-attr]
    # The note keeps its original timestamp and there is exactly one entry.
    assert replay.written_at == first.written_at  # type: ignore[union-attr]
    assert len(ledger.entries) == 1
    assert same_write(first, replay)  # type: ignore[arg-type]


def test_a_replayed_write_creates_no_second_entry_even_after_restart():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    ledger = InMemoryNoteLedger()
    write_back(
        claim(), seeded_store(), ledger, packet, approve(packet), outcome,
        idempotency_key="k", written_at=NOW,
    )
    # A "restart": a fresh note ledger seeded from the first's entries, as
    # an adapter over a durable system of record would see them.
    restored = InMemoryNoteLedger(entries=dict(ledger.entries))
    replay = write_back(
        claim(), seeded_store(), restored, packet, approve(packet), outcome,
        idempotency_key="k", written_at=LATER,
    )
    assert not isinstance(replay, WriteBackRefusal)
    assert replay.replayed is True  # type: ignore[union-attr]
    assert len(restored.entries) == 1


# --- conflict ----------------------------------------------------------------


def test_a_different_review_of_the_same_write_refuses_as_a_conflict():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    # A second packet over the same business result but re-reviewed: the
    # note content (and therefore the note identity) is identical, while the
    # reviewing packet — and the approval bound to it — is different.
    second_packet = dataclasses.replace(packet, review_id="0" * 32)
    assert second_packet.packet_sha256 == packet.packet_sha256
    ledger = InMemoryNoteLedger()
    first = write_back(
        claim(), seeded_store(), ledger, packet, approve(packet), outcome,
        idempotency_key="k", written_at=NOW,
    )
    assert not isinstance(first, WriteBackRefusal)
    conflict = write_back(
        claim(), seeded_store(), ledger, second_packet, approve(second_packet), outcome,
        idempotency_key="k", written_at=LATER,
    )
    assert conflict is WriteBackRefusal.REVIEW_CONFLICT
    # The original note is untouched and still governed by its own review.
    assert len(ledger.entries) == 1
    entry = next(iter(ledger.entries.values()))
    assert entry["review_id"] == packet.review_id


def test_a_conflicting_review_never_rewrites_the_timestamp():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    second_packet = dataclasses.replace(packet, review_id="0" * 32)
    ledger = InMemoryNoteLedger()
    write_back(
        claim(), seeded_store(), ledger, packet, approve(packet), outcome,
        idempotency_key="k", written_at=NOW,
    )
    write_back(
        claim(), seeded_store(), ledger, second_packet, approve(second_packet), outcome,
        idempotency_key="k", written_at=LATER,
    )
    entry = next(iter(ledger.entries.values()))
    assert entry["written_at"] == NOW.isoformat()


# --- outcome vocabulary mirrors refusals -------------------------------------


def test_every_refusal_maps_to_an_outcome_by_name():
    for refusal in WriteBackRefusal:
        assert write_back_outcome(refusal) is WriteBackOutcome(refusal.value)
    assert write_back_outcome(
        WriteBackRefusal.REVIEW_CONFLICT
    ) is WriteBackOutcome.REVIEW_CONFLICT


def test_the_conflict_members_exist_in_both_vocabularies():
    assert "REVIEW_CONFLICT" in {r.value for r in WriteBackRefusal}
    assert "REVIEW_CONFLICT" in {o.value for o in WriteBackOutcome}
