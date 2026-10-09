"""Grounding as a property, not a case list.

The invariant under test is one sentence: a field may be asserted only when
an exact transcript span, or a completed read-back exchange, grounds it;
anything hedged, fragmented, similar-but-different, or fabricated stays
UNKNOWN. Each property below states that sentence once and sweeps a
deterministic matrix of inputs through it, so the cases that pass are not
the ones somebody thought to write down — they are every case in the
matrix. Hypothesis-generated versions arrive with the hardening phase; the
matrices here stay exhaustive and seedless.
"""

from __future__ import annotations

import pytest

from warrantyops.contract import build_extraction_schema
from warrantyops.identifiers import (
    IdentifierClaim,
    IdentifierState,
    TranscriptTurn,
    evaluate_identifier,
    normalize_identifier,
)
from warrantyops.outcome import (
    ClaimStatus,
    TerminalState,
    TransportOutcome,
    TransportState,
    derive_outcome,
)
from warrantyops.validation import validate_structured_result

SCHEMA = build_extraction_schema()

AGENT = "bot"
USER = "user"


def turns(*pairs) -> tuple[TranscriptTurn, ...]:
    return tuple(
        TranscriptTurn(speaker=speaker, text=text) for speaker, text in pairs
    )


def readback_exchange(value: str, answer: str = "Correct."):
    """An unambiguous read-back: the agent reads the value, the user answers."""

    return turns(
        (AGENT, f"Just to confirm, that is {value}, correct?"),
        (USER, answer),
    )


def claim(**overrides) -> IdentifierClaim:
    base = {
        "value_heard": "case 90210",
        "readback_performed": True,
        "value_confirmed": "case 90210",
        "confirmation_quote": "Correct.",
    }
    base.update(overrides)
    return IdentifierClaim(**base)


# --- property: fabricated references never confirm --------------------------


@pytest.mark.parametrize(
    "transcript",
    [
        # The reference was never spoken by anyone.
        turns((AGENT, "Does this have a case number?"), (USER, "Not that I can see.")),
        # The digits appear only in the agent's own mouth.
        turns((AGENT, "Is it case nine zero two one zero?"), (USER, "Correct.")),
        # The quote is fabricated: nothing like it was ever said.
        turns((AGENT, "Confirm?"), (USER, "Yes, that is the one.")),
        # A quote stitched from two separate counterparty sentences.
        turns(
            (USER, "It is case nine zero."),
            (AGENT, "And the rest?"),
            (USER, "Two one zero, but I am not certain that is complete."),
        ),
    ],
    ids=["never-spoken", "agent-only", "fabricated-quote", "stitched-quote"],
)
def test_a_fabricated_reference_never_reaches_confirmed(transcript):
    decision = evaluate_identifier(
        claim(confirmation_quote="Correct, case nine zero two one zero."),
        transcript=transcript,
        expected_pattern=r"[A-Z0-9]{3,24}",
    )
    assert decision.state is not IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value is None


@pytest.mark.parametrize(
    "quote",
    ["Correct.", "Yes.", "That's right.", "Confirmed, case nine zero two one zero."],
)
def test_an_agent_turn_quote_is_never_counterparty_agreement(quote):
    transcript = turns((AGENT, quote), (USER, "Sorry, say that again?"))
    decision = evaluate_identifier(claim(confirmation_quote=quote), transcript=transcript)
    assert decision.state is not IdentifierState.CONFIRMED_IDENTIFIER


# --- property: a contextual yes binds only to its own exchange --------------


@pytest.mark.parametrize(
    "unrelated_agent_turn",
    [
        "Is there anything else I can help with?",
        "Can you hold for a moment?",
        "Would you like the reference emailed?",
        "Thank you for your time.",
    ],
)
@pytest.mark.parametrize("answer", ["Yes.", "Correct.", "That's right."])
def test_a_yes_to_a_different_question_confirms_no_number(
    unrelated_agent_turn, answer
):
    transcript = turns(
        (AGENT, "Does this have a case number on your side?"),
        (USER, "It is case nine zero two one zero."),
        (AGENT, unrelated_agent_turn),
        (USER, answer),
    )
    decision = evaluate_identifier(claim(confirmation_quote=answer), transcript=transcript)
    assert decision.state is not IdentifierState.CONFIRMED_IDENTIFIER


def test_the_same_yes_after_a_real_readback_does_confirm():
    """The contextual rule cuts both ways: bound to its read-back, it counts."""

    transcript = turns(
        (AGENT, "Does this have a case number on your side?"),
        (USER, "It is case nine zero two one zero."),
        (AGENT, "Just to confirm, that is case nine zero two one zero, correct?"),
        (USER, "Correct."),
        (AGENT, "Anything else?"),
        (USER, "No."),
    )
    decision = evaluate_identifier(claim(), transcript=transcript)
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER


# --- property: confirming one of two similar identifiers confirms only it ----


SIMILAR_PAIRS = [
    ("case nine zero two one zero", "case nine zero two one one"),
    ("RMA 48171", "RMA 48178"),
    ("claim 555000111", "claim 555000112"),
]


