"""Review before mutation, and a write-back that is deterministic and refuses stale sources."""

from __future__ import annotations

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
        text="I have it here. It is showing returned in our system. The labour "
        "line has no operating-hours reading attached.",
    ),
    TranscriptTurn(speaker="bot", text="What do you need from us?"),
    TranscriptTurn(
        speaker="user",
        text="Send a photograph of the hour meter with the reading visible and "
        "we can rework the claim.",
    ),
)

PAYLOAD = {
    "claim_status": "STATED_RETURNED",
    "claim_status_evidence_quote": "It is showing returned in our system.",
    "stated_reason": "The labour line has no operating-hours reading attached.",
    "required_correction": None,
    "required_documents": [
        "photograph of the hour meter with the reading visible"
    ],
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
            state=TransportState.COMPLETED, call_id="call_synthetic_review"
        ),
        validation,
        transcript=TRANSCRIPT,
    )


def failed_outcome():
    return derive_outcome(
        TransportOutcome(state=TransportState.FAILED),
        validate_structured_result(None, SCHEMA),
        transcript=None,
    )


def approved_decision(packet, **overrides):
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


# --- review packet ---------------------------------------------------------


def test_the_review_packet_masks_the_recipient():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    body = packet.to_dict()
    assert body["recipient"] == "+12*******42"
    assert "5550142" not in str(body)
    assert body["business"]["claim_status"] == "STATED_RETURNED"


def test_the_review_packet_carries_evidence_not_a_transcript():
    packet = prepare_review(completed_outcome(), "+12025550142")
    assert packet.business["evidence"]
    assert "hour meter" in str(packet.business["evidence"])
    assert set(packet.to_dict()) == {
        "review_id",
        "terminal_state",
        "transport_state",
        "recipient",
        "business",
        "identifier",
        "packet_sha256",
        "validation_errors",
    }


def test_the_review_packet_binds_to_the_packet_digest():
    """The packet names the three-surface digest a decision must carry."""

    from warrantyops.packet import derive_packet

    packet = prepare_review(completed_outcome(), "+12025550142")
    assert packet.packet_sha256 == derive_packet(completed_outcome()).packet_sha256


# --- review gate -----------------------------------------------------------


def test_write_back_without_an_approval_is_refused():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet, decision=ReviewDecision.REFUSE),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NOT_REVIEWED


def test_return_to_digital_is_a_recorded_non_write_not_an_approval():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet, decision=ReviewDecision.RETURN_TO_DIGITAL),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NOT_REVIEWED


def test_an_approval_for_a_different_packet_authorizes_nothing():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    other_packet = prepare_review(failed_outcome(), "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet, review_id=other_packet.review_id),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NOT_REVIEWED


def test_a_decision_bound_to_a_different_packet_body_is_stale():
    """Right review id, wrong body: the hash mismatch names it."""

    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    other_packet = prepare_review(failed_outcome(), "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet, packet_sha256=other_packet.packet_sha256),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NOT_REVIEWED

    from warrantyops.review import ReviewRefusal, review_refusals

    assert ReviewRefusal.PACKET_HASH_MISMATCH in review_refusals(
        packet, approved_decision(packet, packet_sha256=other_packet.packet_sha256)
    )


def test_a_decision_without_a_reviewer_is_refused():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet, reviewer="  "),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NOT_REVIEWED


def test_a_decision_without_an_operator_is_refused():
    """A decision naming no auditable principal cannot authorize a write."""

    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet, operator_id=""),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NOT_REVIEWED


