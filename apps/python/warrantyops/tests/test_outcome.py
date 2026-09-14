"""Transport state never becomes a claim decision; grounding gates the rest."""

from __future__ import annotations

from warrantyops.contract import ClaimStatus, build_extraction_schema
from warrantyops.identifiers import IdentifierState, TranscriptTurn
from warrantyops.outcome import (
    TerminalState,
    TransportOutcome,
    TransportState,
    derive_outcome,
)
from warrantyops.validation import validate_structured_result

SCHEMA = build_extraction_schema()

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
    TranscriptTurn(speaker="bot", text="Does this have a case number?"),
    TranscriptTurn(speaker="user", text="It is case nine zero two one zero."),
    TranscriptTurn(
        speaker="bot", text="Just to confirm, that is case nine zero two one zero, correct?"
    ),
    TranscriptTurn(speaker="user", text="Correct, case nine zero two one zero."),
)

COMPLETED = TransportOutcome(
    state=TransportState.COMPLETED, call_id="call_synthetic_outcome"
)


def payload(**overrides) -> dict:
    base = {
        "claim_status": "UNKNOWN",
        "claim_status_evidence_quote": None,
        "stated_reason": None,
        "required_correction": None,
        "required_documents": [],
        "stated_deadline": None,
        "escalation_path": None,
        "stated_next_action": None,
        "reference_kind": "UNKNOWN",
        "reference_heard": None,
        "reference_readback_performed": False,
        "reference_confirmed": None,
        "reference_confirmation_quote": None,
    }
    base.update(overrides)
    return base


def outcome_for(payload_dict, transport=COMPLETED, **kwargs):
    if "transcript" not in kwargs:
        kwargs["transcript"] = TRANSCRIPT
    validation = validate_structured_result(payload_dict, SCHEMA)
    return derive_outcome(transport, validation, **kwargs)


def test_a_failed_call_is_never_a_claim_decision():
    transport = TransportOutcome(
        state=TransportState.FAILED,
        call_id="call_synthetic_x",
        diagnostic_failure_code="anything_at_all",
    )
    result = outcome_for(
        payload(claim_status="STATED_RETURNED", claim_status_evidence_quote="x"),
        transport,
    )
    assert result.terminal_state is TerminalState.TRANSPORT_FAILED
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.business.stated_reason is None
    assert result.business.confirmed_reference is None
    assert result.write_back_eligible is False


def test_the_undocumented_failure_string_is_carried_but_never_branched_on():
    transport = TransportOutcome(state=TransportState.FAILED, diagnostic_failure_code="no_answer")
    as_no_answer = outcome_for(None, transport)
    as_other = outcome_for(
        None,
        TransportOutcome(state=TransportState.FAILED, diagnostic_failure_code="declined"),
    )
    assert as_no_answer.terminal_state is as_other.terminal_state
    assert as_no_answer.business.to_dict() == as_other.business.to_dict()
    assert as_no_answer.transport.diagnostic_failure_code == "no_answer"


def test_a_call_still_running_produces_no_business_state():
    result = outcome_for(None, TransportOutcome(state=TransportState.IN_PROGRESS))
    assert result.terminal_state is TerminalState.IN_FLIGHT


def test_a_canceled_call_is_a_transport_failure_never_a_business_result():
    """Even a definitive extraction cannot survive a canceled transport."""

    result = outcome_for(
        payload(claim_status="STATED_PAID"),
        TransportOutcome(
            state=TransportState.CANCELED, call_id="call_synthetic_canceled"
        ),
    )
    assert result.terminal_state is TerminalState.TRANSPORT_FAILED
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.business.stated_reason is None
    assert result.business.confirmed_reference is None
    assert result.write_back_eligible is False


def test_a_completed_call_with_no_schema_valid_result_is_its_own_state():
    result = outcome_for(None)
    assert result.terminal_state is TerminalState.RESULT_UNAVAILABLE
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.write_back_eligible is False


def test_a_completed_call_that_established_nothing_is_business_unresolved():
    result = outcome_for(payload())
    assert result.terminal_state is TerminalState.BUSINESS_UNRESOLVED
    assert result.write_back_eligible is False


def test_an_established_status_is_kept_with_its_evidence():
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
        )
    )
    assert result.terminal_state is TerminalState.INFORMATION_OBTAINED
    assert result.business.claim_status is ClaimStatus.STATED_RETURNED
    fields = {item["field"] for item in result.business.evidence}
    assert "claim_status" in fields
    assert result.write_back_eligible is True


