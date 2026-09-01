"""The high-consequence identifier control.

A schema-valid RMA is not a true RMA. These tests are the reason this
application exists, so they are written as the behaviour a reviewer should be
able to check by reading them.
"""

from __future__ import annotations

import inspect

from warrantyops.identifiers import (
    IdentifierClaim,
    IdentifierRefusal,
    IdentifierState,
    evaluate_identifier,
    normalize_identifier,
)

TURNS = (
    "Right, your authorization is four eight one seven one.",
    "Correct, that is RMA four eight one seven one.",
)

CONFIRMED = IdentifierClaim(
    value_heard="RMA four eight one seven one",
    readback_performed=True,
    value_confirmed="RMA four eight one seven one",
    confirmation_quote="Correct, that is RMA four eight one seven one.",
)


def evaluate(claim, **kwargs):
    kwargs.setdefault("transcript_turns", TURNS)
    kwargs.setdefault("prefix", "RMA")
    kwargs.setdefault("expected_pattern", r"RMA-[A-Z0-9]{3,20}")
    return evaluate_identifier(claim, **kwargs)


def test_spoken_digits_and_written_digits_normalize_to_one_value():
    assert normalize_identifier("four eight one seven one", "RMA") == "RMA-48171"
    assert normalize_identifier("RMA 48171", "RMA") == "RMA-48171"
    assert normalize_identifier("rma-4 8 1 7 1", "RMA") == "RMA-48171"


def test_absent_identifier_is_absent_not_unconfirmed():
    decision = evaluate(
        IdentifierClaim(
            value_heard=None,
            readback_performed=False,
            value_confirmed=None,
            confirmation_quote=None,
        )
    )
    assert decision.state is IdentifierState.ABSENT
    assert decision.value is None


def test_a_confirmed_readback_is_the_only_way_to_reach_confirmed():
    decision = evaluate(CONFIRMED)
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48171"
    assert decision.corrected is False


def test_a_reference_heard_once_without_a_readback_stays_unconfirmed():
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=False,
            value_confirmed=None,
            confirmation_quote=None,
        )
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert decision.value is None
    assert IdentifierRefusal.NO_READBACK in decision.refusals


def test_confidence_is_not_an_input_and_cannot_promote_an_identifier():
    """There is no confidence parameter to pass, by design."""

    signature = inspect.signature(evaluate_identifier)
    assert not any("confidence" in name for name in signature.parameters)
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=False,
            value_confirmed="RMA four eight one seven one",
            confirmation_quote="I am extremely confident the number is correct.",
        )
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER


def test_a_confirmation_quote_that_is_not_in_the_transcript_is_refused():
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=True,
            value_confirmed="RMA four eight one seven one",
            confirmation_quote="Yes that is completely correct and confirmed.",
        )
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_NOT_GROUNDED in decision.refusals


def test_a_denial_is_not_a_confirmation():
    turns = ("No, that is not right, let me repeat the reference.",)
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=True,
            value_confirmed="RMA four eight one seven one",
            confirmation_quote="No, that is not right, let me repeat the reference.",
        ),
        transcript_turns=turns,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_NEGATED in decision.refusals


def test_a_one_word_confirmation_is_too_thin_to_bind():
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=True,
            value_confirmed="RMA four eight one seven one",
            confirmation_quote="Yes.",
        ),
        transcript_turns=("Yes.",),
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.QUOTE_TOO_SHORT in decision.refusals


def test_a_value_of_the_wrong_shape_is_refused():
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA A",
            readback_performed=True,
            value_confirmed="RMA A",
            confirmation_quote="Correct, that is RMA four eight one seven one.",
        )
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
    assert IdentifierRefusal.PATTERN_MISMATCH in decision.refusals


def test_a_correction_replaces_the_value_first_heard():
    turns = (
        "Right, your authorization is four eight one seven one.",
        "No, that last digit is an eight. Four eight one seven eight, that is correct.",
    )
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=True,
            value_confirmed="RMA four eight one seven eight",
            confirmation_quote=turns[1],
        ),
        transcript_turns=turns,
    )
    assert decision.state is IdentifierState.CONFIRMED_IDENTIFIER
    assert decision.value == "RMA-48178"
    assert decision.heard_value == "RMA-48171"
    assert decision.corrected is True


def test_a_missing_transcript_never_promotes_by_itself():
    decision = evaluate(
        IdentifierClaim(
            value_heard="RMA four eight one seven one",
            readback_performed=False,
            value_confirmed=None,
            confirmation_quote=None,
        ),
        transcript_turns=None,
    )
    assert decision.state is IdentifierState.UNCONFIRMED_IDENTIFIER
