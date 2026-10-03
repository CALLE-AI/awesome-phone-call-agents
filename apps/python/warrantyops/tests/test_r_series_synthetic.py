"""Synthetic counterparts of the R2-R7 evidence rows.

The v3.1 freeze: synthetic R2-R7 are mandatory software proofs and never
counted as platform observations. Each test here drives the real kernel —
the same gates, provider seam, outcome fold and write-back discipline the
live path runs — against synthetic input, and stamps the receipt with
exactly one evidence class, ``Synthetic scenario``. R2 additionally proves
the freeze's own sentence: positive grounding still requires review and
recheck, which is why R2 is never live — a live status call would be extra
authority, not extra truth.
"""

from __future__ import annotations

from test_scenarios import NOW, exercise, fixtures

from warrantyops.cassettes import registry_rows
from warrantyops.contract import build_extraction_schema
from warrantyops.identifiers import TranscriptTurn
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.outcome import (
    MenuNavigation,
    TerminalState,
    TransportOutcome,
    TransportState,
    derive_outcome,
)
from warrantyops.receipt import EvidenceClass, build_receipt
from warrantyops.review import ReviewDecision, ReviewRecord, prepare_review
from warrantyops.validation import validate_structured_result
from warrantyops.writeback import InMemoryNoteLedger, WriteBackRefusal, write_back

SYNTHETIC = EvidenceClass.SYNTHETIC


def receipt_for(scenario: str, run) -> str:
    """One public receipt line: its single evidence class."""

    receipt = build_receipt(
        run,
        recipient_e164=fixtures()[scenario]["recipient_e164"],
        provider_name="fake",
        evidence_class=SYNTHETIC,
        source_platform="SYNTHETIC-FIXTURE",
        source_object_id=scenario,
    )
    return receipt.evidence_class


# --- R2: a stated status still requires review and recheck ---------------------------


def test_r2_a_grounded_stated_status_still_requires_the_human_review():
    """Positive grounding is not permission: no approved decision, no write."""

    fixture, claim, store, provider, run = exercise("case_a_useful_resolution")
    assert run.refusal is None
    assert run.outcome.business.claim_status.value == "STATED_RETURNED"
    packet = prepare_review(run.outcome, fixture["recipient_e164"])
    # The same grounded run, decided by a human who refuses: nothing writes.
    undecided = write_back(
        claim,
        store,
        InMemoryNoteLedger(),
        packet,
        ReviewRecord(
            decision=ReviewDecision.REFUSE,
            reviewer="test-reviewer",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-test",
        ),
        run.outcome,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=run.outcome.transport.call_id,
        written_at=NOW,
    )
    assert undecided is WriteBackRefusal.NOT_REVIEWED
    assert receipt_for("case_a_useful_resolution", run) == "Synthetic scenario"


def test_r2_the_write_back_rechecks_the_source_even_after_positive_grounding():
    fixture, claim, store, provider, run = exercise("case_a_useful_resolution")
    packet = prepare_review(run.outcome, fixture["recipient_e164"])
    store.set_version(claim.source_platform, claim.source_claim_id, "moved-v2")
    result = write_back(
        claim,
        store,
        InMemoryNoteLedger(),
        packet,
        ReviewRecord(
            decision=ReviewDecision.APPROVE,
            reviewer="test-reviewer",
            decided_at=NOW,
            review_id=packet.review_id,
            packet_sha256=packet.packet_sha256,
            operator_id="operator-test",
        ),
        run.outcome,
        idempotency_key=run.idempotency_key or "",
        evidence_pointer=run.outcome.transport.call_id,
        written_at=NOW,
    )
    assert result is WriteBackRefusal.SOURCE_CHANGED


def test_r2_is_registered_never_live():
    by_row = {row.row: row for row in registry_rows()}
    assert by_row["R2"].status == "synthetic-only"
    assert "never live" in by_row["R2"].note


# --- R3: the misread reference corrected through its read-back -----------------------


def test_r3_the_correction_survives_and_only_the_corrected_value_is_asserted():
    fixture, claim, store, provider, run = exercise("case_d_corrected_reference")
    identifier = run.outcome.identifier
    assert identifier.state.value == "CONFIRMED_IDENTIFIER"
    assert identifier.heard_value == "CASE48171"  # what the extractor first heard
    assert identifier.value == "CASE48178"  # what the desk corrected it to
    assert receipt_for("case_d_corrected_reference", run) == "Synthetic scenario"