def test_a_status_without_a_quote_is_reduced_to_unknown():
    result = outcome_for(payload(claim_status="STATED_RETURNED"))
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert any("no evidence quote" in note for note in result.business.downgrades)


def test_a_status_whose_quote_is_not_in_the_transcript_is_reduced_to_unknown():
    result = outcome_for(
        payload(
            claim_status="STATED_PAID",
            claim_status_evidence_quote="Yes, the payment was released on Monday.",
        )
    )
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert any("not found in a counterparty turn" in note for note in result.business.downgrades)


# --- hedged and non-final status statements ---------------------------------


HEDGED_TRANSCRIPT = (
    TranscriptTurn(speaker="bot", text="What does the claim show on your side today?"),
    TranscriptTurn(
        speaker="user",
        text="I'm not sure, but I think it is showing returned in our system.",
    ),
)


def test_an_explicitly_hedged_status_is_reduced_to_unknown_and_keeps_the_quote():
    """The hedge is deterministic: model instructions alone are not a boundary.

    The quote is grounded — the counterparty did say it — so it is preserved
    as evidence for the reviewer, while the asserted status stays UNKNOWN and
    the downgrade names the reason.
    """

    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="I'm not sure, but I think it is showing "
            "returned in our system.",
        ),
        transcript=HEDGED_TRANSCRIPT,
    )
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    quotes = [
        item["quote"]
        for item in result.business.evidence
        if item["field"] == "claim_status"
    ]
    assert quotes == [
        "I'm not sure, but I think it is showing returned in our system."
    ]
    assert any(
        "hedged or non-final" in note for note in result.business.downgrades
    )
    assert result.terminal_state is TerminalState.BUSINESS_UNRESOLVED


def test_a_projected_future_status_is_not_a_current_status():
    """Non-final counts as hedged: "will be paid" is not STATED_PAID today."""

    future_transcript = (
        TranscriptTurn(speaker="bot", text="Where does the claim stand?"),
        TranscriptTurn(
            speaker="user", text="It is approved, it will be paid out on Friday."
        ),
    )
    result = outcome_for(
        payload(
            claim_status="STATED_PAID",
            claim_status_evidence_quote="it will be paid out on Friday",
        ),
        transcript=future_transcript,
    )
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert any(
        "hedged or non-final" in note for note in result.business.downgrades
    )


def test_a_clear_grounded_final_status_is_not_downgraded_as_a_hedge():
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
        )
    )
    assert result.business.claim_status is ClaimStatus.STATED_RETURNED
    assert not any("hedged" in note for note in result.business.downgrades)


def test_free_text_that_is_not_in_a_counterparty_turn_is_dropped():
    result = outcome_for(
        payload(
            stated_reason="The claim was denied for exceeding coverage limits.",
            stated_deadline="fourteen days from today",
        )
    )
    assert result.business.stated_reason is None
    assert result.business.stated_deadline is None
    assert (
        len([n for n in result.business.downgrades if "was dropped" in n]) == 2
    )


def test_grounded_free_text_survives():
    result = outcome_for(
        payload(
            stated_reason="The labour line has no operating-hours reading attached.",
            required_documents=["photograph of the hour meter with the reading visible"],
            stated_deadline=None,
        )
    )
    assert result.business.stated_reason is not None
    assert result.business.required_documents == (
        "photograph of the hour meter with the reading visible",
    )


def test_document_entries_are_grounded_individually():
    result = outcome_for(
        payload(
            required_documents=[
                "photograph of the hour meter with the reading visible",
                "notarized affidavit of loss",
            ]
        )
    )
    assert result.business.required_documents == (
        "photograph of the hour meter with the reading visible",
    )
    assert any("document entry" in note for note in result.business.downgrades)


def test_documents_alone_make_the_outcome_action_required():
    result = outcome_for(
        payload(required_documents=["photograph of the hour meter with the reading visible"])
    )
    assert result.terminal_state is TerminalState.ACTION_REQUIRED
    assert result.write_back_eligible is True


def test_without_a_transcript_nothing_is_asserted():
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
            stated_reason="The labour line has no operating-hours reading attached.",
        ),
        transcript=None,
    )
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.business.stated_reason is None
    assert result.terminal_state is TerminalState.BUSINESS_UNRESOLVED