@pytest.mark.parametrize("confirmed_value,similar_value", SIMILAR_PAIRS)
def test_confirming_one_similar_identifier_never_confirms_the_other(
    confirmed_value, similar_value
):
    transcript = readback_exchange(confirmed_value)
    decision = evaluate_identifier(
        claim(
            value_heard=confirmed_value,
            value_confirmed=confirmed_value,
            confirmation_quote="Correct.",
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER

    # The same exchange, asked about the sibling value, must refuse it: the
    # digits the counterparty confirmed are not the sibling's digits.
    sibling = evaluate_identifier(
        claim(
            value_heard=similar_value,
            value_confirmed=similar_value,
            confirmation_quote="Correct.",
        ),
        transcript=transcript,
    )
    assert sibling.state is not IdentifierState.CONFIRMED_IDENTIFIER


@pytest.mark.parametrize("first,second", [("case 90210", "RMA 48171")])
def test_two_numbers_in_one_readback_confirm_neither(first, second):
    transcript = turns(
        (AGENT, f"Is that {first} or {second}?"),
        (USER, "Correct."),
    )
    for value in (first, second):
        decision = evaluate_identifier(
            claim(value_heard=value, value_confirmed=value), transcript=transcript
        )
        assert decision.state is not IdentifierState.CONFIRMED_IDENTIFIER


# --- property: fragmented values never ground a whole ------------------------


@pytest.mark.parametrize(
    "transcript",
    [
        turns((USER, "nine zero two"), (AGENT, "and?"), (USER, "one zero")),
        turns((USER, "the case is nine zero two one zero")),
        turns(
            (AGENT, "Case number?"),
            (USER, "Nine."),
            (AGENT, "Then?"),
            (USER, "Zero two one zero."),
        ),
    ],
    ids=["split-turns", "agent-fragment", "word-by-word"],
)
def test_fragmented_digits_never_ground_the_whole_value(transcript):
    """Each fragment is real speech; none of them is the whole reference."""

    decision = evaluate_identifier(
        claim(confirmation_quote="Correct."), transcript=transcript
    )
    assert decision.state is not IdentifierState.CONFIRMED_IDENTIFIER


# --- property: a correction cannot confirm itself ----------------------------


CORRECTION_PAIRS = [
    ("case nine zero two one zero", "case nine zero two one eight"),
    ("RMA 48171", "RMA 48178"),
]


@pytest.mark.parametrize("original,corrected", CORRECTION_PAIRS)
def test_a_correction_never_confirms_the_value_it_corrected(original, corrected):
    """The counterparty corrected the read-back; only a read-back of the
    corrected value can confirm the corrected value — never the original
    exchange, and never the correction itself."""

    transcript = turns(
        (AGENT, f"Just to confirm, that is {original}, correct?"),
        (USER, f"No, it is {corrected}."),
    )
    # The original value cannot be confirmed by an exchange that corrected it.
    original_decision = evaluate_identifier(
        claim(
            value_heard=original,
            value_confirmed=original,
            confirmation_quote=f"No, it is {corrected}.",
        ),
        transcript=transcript,
    )
    assert original_decision.state is not IdentifierState.CONFIRMED_IDENTIFIER

    # The corrected value needs its own completed read-back exchange.
    corrected_decision = evaluate_identifier(
        claim(
            value_heard=original,
            value_confirmed=corrected,
            confirmation_quote=f"No, it is {corrected}.",
        ),
        transcript=transcript,
    )
    assert corrected_decision.state is not IdentifierState.CONFIRMED_IDENTIFIER


@pytest.mark.parametrize("original,corrected", CORRECTION_PAIRS)
def test_a_correction_plus_second_readback_confirms_only_the_corrected(
    original, corrected
):
    transcript = turns(
        (AGENT, f"Just to confirm, that is {original}, correct?"),
        (USER, f"No, it is {corrected}."),
        (AGENT, f"Thank you — {corrected}, correct?"),
        (USER, "Correct."),
    )
    decision = evaluate_identifier(
        claim(
            value_heard=original,
            value_confirmed=corrected,
            confirmation_quote="Correct.",
        ),
        transcript=transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == normalize_identifier(corrected)
    assert decision.corrected is True


# --- property: a hedged status stays UNKNOWN ---------------------------------

HEDGES = [
    "I think it is showing returned in our system",
    "It is probably returned in our system",
    "I believe it is showing returned in our system",
    "It might be showing returned in our system",
    "I am not sure, but it looks returned in our system",
    "It should be showing returned in our system, let me double check",
]


def status_payload(quote: str) -> dict:
    return {
        "claim_status": "STATED_RETURNED",
        "claim_status_evidence_quote": quote,
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


@pytest.mark.parametrize("hedged_quote", HEDGES)
def test_a_hedged_status_quote_stays_unknown(hedged_quote):
    """The hedge is grounded speech — the reviewer still sees the quote —
    but the asserted status never survives it."""

    transcript = turns((AGENT, "What is the status?"), (USER, hedged_quote))
    validation = validate_structured_result(status_payload(hedged_quote), SCHEMA)
    outcome = derive_outcome(
        TransportOutcome(state=TransportState.COMPLETED, call_id="call_synthetic_grounding"),
        validation,
        transcript=transcript,
    )
    assert outcome.business.claim_status is ClaimStatus.UNKNOWN
    assert any("hedged" in note for note in outcome.business.downgrades)
    quotes = [item["quote"] for item in outcome.business.evidence]
    assert hedged_quote in quotes  # kept for the reviewer, not asserted


GROUNDING_STATES = [
    "STATED_RETURNED",
    "STATED_REJECTED",
    "STATED_IN_PROCESS",
    "STATED_PAID",
]


@pytest.mark.parametrize("state", GROUNDING_STATES)
def test_every_stated_status_requires_a_grounded_quote(state):
    """No state value may assert itself on a quote the transcript lacks."""

    ungrounded = "the portal shows a completely different status than that"
    payload = status_payload(ungrounded)
    payload["claim_status"] = state
    transcript = turns((AGENT, "Status?"), (USER, "It is returned."))
    validation = validate_structured_result(payload, SCHEMA)
    outcome = derive_outcome(
        TransportOutcome(state=TransportState.COMPLETED, call_id="call_synthetic_grounding"),
        validation,
        transcript=transcript,
    )
    assert outcome.business.claim_status is ClaimStatus.UNKNOWN
    assert any("not found in a counterparty turn" in note for note in outcome.business.downgrades)


# --- property: paraphrase never survives -------------------------------------

PARAPHRASES = [
    # The value with one word changed.
    "The labour line is missing an operating-hours reading attached",
    # The value with a word added.
    "The labour line has no operating-hours reading attached at all",
    # The value reordered.
    "No operating-hours reading is attached to the labour line",
    # The value with a typo.
    "The labour line has no operating-hours reaing attached",
]

GROUNDING_TRANSCRIPT = turns(
    (AGENT, "Why is it held?"),
    (USER, "The labour line has no operating-hours reading attached."),
)


@pytest.mark.parametrize("paraphrase", PARAPHRASES)
def test_a_paraphrase_of_counterparty_speech_is_dropped(paraphrase):
    payload = status_payload("It is returned.")
    payload["stated_reason"] = paraphrase
    transcript = GROUNDING_TRANSCRIPT + turns((USER, "It is returned."))
    validation = validate_structured_result(payload, SCHEMA)
    outcome = derive_outcome(
        TransportOutcome(state=TransportState.COMPLETED, call_id="call_synthetic_grounding"),
        validation,
        transcript=transcript,
    )
    assert outcome.business.stated_reason is None
    assert any("dropped" in note for note in outcome.business.downgrades)


def test_the_exact_span_survives_the_same_gate():
    payload = status_payload("It is returned.")
    payload["stated_reason"] = "The labour line has no operating-hours reading attached."
    transcript = GROUNDING_TRANSCRIPT + turns((USER, "It is returned."))
    validation = validate_structured_result(payload, SCHEMA)
    outcome = derive_outcome(
        TransportOutcome(state=TransportState.COMPLETED, call_id="call_synthetic_grounding"),
        validation,
        transcript=transcript,
    )
    assert (
        outcome.business.stated_reason
        == "The labour line has no operating-hours reading attached."
    )


def test_a_contiguous_prefix_of_counterparty_speech_is_containment_not_paraphrase():
    """Grounding is containment: a prefix that appears, whole and contiguous,
    inside a counterparty turn grounds what was stated — clipped, but never
    invented. The rule keeps it and the reviewer sees the exact span."""

    payload = status_payload("It is returned.")
    payload["stated_reason"] = "The labour line has no operating-hours"
    transcript = GROUNDING_TRANSCRIPT + turns((USER, "It is returned."))
    validation = validate_structured_result(payload, SCHEMA)
    outcome = derive_outcome(
        TransportOutcome(state=TransportState.COMPLETED, call_id="call_synthetic_grounding"),
        validation,
        transcript=transcript,
    )
    assert outcome.business.stated_reason == "The labour line has no operating-hours"


# --- property: no transcript, no grounding -----------------------------------


@pytest.mark.parametrize(
    "payload_quote", ["It is returned.", "Correct, case nine zero two one zero."]
)
def test_without_a_transcript_nothing_is_grounded(payload_quote):
    payload = status_payload(payload_quote)
    validation = validate_structured_result(payload, SCHEMA)
    outcome = derive_outcome(
        TransportOutcome(state=TransportState.COMPLETED, call_id="call_synthetic_grounding"),
        validation,
        transcript=None,
    )
    assert outcome.business.claim_status is ClaimStatus.UNKNOWN
    assert outcome.business.stated_reason is None
    assert outcome.terminal_state is not TerminalState.INFORMATION_OBTAINED or (
        outcome.business.claim_status is ClaimStatus.UNKNOWN
    )