# --- R4: no answer, and no invented status -------------------------------------------


def test_r4_a_failed_call_keeps_its_exact_transport_shape_and_invents_nothing():
    fixture, claim, store, provider, run = exercise("case_e_no_result")
    outcome = run.outcome
    assert outcome.terminal_state is TerminalState.TRANSPORT_FAILED
    assert outcome.transport.state is TransportState.FAILED
    assert outcome.transport.diagnostic_failure_code == "synthetic_transport_failure"
    assert outcome.business.claim_status.value == "UNKNOWN"  # no status invented
    assert outcome.identifier is None
    assert receipt_for("case_e_no_result", run) == "Synthetic scenario"


# --- R5: the supplied keypad plan that did not resolve -------------------------------


def _menu_transcript() -> tuple[TranscriptTurn, ...]:
    return (
        TranscriptTurn(speaker="bot", text="Press one for the claims desk."),
        TranscriptTurn(speaker="user", text="One."),
        TranscriptTurn(speaker="bot", text="Press two for warranty status."),
        TranscriptTurn(speaker="user", text="Two."),
    )


def test_r5_an_unresolved_supplied_plan_ends_menu_unresolved():
    transport = TransportOutcome(
        state=TransportState.COMPLETED, call_id="call_synthetic_r5_menu"
    )
    outcome = derive_outcome(
        transport,
        _empty_validation(),
        transcript=_menu_transcript(),
        menu=MenuNavigation(plan_supplied=True, resolved=False),
    )
    assert outcome.terminal_state is TerminalState.MENU_UNRESOLVED


def test_r5_a_discovered_navigation_never_classifies_as_menu_unresolved():
    transport = TransportOutcome(
        state=TransportState.COMPLETED, call_id="call_synthetic_r5_discovered"
    )
    outcome = derive_outcome(
        transport,
        _empty_validation(),
        transcript=_menu_transcript(),
        menu=MenuNavigation(plan_supplied=False, resolved=False),
    )
    assert outcome.terminal_state is TerminalState.BUSINESS_UNRESOLVED


def _empty_validation():
    return validate_structured_result(
        {
            "reference_kind": "CASE",
            "reference_readback_performed": False,
            "claim_status": "UNKNOWN",
        },
        build_extraction_schema(),
    )


# --- R6: the desk hedges ---------------------------------------------------------------


def test_r6_a_hedged_status_quote_is_kept_as_evidence_but_not_asserted():
    transport = TransportOutcome(
        state=TransportState.COMPLETED, call_id="call_synthetic_r6_hedge"
    )
    transcript = (
        TranscriptTurn(speaker="bot", text="What is the status of the claim?"),
        TranscriptTurn(speaker="user", text="It looks like it is returned."),
    )
    validation = validate_structured_result(
        {
            "reference_kind": "CASE",
            "reference_readback_performed": False,
            "claim_status": "STATED_RETURNED",
            "claim_status_evidence_quote": "It looks like it is returned.",
        },
        build_extraction_schema(),
    )
    outcome = derive_outcome(transport, validation, transcript=transcript)
    assert outcome.business.claim_status.value == "UNKNOWN"  # the hedge survives us
    assert any("hedged or non-final" in note for note in outcome.business.downgrades)
    quotes = [entry["quote"] for entry in outcome.business.evidence]
    assert "It looks like it is returned." in quotes  # the reviewer still sees it


# --- R7: same key, same body — and only local suppression is claimed ------------------


def test_r7_the_same_claim_version_suppresses_the_second_call_locally():
    ledger = InMemoryAttemptLedger()
    fixture, claim, store, provider, run = exercise("case_a_useful_resolution", ledger)
    assert provider.replays == 1
    _, _, _, second_provider, second_run = exercise("case_a_useful_resolution", ledger)
    assert second_run.refusal is not None
    assert second_run.refusal.gate.value == "ATTEMPT_LEDGER"
    assert second_run.refusal.reasons == ("DUPLICATE_CALL_SUPPRESSED",)
    assert second_provider.replays == 0  # nothing reached any provider


def test_r7_the_suppressed_run_claims_only_local_suppression():
    ledger = InMemoryAttemptLedger()
    exercise("case_a_useful_resolution", ledger)
    _, _, _, _, second_run = exercise("case_a_useful_resolution", ledger)
    assert second_run.outcome is None  # no outcome: no platform replay is claimed
    assert receipt_for("case_a_useful_resolution", second_run) == "Synthetic scenario"