def test_a_reference_without_a_readback_is_never_asserted():
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
            reference_kind="CASE",
            reference_heard="case nine zero two one zero",
            reference_readback_performed=False,
            reference_confirmed="case nine zero two one zero",
            reference_confirmation_quote="Correct, case nine zero two one zero.",
        )
    )
    assert result.business.confirmed_reference is None
    assert result.identifier is not None
    assert result.identifier.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    fields = {item["field"] for item in result.business.evidence}
    assert "confirmed_reference" not in fields


def test_a_reference_confirmed_in_its_own_exchange_is_asserted():
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
            reference_kind="CASE",
            reference_heard="case nine zero two one zero",
            reference_readback_performed=True,
            reference_confirmed="case nine zero two one zero",
            reference_confirmation_quote="Correct, case nine zero two one zero.",
        )
    )
    assert result.business.confirmed_reference is not None
    assert result.business.confirmed_reference.value == "CASE90210"
    assert result.business.confirmed_reference.kind.value == "CASE"
    assert result.business.confirmed_reference.corrected is False
    fields = {item["field"] for item in result.business.evidence}
    assert "confirmed_reference" in fields


def test_a_corrected_reference_asserts_only_the_corrected_value():
    corrected_transcript = (
        *TRANSCRIPT,
        TranscriptTurn(
            speaker="bot", text="And the credit note reference is four four one seven?"
        ),
        TranscriptTurn(
            speaker="user",
            text="No, that is four four one seven five, that is correct.",
        ),
    )
    result = outcome_for(
        payload(
            reference_kind="CREDIT",
            reference_heard="credit four four one seven",
            reference_readback_performed=True,
            reference_confirmed="credit four four one seven five",
            reference_confirmation_quote="No, that is four four one seven five, that is correct.",
        ),
        transcript=corrected_transcript,
    )
    assert result.business.confirmed_reference is not None
    assert result.business.confirmed_reference.value == "CREDIT44175"
    assert result.business.confirmed_reference.kind.value == "CREDIT"
    assert result.business.confirmed_reference.corrected is True


# --- reference evidence grounding -------------------------------------------


def reference_item(result):
    return next(
        (
            entry
            for entry in result.business.evidence
            if entry.get("field") == "confirmed_reference"
        ),
        None,
    )


def test_a_direct_counterparty_quote_is_the_reference_evidence():
    """The counterparty named the value; that utterance is the evidence."""

    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
            reference_kind="CASE",
            reference_heard="case nine zero two one zero",
            reference_readback_performed=True,
            reference_confirmed="case nine zero two one zero",
            reference_confirmation_quote="Correct, case nine zero two one zero.",
        )
    )
    item = reference_item(result)
    assert item is not None
    assert item["method"] == "DIRECT_COUNTERPARTY_QUOTE"
    assert item["quote"] == "It is case nine zero two one zero."
    assert item["display"] == "case nine zero two one zero"
    assert result.business.confirmed_reference.value == "CASE90210"


def test_a_bare_yes_is_preserved_only_as_a_paired_read_back():
    """The counterparty never spoke the number; the pair is the evidence."""

    readback_only = (
        TranscriptTurn(speaker="bot", text="May I ask about warranty claim CLM-1042?"),
        TranscriptTurn(
            speaker="user", text="I have it here. It is showing returned."
        ),
        TranscriptTurn(
            speaker="bot",
            text="Just to confirm, the reference is nine zero two one zero, correct?",
        ),
        TranscriptTurn(speaker="user", text="Yes."),
    )
    result = outcome_for(
        payload(
            reference_kind="CASE",
            reference_readback_performed=True,
            reference_confirmed="nine zero two one zero",
            reference_confirmation_quote="Yes.",
        ),
        transcript=readback_only,
    )
    assert result.business.confirmed_reference is not None
    assert result.business.confirmed_reference.value == "90210"
    item = reference_item(result)
    assert item["method"] == "CONFIRMED_BY_READBACK"
    assert item["quote"] == "Yes."
    assert (
        item["readback"]
        == "Just to confirm, the reference is nine zero two one zero, correct?"
    )
    assert item["display"] == "nine zero two one zero"


