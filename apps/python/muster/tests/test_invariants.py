"""Properties that must hold for every possible call.

Case-by-case tests prove the branches. These prove the things no branch is
allowed to break, over the whole cross-product of what a call can report. They
are the safety claims from the design note, written as code:

  * Muster can confirm life; it can never confirm death.
  * Only a pass closes automatically, and nothing here stops a payment.
  * Every grade names its reason.
  * Nothing closes on a forward echo alone; the reverse leg has to be answered.
"""

from __future__ import annotations

import itertools
from typing import Iterator, NamedTuple

from muster.grading import grade
from muster.models import (
    AUTO_CLOSING_GRADES,
    Accessibility,
    Attestation,
    Endpoint,
    Grade,
    Observations,
    Subject,
    Ternary,
)
from muster.nonce import check_reversed
from tests.builders import (
    NONCE,
    PROMPTS,
    RUN_ID,
    coached_turns,
    make_observations,
    make_subject,
)

#: Words a grade must never contain. Concluding a death from a phone call is
#: how living people get wrongly cut off.
FATAL_VOCABULARY = ("dead", "death", "deceased", "died", "fatal", "expired")

ACCESSIBILITIES = (Accessibility(), Accessibility(cognitive_impairment=True))

#: A nonce reply that passes both legs, one that echoes forwards and then
#: stops, one that is out of order, and silence. The forward-only reply is the
#: shape a recording can still produce, so the sweep has to contain it or the
#: reverse invariant below would be proved against calls that never occur.
NONCE_REPLIES = (
    (NONCE.words, NONCE.weekday, NONCE.reversed_words),
    (NONCE.words, NONCE.weekday, ()),
    (("yellow", "river", "table"), NONCE.weekday, NONCE.reversed_words),
    ((), "", ()),
)

PROMPT_ANSWERS = (
    {p.prompt_id: p.expected for p in PROMPTS},
    {"pet": "Biscuit"},
    {},
)

TURN_SETS = ((), coached_turns())


class GradedCall(NamedTuple):
    """An attestation kept next to the call that produced it."""

    subject: Subject
    observed: Observations
    attestation: Attestation


def every_call() -> Iterator[GradedCall]:
    """Grade the cross-product of everything a call can report.

    Some tens of thousands of calls. Cheap, deterministic, and it means an
    invariant is checked against combinations nobody thought to write down.
    """
    combinations = itertools.product(
        Endpoint,
        Ternary,
        Ternary,
        Ternary,
        Ternary,
        NONCE_REPLIES,
        PROMPT_ANSWERS,
        TURN_SETS,
        ACCESSIBILITIES,
    )
    for endpoint, claim, dead, wrong, distress, reply, answers, turns, access in combinations:
        words, weekday, reversed_words = reply
        subject = make_subject(accessibility=access)
        observed = make_observations(
            answered_by=endpoint,
            claimed_to_be_subject=claim,
            subject_reported_dead=dead,
            wrong_number=wrong,
            distress_or_confusion=distress,
            nonce_words_heard=words,
            nonce_words_reversed_heard=reversed_words,
            weekday_heard=weekday,
            prompt_answers=answers,
            turns=turns,
        )
        yield GradedCall(
            subject, observed, grade(subject, observed, NONCE, PROMPTS, RUN_ID)
        )


def test_the_sweep_covers_a_serious_number_of_calls() -> None:
    """If this shrinks, the invariants below quietly stopped proving much."""
    assert sum(1 for _ in every_call()) > 1000


def test_no_grade_means_dead() -> None:
    """There is deliberately no verdict of death anywhere in the vocabulary."""
    for member in Grade:
        lowered = f"{member.name} {member.value}".lower()
        for word in FATAL_VOCABULARY:
            assert word not in lowered


def test_every_grade_is_reachable_and_none_is_invented() -> None:
    seen = {call.attestation.grade for call in every_call()}
    assert seen == set(Grade)


def test_no_attestation_ever_stops_a_payment() -> None:
    """One more month of overpayment is a cheaper error than cutting off a
    pensioner's only income."""
    for call in every_call():
        assert call.attestation.stops_payment is False