def test_a_call_without_a_business_result_writes_nothing():
    outcome = failed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    result = write_back(
        claim(),
        seeded_store(),
        InMemoryNoteLedger(),
        packet,
        approved_decision(packet),
        outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.NO_BUSINESS_RESULT


# --- receipts --------------------------------------------------------------


def test_an_approved_review_writes_a_bounded_note():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    ledger = InMemoryNoteLedger()
    result = write_back(
        claim(),
        seeded_store(),
        ledger,
        packet,
        approved_decision(packet),
        outcome,
        idempotency_key="warrantyops:key",
        evidence_pointer="call_synthetic_review",
        written_at=NOW,
    )
    assert not isinstance(result, WriteBackRefusal)
    note = result.note
    assert note["claim_status"] == "STATED_RETURNED"
    assert note["evidence_pointer"] == "call_synthetic_review"
    assert note["contract_version"] == "warranty-claim-exception/v1"
    assert "transcript" not in note
    assert len(ledger.entries) == 1


def test_a_replay_against_the_same_ledger_returns_the_original_receipt():
    """The retry wrote nothing new, so it reports the original write time."""

    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    ledger = InMemoryNoteLedger()
    store = seeded_store()
    first = write_back(
        claim(), store, ledger, packet, approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", evidence_pointer="call_synthetic_review",
        written_at=NOW,
    )
    replay = write_back(
        claim(), store, ledger, packet, approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", evidence_pointer="call_synthetic_review",
        written_at=LATER,
    )
    assert not isinstance(first, WriteBackRefusal)
    assert not isinstance(replay, WriteBackRefusal)
    assert replay.note_id == first.note_id
    assert replay.written_at == first.written_at
    assert len(ledger.entries) == 1


def test_the_same_reviewed_result_rederived_is_the_same_write():
    """Semantic idempotency: same identity and content, any timestamp."""

    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    first = write_back(
        claim(), seeded_store(), InMemoryNoteLedger(), packet,
        approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", written_at=NOW,
    )
    second = write_back(
        claim(), seeded_store(), InMemoryNoteLedger(), packet,
        approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", written_at=LATER,
    )
    assert not isinstance(first, WriteBackRefusal)
    assert not isinstance(second, WriteBackRefusal)
    assert first.note_id == second.note_id
    assert first.written_at != second.written_at  # legitimate timestamps differ
    assert same_write(first, second)


def test_a_different_note_or_key_writes_a_different_identity():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    ledger = InMemoryNoteLedger()
    first = write_back(
        claim(), seeded_store(), ledger, packet, approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", written_at=NOW,
    )
    second = write_back(
        claim(), seeded_store(), ledger, packet, approved_decision(packet), outcome,
        idempotency_key="warrantyops:other", written_at=NOW,
    )
    assert not isinstance(first, WriteBackRefusal)
    assert not isinstance(second, WriteBackRefusal)
    assert first.note_id != second.note_id
    assert len(ledger.entries) == 2


# --- stale source ----------------------------------------------------------


def test_a_source_that_moved_before_write_back_is_refused():
    """An earlier version check passing does not satisfy the re-read."""

    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    store = seeded_store()
    # The pre-call check saw v7 and passed; the record moves before review.
    store.set_version("SYNTHETIC-DMS", "CLM-1042", "v8")
    ledger = InMemoryNoteLedger()
    result = write_back(
        claim(), store, ledger, packet, approved_decision(packet), outcome,
        idempotency_key="warrantyops:key",
    )
    assert result is WriteBackRefusal.SOURCE_CHANGED
    assert len(ledger.entries) == 0


def test_the_version_is_reread_even_when_the_call_saw_it_match():
    store = seeded_store()
    from warrantyops.gates import check_source_version

    assert check_source_version(claim(), store).matches
    store.set_version("SYNTHETIC-DMS", "CLM-1042", "v9")
    assert check_source_version(claim(), store).matches is False


# --- outcome vocabulary -----------------------------------------------------


def test_every_write_back_result_classifies_into_the_vocabulary():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    receipt = write_back(
        claim(), seeded_store(), InMemoryNoteLedger(), packet,
        approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", written_at=NOW,
    )
    assert write_back_outcome(receipt) is WriteBackOutcome.RECEIPT
    assert write_back_outcome(WriteBackRefusal.NO_BUSINESS_RESULT) is (
        WriteBackOutcome.NO_BUSINESS_RESULT
    )
    assert write_back_outcome(WriteBackRefusal.NOT_REVIEWED) is (
        WriteBackOutcome.NOT_REVIEWED
    )
    assert write_back_outcome(WriteBackRefusal.SOURCE_CHANGED) is (
        WriteBackOutcome.SOURCE_CHANGED
    )


def test_the_outcome_vocabulary_mirrors_the_refusals_one_for_one():
    """No refusal exists without a classifiable outcome, and no outcome is
    unreachable."""

    refusal_values = {member.value for member in WriteBackRefusal}
    outcome_values = {member.value for member in WriteBackOutcome}
    assert outcome_values - {"RECEIPT"} == refusal_values


def test_the_written_note_records_who_decided_and_on_what_basis():
    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    ledger = InMemoryNoteLedger()
    write_back(
        claim(), seeded_store(), ledger, packet,
        approved_decision(packet), outcome,
        idempotency_key="warrantyops:key", written_at=NOW,
    )
    (entry,) = ledger.entries.values()
    assert entry["reviewer"] == "test-reviewer"
    assert entry["operator_id"] == "operator-test"
    assert entry["review_decision"] == "APPROVE"


# --- review refusals -----------------------------------------------------------


def test_a_decision_recorded_without_a_timezone_is_refused():
    from warrantyops.review import ReviewRefusal, review_refusals

    outcome = completed_outcome()
    packet = prepare_review(outcome, "+12025550142")
    naive = approved_decision(packet, decided_at=datetime(2026, 9, 1, 12, 0))
    refusals = review_refusals(packet, naive)
    assert ReviewRefusal.NOT_TIMEZONE_AWARE in refusals