def test_a_yes_answering_nothing_about_the_reference_grounds_nothing():
    """A generic affirmative to an unrelated question confirms no reference."""

    unrelated = (
        TranscriptTurn(speaker="bot", text="Is now a good moment for a couple of questions?"),
        TranscriptTurn(speaker="user", text="Yes."),
    )
    result = outcome_for(
        payload(
            reference_kind="CASE",
            reference_readback_performed=True,
            reference_confirmed="nine zero two one zero",
            reference_confirmation_quote="Yes.",
        ),
        transcript=unrelated,
    )
    assert result.business.confirmed_reference is None
    assert reference_item(result) is None
    assert result.identifier.state is IdentifierState.UNCONFIRMED_IDENTIFIER


def test_an_ungroundable_confirmation_downgrades_the_reference(monkeypatch):
    """Defensive branch: confirmation held, but no evidence can be shown."""

    import warrantyops.outcome as outcome_module

    monkeypatch.setattr(
        outcome_module, "_reference_evidence", lambda *args, **kwargs: None
    )
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
            reference_kind="CASE",
            reference_heard="case nine zero two one zero",
            reference_readback_performed=True,
            reference_confirmed="case nine zero two one zero",
            reference_confirmation_quote="Correct, case nine zero two one zero.",
        )
    )
    assert result.business.confirmed_reference is None
    assert result.identifier.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    from warrantyops.identifiers import IdentifierRefusal

    assert IdentifierRefusal.REFERENCE_EVIDENCE_UNGROUNDED in result.identifier.refusals
    assert any(
        "no grounded transcript evidence" in note
        for note in result.business.downgrades
    )
    assert reference_item(result) is None


# --- conservative direct-quote classification ---------------------------------

#: The sanitized quote the recovered runtime receipt wrongly classified as
#: DIRECT_COUNTERPARTY_QUOTE for candidate BR4821. It stays verbatim as a
#: regression fixture: scattered letters, a partial and a separate digit
#: fragment, and nothing that deterministically normalizes to BR4821.
RAJAHMUNDRY_QUOTE = "R. For Rajahmundry hyphen. Yes, 44. 821."


def confirmed_decision(value: str):
    from warrantyops.identifiers import IdentifierDecision, IdentifierState

    return IdentifierDecision(
        state=IdentifierState.CONFIRMED_IDENTIFIER,
        value=value,
        heard_value=None,
        corrected=False,
        refusals=(),
    )


def grounding_for(transcript, value="BR4821", confirmation_quote=None):
    from warrantyops.outcome import _reference_evidence

    return _reference_evidence(
        confirmed_decision(value),
        {"reference_confirmed": value, "reference_confirmation_quote": confirmation_quote},
        transcript,
    )


def test_the_recovered_quote_cannot_ground_br4821_directly():
    transcript = (
        TranscriptTurn(speaker="bot", text="Is there a reference number?"),
        TranscriptTurn(speaker="user", text=RAJAHMUNDRY_QUOTE),
    )
    result = grounding_for(transcript, confirmation_quote=RAJAHMUNDRY_QUOTE)
    assert result is None  # not DIRECT, not read-back: nothing at all


def test_partial_digits_cannot_ground_a_complete_reference():
    transcript = (
        TranscriptTurn(speaker="bot", text="Is there a reference number?"),
        TranscriptTurn(speaker="user", text="It is BR dash eight two one."),
    )
    result = grounding_for(transcript)
    assert result is None


def test_scattered_letters_cannot_complete_a_reference():
    transcript = (
        TranscriptTurn(speaker="bot", text="What is the reference?"),
        TranscriptTurn(speaker="user", text="The big rig order is 4821."),
    )
    result = grounding_for(transcript)
    assert result is None


def test_an_exact_direct_counterparty_quotation_still_succeeds():
    transcript = (
        TranscriptTurn(speaker="bot", text="Is there a reference number?"),
        TranscriptTurn(speaker="user", text="It is case BR-4821."),
    )
    method, extras = grounding_for(transcript)
    assert method == "DIRECT_COUNTERPARTY_QUOTE"
    assert extras["quote"] == "It is case BR-4821."
    assert extras["display"] == "BR4821"