def test_only_confirmed_live_closes_automatically() -> None:
    for call in every_call():
        expected = call.attestation.grade is Grade.CONFIRMED_LIVE
        assert call.attestation.auto_closes is expected


def test_the_auto_closing_set_holds_exactly_one_grade() -> None:
    assert AUTO_CLOSING_GRADES == frozenset({Grade.CONFIRMED_LIVE})


def test_confirmed_live_is_impossible_unless_the_subject_answered() -> None:
    """Nobody else's voice can carry a pass — not a relative, not a machine."""
    for call in every_call():
        if call.attestation.grade is Grade.CONFIRMED_LIVE:
            assert call.observed.answered_by is Endpoint.SUBJECT


def test_confirmed_live_is_impossible_when_the_freshness_challenge_failed() -> None:
    """A recording cannot pass, whatever else the call contained."""
    for call in every_call():
        if call.attestation.nonce_ok is False:
            assert call.attestation.grade is not Grade.CONFIRMED_LIVE


def test_confirmed_live_is_impossible_when_the_reverse_leg_was_not_satisfied() -> None:
    """The leg that carries the confirmation.

    Echoing three words forwards is within reach of a recording spliced into
    the line. Saying them back in reverse is not, so no combination of anything
    else a call can report may close an attestation without it -- and because it
    collects nothing personal, it is the only challenge of that strength the
    platform will let Muster ask."""
    for call in every_call():
        if not check_reversed(NONCE, call.observed):
            assert call.attestation.grade is not Grade.CONFIRMED_LIVE


def test_a_forward_echo_alone_never_closes_an_attestation() -> None:
    """Stated from the other side, over the calls that actually pass the
    freshness leg and then stop: those are exactly the recordings, and they end
    weak rather than confirmed."""
    seen_forward_only = 0
    for call in every_call():
        if call.attestation.nonce_ok is True and not check_reversed(NONCE, call.observed):
            seen_forward_only += 1
            assert call.attestation.grade is not Grade.CONFIRMED_LIVE
    assert seen_forward_only > 0, "the sweep no longer contains a forward-only reply"


def test_confirmed_live_is_impossible_without_self_identification() -> None:
    for call in every_call():
        if call.attestation.grade is Grade.CONFIRMED_LIVE:
            assert call.observed.claimed_to_be_subject is Ternary.YES


def test_confirmed_live_is_impossible_when_coaching_was_suspected() -> None:
    for call in every_call():
        if call.attestation.coaching_suspected:
            assert call.attestation.grade is not Grade.CONFIRMED_LIVE


def test_confirmed_live_is_impossible_for_a_subject_enrolled_for_a_human_path() -> None:
    for call in every_call():
        if call.subject.accessibility.requires_human_path:
            assert call.attestation.grade is Grade.NEEDS_HUMAN
            assert call.attestation.reasons == ("enrolled_accessibility_route",)


def test_every_attestation_carries_at_least_one_reason() -> None:
    """A grade with no named reason is not an attestation, it is a bare boolean."""
    for call in every_call():
        reasons = call.attestation.reasons
        assert len(reasons) >= 1
        assert all(isinstance(r, str) and r.strip() for r in reasons)


def test_no_reason_string_asserts_a_death() -> None:
    """`death_reported_...` reports what was said, not a conclusion; it is the
    one place the word may appear, and it must name who has to verify it."""
    for call in every_call():
        for reason in call.attestation.reasons:
            if any(word in reason for word in FATAL_VOCABULARY):
                assert reason == "death_reported_requires_human_verification"


def test_challenge_counts_are_consistent() -> None:
    for call in every_call():
        attestation = call.attestation
        assert 0 <= attestation.challenges_passed <= attestation.challenges_asked
        assert attestation.challenges_asked == len(PROMPTS)


def test_grading_is_a_pure_function_of_its_inputs() -> None:
    """Same call, same grade. A verdict that drifts cannot be audited."""
    first = [(c.attestation.grade, c.attestation.reasons) for c in every_call()]
    second = [(c.attestation.grade, c.attestation.reasons) for c in every_call()]
    assert first == second
