"""The high-consequence identifier control, and attempts to break it.

A schema-valid RMA is not a true RMA. These tests are the reason this
application exists, so they are written as the behaviour a reviewer should be
able to check by reading them.

The attack the whole design is aimed at: an affirmative sentence exists
somewhere in the transcript, and naive grounding accepts it as confirmation of
a number nobody was talking about.
"""

from __future__ import annotations

import inspect

from warrantyops.identifiers import (
    IdentifierClaim,
    IdentifierRefusal,
    IdentifierState,
    TranscriptTurn,
    digit_runs,
    evaluate_identifier,
    normalize_identifier,
)

PATTERN = r"RMA-[A-Z0-9]{3,20}"


def turns(*pairs: tuple[str, str]) -> tuple[TranscriptTurn, ...]:
    return tuple(TranscriptTurn(speaker=s, text=t) for s, t in pairs)


def claim(heard=None, readback=True, confirmed=None, quote=None) -> IdentifierClaim:
    return IdentifierClaim(
        value_heard=heard,
        readback_performed=readback,
        value_confirmed=confirmed,
        confirmation_quote=quote,
    )


def evaluate(the_claim, transcript, **kwargs):
    kwargs.setdefault("prefix", "RMA")
    kwargs.setdefault("expected_pattern", PATTERN)
    return evaluate_identifier(the_claim, transcript=transcript, **kwargs)


CLEAN = turns(
    ("bot", "What is the authorization number?"),
    ("user", "Your authorization is four eight one seven one."),
    ("bot", "Just to confirm, that is RMA four eight one seven one, correct?"),
    ("user", "Correct, that is RMA four eight one seven one."),
)


# --- the machinery ---------------------------------------------------------

def test_spoken_and_written_digits_normalize_to_one_value():
    assert normalize_identifier("four eight one seven one", "RMA") == "RMA-48171"
    assert normalize_identifier("RMA 48171", "RMA") == "RMA-48171"
    assert normalize_identifier("rma-4 8 1 7 1", "RMA") == "RMA-48171"


def test_digit_runs_reads_numbers_out_of_ordinary_speech():
    assert "48178" in "".join(digit_runs("four eight one seven eight, that is correct"))
    assert digit_runs("no digits here at all") == set()
    assert digit_runs("case nine zero two one zero and RMA four eight one seven one") == {
        "90210",
        "48171",
    }


def test_absent_identifier_is_absent_not_unconfirmed():
    decision = evaluate(claim(readback=False), CLEAN)
    assert decision.state is IdentifierState.ABSENT
    assert decision.value is None


def test_a_confirmed_readback_is_the_only_way_to_reach_confirmed():
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Correct, that is RMA four eight one seven one.",
        ),
        CLEAN,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48171"
    assert decision.corrected is False


def test_confidence_is_not_an_input_and_cannot_promote_an_identifier():
    signature = inspect.signature(evaluate_identifier)
    assert not any("confidence" in name for name in signature.parameters)
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            readback=False,
            confirmed="RMA four eight one seven one",
            quote="I am extremely confident the number is correct.",
        ),
        CLEAN,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.NO_READBACK in decision.refusals


# --- attacks ---------------------------------------------------------------