def test_the_recovered_quote_downgrades_to_readback_when_the_bot_said_it():
    """Production shape: messy utterance, clean bot read-back, then 'Yes.'"""

    recovered = (
        TranscriptTurn(
            speaker="bot",
            text="I am an AI assistant calling for NorthStar Equipment. "
            "May I ask about warranty claim W-1042?",
        ),
        TranscriptTurn(
            speaker="user", text="I have it here. It is showing returned."
        ),
        TranscriptTurn(
            speaker="bot", text="Is there a reference number on your side?"
        ),
        TranscriptTurn(speaker="user", text=RAJAHMUNDRY_QUOTE),
        TranscriptTurn(
            speaker="bot",
            text="Just to confirm, that is BR dash four eight two one, correct?",
        ),
        TranscriptTurn(speaker="user", text="Yes."),
    )
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned.",
            reference_kind="CASE",
            reference_readback_performed=True,
            reference_confirmed="BR-4821",
            reference_confirmation_quote="Yes.",
        ),
        transcript=recovered,
    )
    item = reference_item(result)
    assert item is not None
    assert item["method"] == "CONFIRMED_BY_READBACK"
    assert item["quote"] == "Yes."
    assert item["readback"] == (
        "Just to confirm, that is BR dash four eight two one, correct?"
    )
    assert RAJAHMUNDRY_QUOTE not in item["quote"]
    assert result.business.confirmed_reference.value == "BR4821"


def test_a_readback_without_a_counterparty_confirmation_stays_unconfirmed():
    stalled = (
        TranscriptTurn(speaker="bot", text="Is there a reference number?"),
        TranscriptTurn(
            speaker="bot",
            text="Just to confirm, that is BR dash four eight two one, correct?",
        ),
        TranscriptTurn(speaker="user", text="I will have to check and call back."),
    )
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned.",
            reference_kind="CASE",
            reference_readback_performed=True,
            reference_confirmed="BR-4821",
            reference_confirmation_quote=None,
        ),
        transcript=stalled,
    )
    assert result.business.confirmed_reference is None
    assert reference_item(result) is None


def test_an_unconfirmed_candidate_is_blocked_from_authoritative_write_back():
    from warrantyops.writeback import build_note

    messy = (
        TranscriptTurn(speaker="bot", text="Is there a reference number?"),
        TranscriptTurn(speaker="user", text=RAJAHMUNDRY_QUOTE),
    )
    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned.",
            reference_kind="CASE",
            reference_readback_performed=True,
            reference_confirmed="BR-4821",
            reference_confirmation_quote=RAJAHMUNDRY_QUOTE,
        ),
        transcript=messy,
    )
    assert result.business.confirmed_reference is None
    assert result.identifier.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    note = build_note(result, evidence_pointer="call_synthetic_2ce")
    # The bounded note is the only thing write-back may mutate the source
    # record with; an unconfirmed candidate cannot appear in it.
    assert note["confirmed_reference"] is None
    assert "BR4821" not in str(note)


def test_not_stated_and_not_established_stay_distinguishable():
    """Omitted, UNKNOWN and validated are three different states."""

    omitted = outcome_for(payload())
    unknown = outcome_for(
        payload(claim_status="UNKNOWN", claim_status_evidence_quote=None)
    )
    established = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
        )
    )
    omitted_fields = {item["field"] for item in omitted.business.evidence}
    unknown_fields = {item["field"] for item in unknown.business.evidence}
    established_fields = {item["field"] for item in established.business.evidence}
    assert "claim_status" not in omitted_fields
    assert "claim_status" not in unknown_fields
    assert not unknown.business.downgrades
    assert "claim_status" in established_fields
    assert established.business.claim_status is ClaimStatus.STATED_RETURNED


def test_a_present_but_schema_invalid_result_is_result_invalid():
    """A result that exists and fails validation is not an absent result.

    The provider produced something; that something is not assertable. The
    distinction matters because ``call.result_validation_failed`` and the
    GoalRunError ``result_invalid`` name the same finding from the provider
    side, and the terminal vocabulary has to be able to carry it.
    """

    malformed = payload()
    malformed["unexpected_field"] = "not in the closed schema"
    result = outcome_for(malformed)
    assert result.terminal_state is TerminalState.RESULT_INVALID
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.write_back_eligible is False
    assert result.validation_errors


def test_a_non_object_payload_is_result_invalid_not_unavailable():
    result = outcome_for(["not", "an", "object"])
    assert result.terminal_state is TerminalState.RESULT_INVALID


def test_transport_failure_outranks_an_invalid_result():
    """The transport check runs first: no transport state derives these."""

    transport = TransportOutcome(state=TransportState.FAILED)
    malformed = payload()
    malformed["unexpected_field"] = 1
    result = outcome_for(malformed, transport)
    assert result.terminal_state is TerminalState.TRANSPORT_FAILED


def test_an_unresolved_supplied_keypad_plan_is_menu_unresolved():
    from warrantyops.outcome import MenuNavigation

    result = outcome_for(payload(), menu=MenuNavigation(plan_supplied=True, resolved=False))
    assert result.terminal_state is TerminalState.MENU_UNRESOLVED
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.write_back_eligible is False


def test_grounded_evidence_outranks_an_unresolved_menu():
    from warrantyops.outcome import MenuNavigation

    result = outcome_for(
        payload(
            claim_status="STATED_RETURNED",
            claim_status_evidence_quote="It is showing returned in our system.",
        ),
        menu=MenuNavigation(plan_supplied=True, resolved=False),
    )
    assert result.terminal_state is TerminalState.INFORMATION_OBTAINED


def test_an_unknown_menu_state_and_an_absent_plan_classify_nothing():
    from warrantyops.outcome import MenuNavigation

    unknown = outcome_for(
        payload(), menu=MenuNavigation(plan_supplied=True, resolved=None)
    )
    absent = outcome_for(payload(), menu=MenuNavigation(plan_supplied=False, resolved=False))
    assert unknown.terminal_state is TerminalState.BUSINESS_UNRESOLVED
    assert absent.terminal_state is TerminalState.BUSINESS_UNRESOLVED


def test_the_new_terminal_members_are_never_write_back_eligible():
    from warrantyops.outcome import WRITE_BACK_ELIGIBLE_STATES

    assert TerminalState.RESULT_INVALID not in WRITE_BACK_ELIGIBLE_STATES
    assert TerminalState.MENU_UNRESOLVED not in WRITE_BACK_ELIGIBLE_STATES


# --- the folds that never reach a business result -------------------------------


def test_a_transport_that_never_attempted_folds_to_not_attempted():
    transport = TransportOutcome(state=TransportState.NOT_ATTEMPTED, call_id=None)
    result = outcome_for(payload(), transport)
    assert result.terminal_state is TerminalState.NOT_ATTEMPTED
    assert result.business.claim_status is ClaimStatus.UNKNOWN
    assert result.write_back_eligible is False


def test_task_completion_tracks_what_the_run_did_not_reach():
    from warrantyops.packet import derive_packet

    not_attempted = outcome_for(
        payload(), TransportOutcome(state=TransportState.NOT_ATTEMPTED, call_id=None)
    )
    in_flight = outcome_for(
        payload(), TransportOutcome(state=TransportState.IN_PROGRESS, call_id="c")
    )
    failed = outcome_for(
        payload(), TransportOutcome(state=TransportState.FAILED, call_id="c")
    )
    reasons = {}
    for outcome in (not_attempted, in_flight, failed):
        signal = derive_packet(outcome).task_completion
        assert signal.status.value == "UNKNOWN"
        reasons[outcome.terminal_state.value] = signal.reason
    assert set(reasons.values()) == {
        "no call was attempted",
        "the call has not reached a terminal state",
        "the call failed on the transport and cannot be judged",
    }
    unresolved = outcome_for(payload())  # nothing grounded: BUSINESS_UNRESOLVED
    unresolved_signal = derive_packet(unresolved).task_completion
    assert unresolved_signal.status.value == "NOT_ACCOMPLISHED"
    assert unresolved_signal.reason == (
        "the call reached a terminal state without usable business evidence"
    )


def test_reference_evidence_refuses_a_value_with_no_digits():
    from warrantyops.identifiers import IdentifierDecision, IdentifierState
    from warrantyops.outcome import _reference_evidence

    transcript = (TranscriptTurn(speaker="user", text="the reference"),)
    valueless = IdentifierDecision(
        state=IdentifierState.CONFIRMED_IDENTIFIER,
        value=None,
        heard_value=None,
        corrected=False,
        refusals=(),
    )
    lettered = IdentifierDecision(
        state=IdentifierState.CONFIRMED_IDENTIFIER,
        value="AB",
        heard_value="AB",
        corrected=False,
        refusals=(),
    )
    assert _reference_evidence(valueless, {}, transcript) is None
    assert _reference_evidence(lettered, {}, transcript) is None


def test_text_below_the_grounding_floor_is_never_grounded():
    from warrantyops.evidence import is_grounded_in_counterparty_turn

    assert is_grounded_in_counterparty_turn("retur", TRANSCRIPT) is False
    assert is_grounded_in_counterparty_turn(None, TRANSCRIPT) is False
    assert (
        is_grounded_in_counterparty_turn(
            "a long phrase that appears in no turn at all", TRANSCRIPT
        )
        is False
    )