def test_attack_yes_to_a_different_question_does_not_confirm_a_number():
    """The failure this design exists to prevent.

    An affirmative counterparty turn exists, it is genuinely in the transcript,
    and it is an answer to something else entirely.
    """

    transcript = turns(
        ("bot", "Is now a good moment for a couple of questions?"),
        ("user", "Yes, that is fine, go ahead."),
        ("bot", "Thank you."),
        ("user", "Your authorization is four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Yes, that is fine, go ahead.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE in decision.refusals
    assert decision.value is None


def test_attack_a_hedge_is_not_a_confirmation():
    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one seven one, correct?"),
        ("user", "Yeah, I think so, that sounds about right."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Yeah, I think so, that sounds about right.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_HEDGED in decision.refusals


def test_attack_a_correction_without_a_second_readback_is_not_confirmed():
    """48171 was heard as 48117. The representative corrects it and stops.

    Nobody has yet agreed to 48171 as a read-back, so it is not confirmed. The
    agent has to read the corrected value back.
    """

    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one one seven, correct?"),
        ("user", "No, it is four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one one seven",
            confirmed="RMA four eight one seven one",
            quote="No, it is four eight one seven one.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_NEGATED in decision.refusals


def test_a_correction_followed_by_a_second_readback_is_confirmed():
    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one one seven, correct?"),
        ("user", "No, it is four eight one seven one."),
        ("bot", "Apologies. RMA four eight one seven one, correct?"),
        ("user", "Yes, four eight one seven one, that is correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one one seven",
            confirmed="RMA four eight one seven one",
            quote="Yes, four eight one seven one, that is correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48171"
    assert decision.heard_value == "RMA-48117"
    assert decision.corrected is True


def test_a_correction_and_confirmation_in_one_breath_binds_to_the_spoken_value():
    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one seven one, correct?"),
        ("user", "No, that last digit is an eight. Four eight one seven eight, that is correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven eight",
            quote="No, that last digit is an eight. Four eight one seven eight, that is correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48178"
    assert decision.corrected is True


def test_attack_a_correction_cannot_confirm_the_value_it_corrected():
    """The agent's rejected read-back must not be admissible as agreement."""

    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one seven one, correct?"),
        ("user", "No, that last digit is an eight. Four eight one seven eight, that is correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="No, that last digit is an eight. Four eight one seven eight, that is correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE in decision.refusals


def test_attack_two_numbers_in_one_readback_cannot_be_resolved_by_correct():
    transcript = turns(
        (
            "bot",
            "So that is case nine zero two one zero and RMA four eight one seven one, correct?",
        ),
        ("user", "Yes, that is correct, both of those."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Yes, that is correct, both of those.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.AMBIGUOUS_EXCHANGE in decision.refusals


def test_attack_confirming_the_case_number_does_not_confirm_the_rma():
    transcript = turns(
        ("bot", "Just to confirm, the case number is nine zero two one zero, correct?"),
        ("user", "Yes, nine zero two one zero is correct."),
        ("bot", "Thank you."),
        ("user", "And the authorization is four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Yes, nine zero two one zero is correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE in decision.refusals


def test_attack_the_agents_own_readback_is_not_counterparty_agreement():
    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one seven one, correct?"),
        ("user", "Sorry, could you say that again?"),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Just to confirm, that is RMA four eight one seven one, correct?",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_NOT_IN_COUNTERPARTY_TURN in decision.refusals


def test_attack_a_quote_that_is_nowhere_in_the_transcript_is_refused():
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Yes that is completely correct and confirmed.",
        ),
        CLEAN,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_NOT_IN_COUNTERPARTY_TURN in decision.refusals


def test_without_a_transcript_nothing_can_be_confirmed():
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Correct, that is RMA four eight one seven one.",
        ),
        None,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.TRANSCRIPT_UNAVAILABLE in decision.refusals


# --- short affirmative replies ---------------------------------------------
#
# "Correct." is the most common thing a warranty desk says, and the inherited
# twelve-character floor refused all of them. The floor now applies only to a
# substring match, which is the case it was protecting; a short reply that is
# the whole turn is admitted, on stricter conditions.

def test_a_bare_correct_confirms_an_unambiguous_readback():
    transcript = turns(
        ("bot", "Just confirming, RMA four eight one seven eight?"),
        ("user", "Correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven eight",
            quote="Correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48178"
    assert decision.corrected is True


def test_a_bare_yes_confirms_an_unambiguous_readback():
    transcript = turns(
        ("bot", "Just confirming, RMA four eight one seven eight?"),
        ("user", "Yes."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven eight",
            confirmed="RMA four eight one seven eight",
            quote="Yes.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48178"


def test_attack_a_bare_correct_cannot_resolve_a_two_number_readback():
    transcript = turns(
        (
            "bot",
            "So that is case nine zero two one zero and RMA four eight one seven one?",
        ),
        ("user", "Correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.AMBIGUOUS_EXCHANGE in decision.refusals


def test_attack_a_bare_correct_answering_an_unrelated_question_confirms_nothing():
    transcript = turns(
        ("bot", "Am I through to the warranty desk?"),
        ("user", "Correct."),
        ("bot", "Thank you."),
        ("user", "Your authorization is four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE in decision.refusals


def test_attack_a_short_reply_that_recurs_must_bind_everywhere_or_nowhere():
    """"Correct." twice, once for the case number and once for the RMA.

    The two occurrences are the same string, so nothing in the extracted quote
    says which one was meant.
    """

    transcript = turns(
        ("bot", "The case number is nine zero two one zero?"),
        ("user", "Correct."),
        ("bot", "And RMA four eight one seven one?"),
        ("user", "Correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER


def test_a_short_reply_with_no_readback_before_it_confirms_nothing():
    transcript = turns(
        ("user", "Your authorization is four eight one seven one."),
        ("user", "Correct."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven one",
            confirmed="RMA four eight one seven one",
            quote="Correct.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_TOO_SHORT in decision.refusals


def test_a_short_fragment_of_a_longer_turn_still_needs_the_length_floor():
    transcript = turns(
        ("bot", "Just confirming, RMA four eight one seven eight?"),
        ("user", "Well, the paperwork says one thing and the label says another."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one seven eight",
            confirmed="RMA four eight one seven eight",
            quote="says one",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_TOO_SHORT in decision.refusals


def test_a_denial_naming_the_correct_value_is_still_a_denial():
    """Required case 4: the wrong read-back is rejected and nothing is confirmed."""

    transcript = turns(
        ("bot", "Just confirming, RMA four eight one one seven?"),
        ("user", "No, four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA four eight one one seven",
            confirmed="RMA four eight one seven one",
            quote="No, four eight one seven one.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_NEGATED in decision.refusals
    assert decision.value is None


def test_a_value_of_the_wrong_shape_is_refused():
    transcript = turns(
        ("bot", "Just to confirm, that is RMA A, correct?"),
        ("user", "Correct, that is RMA four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA A",
            confirmed="RMA A",
            quote="Correct, that is RMA four eight one seven one.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.IDENTIFIER_NOT_IN_EXCHANGE in decision.refusals


# --- the binding edges: empty folds, short replies, missing halves -------------


def test_a_value_that_folds_to_nothing_is_not_an_identifier():
    assert normalize_identifier("---", "RMA") is None


def test_a_punctuation_only_quote_cannot_bind_to_any_turn():
    decision = evaluate(claim(heard="RMA 48171", confirmed="RMA 48171", quote="—"), CLEAN)
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_TOO_SHORT in decision.refusals


def test_a_short_reply_found_inside_a_longer_turn_is_still_too_short():
    """The quote must be the counterparty's whole turn, or long enough to
    carry its own words: a word buried in a longer sentence can bind to the
    wrong exchange."""

    transcript = turns(
        ("bot", "Just to confirm, that is RMA four eight one seven one, correct?"),
        ("user", "That is correct, the RMA is four eight one seven one."),
    )
    decision = evaluate(
        claim(heard="RMA 48171", confirmed="RMA 48171", quote="correct"),
        transcript,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_TOO_SHORT in decision.refusals


def test_a_readback_without_a_confirmation_value_refuses_by_name():
    decision = evaluate(
        claim(
            heard="RMA 48171",
            confirmed=None,
            quote="Correct, RMA four eight one seven one.",
        ),
        CLEAN,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.NO_CONFIRMATION_VALUE in decision.refusals


def test_a_confirmation_as_the_very_first_turn_has_no_readback_to_bind_to():
    """With no agent turn before it, the read-back half of the exchange does
    not exist in the transcript; the claim's own ``readback_performed`` flag
    is then the only witness, and the binding walk starts from nothing."""

    transcript = turns(
        ("user", "Correct, that is RMA four eight one seven one."),
    )
    decision = evaluate(
        claim(
            heard="RMA 48171",
            confirmed="RMA 48171",
            quote="Correct, that is RMA four eight one seven one.",
        ),
        transcript,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48171"
