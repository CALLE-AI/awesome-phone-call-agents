"""The scoreboard, including the two it loses.

A list of only the attacks Muster catches would be marketing. Four of the six
below are caught and two are not; all six run here, and the assertion is not
"caught" but "as documented". A defence that quietly starts working is as much
a change to the honest-limits table as one that quietly stops.
"""

from __future__ import annotations

import pytest

from muster.adversary import ATTACKS, FIXED_NONCE, Attack, Outcome, run, run_all
from muster.models import Grade
from muster.nonce import check, check_reversed

#: The two the README lists as not caught, by key.
DOCUMENTED_MISSES: frozenset[str] = frozenset({"impersonator", "synthesised"})


# --------------------------------------------------------------------------
# The suite itself
# --------------------------------------------------------------------------


def test_the_suite_runs_every_attack_exactly_once() -> None:
    outcomes = run_all()
    assert len(outcomes) == len(ATTACKS)
    assert tuple(o.attack for o in outcomes) == ATTACKS
    assert len({o.attack.key for o in outcomes}) == len(ATTACKS)


def test_there_are_six_attacks_with_distinct_keys() -> None:
    assert len(ATTACKS) == 6
    assert len({a.key for a in ATTACKS}) == 6


@pytest.mark.parametrize("attack", ATTACKS, ids=[a.key for a in ATTACKS])
def test_every_attack_describes_itself(attack: Attack) -> None:
    """The description is what a reader of the scoreboard sees, so an attack
    without one is a row of ticks with nothing behind it."""
    assert isinstance(attack, Attack)
    assert attack.name.strip()
    assert attack.description.strip()
    assert isinstance(attack.expected_caught, bool)


@pytest.mark.parametrize("attack", ATTACKS, ids=[a.key for a in ATTACKS])
def test_running_one_attack_returns_a_graded_outcome(attack: Attack) -> None:
    outcome = run(attack)
    assert isinstance(outcome, Outcome)
    assert outcome.attack is attack
    assert outcome.grade in set(Grade)
    assert outcome.caught is (outcome.grade is not Grade.CONFIRMED_LIVE)


def test_caught_means_exactly_that_the_call_did_not_confirm_life() -> None:
    """There is no separate notion of catching an attacker. Muster either
    confirmed a live subject or it did not, and everything else is a referral."""
    for outcome in run_all():
        assert outcome.caught is (outcome.grade is not Grade.CONFIRMED_LIVE)


# --------------------------------------------------------------------------
# The scoreboard, in both directions
# --------------------------------------------------------------------------


def test_every_attack_behaves_exactly_as_documented() -> None:
    """The four documented as caught are caught; the two documented as not
    caught are still not caught.

    If this test ever fails, the README's honest-limits table must be updated in
    the same commit. That holds in both directions. A defence that starts
    working is good news and still a change to what the project claims about
    itself, and shipping a scoreboard that is out of date with the code is the
    thing this file exists to prevent.
    """
    for outcome in run_all():
        assert outcome.as_expected is True, (
            f"{outcome.attack.key}: expected caught="
            f"{outcome.attack.expected_caught}, got caught={outcome.caught} "
            f"(grade {outcome.grade.value}). Update the README honest-limits "
            "table in this commit."
        )


def test_exactly_four_of_the_six_attacks_are_caught() -> None:
    """The headline count, pinned so it cannot drift in either direction."""
    outcomes = run_all()
    caught = [o for o in outcomes if o.caught]
    assert len(caught) == 4
    assert len(outcomes) - len(caught) == 2


def test_the_two_that_get_through_are_the_two_that_are_documented() -> None:
    """Which two matters more than how many. Swapping a miss for a different
    miss would keep the count and break the table."""
    missed = {o.attack.key for o in run_all() if not o.caught}
    assert missed == DOCUMENTED_MISSES


# --------------------------------------------------------------------------
# The four that are caught, and what caught them
# --------------------------------------------------------------------------


def outcome_for(key: str) -> Outcome:
    return next(o for o in run_all() if o.attack.key == key)


def test_a_relative_vouching_is_caught_as_a_third_party_claim() -> None:
    """The Sogen Kato shape. Somebody else answers, says he is resting, and the
    call establishes nothing about him."""
    outcome = outcome_for("relative_vouches")
    assert outcome.caught is True
    assert outcome.grade is Grade.THIRD_PARTY_CLAIM


def test_a_recording_in_the_subjects_own_voice_is_caught_as_unproven() -> None:
    """A greeting cannot answer a challenge minted seconds before the call."""
    outcome = outcome_for("recording")
    assert outcome.caught is True
    assert outcome.grade is Grade.UNPROVEN


def test_answers_fed_from_across_the_room_are_caught_and_routed_to_a_human() -> None:
    """Every answer correct, spoken after an unattributed voice. Muster does not
    call that fraud; it calls it a case for a person."""
    outcome = outcome_for("coached")
    assert outcome.caught is True
    assert outcome.grade is Grade.NEEDS_HUMAN


def test_a_reassigned_number_is_caught_as_contra() -> None:
    """A stranger has held the line for years, so whatever was said on it was
    not said about the subject."""
    outcome = outcome_for("reassigned")
    assert outcome.caught is True
    assert outcome.grade is Grade.CONTRA


# --------------------------------------------------------------------------
# The two that get through
# --------------------------------------------------------------------------


@pytest.mark.parametrize("key", sorted(DOCUMENTED_MISSES))
def test_a_documented_miss_still_confirms_life(key: str) -> None:
    """Stated plainly rather than buried in a count. A household member who
    knows the enrolled answers passes, and so does a synthesised voice, because
    CALL-E returns transcripts and not audio. Both are open."""
    outcome = outcome_for(key)
    assert outcome.caught is False
    assert outcome.grade is Grade.CONFIRMED_LIVE
    assert outcome.as_expected is True


def test_the_documented_misses_answer_the_reverse_leg_as_well() -> None:
    """Why the reverse challenge does not close either of these.

    It proves attention, not identity. A relative who has understood the
    instruction can say three words backwards as easily as the subject can, and
    a synthesised voice is driven by whoever is reading the transcript. Both
    attacks therefore satisfy both legs, and both still pass. Asserting it here
    keeps the reverse leg from being read as a defence it is not."""
    for key in sorted(DOCUMENTED_MISSES):
        attack = next(a for a in ATTACKS if a.key == key)
        assert check(FIXED_NONCE, attack.observations) is True
        assert check_reversed(FIXED_NONCE, attack.observations) is True


def test_the_recording_answers_neither_leg() -> None:
    """The contrast that makes the point: a greeting has no way to produce
    either recital, which is what the two legs exist to detect."""
    attack = next(a for a in ATTACKS if a.key == "recording")
    assert check(FIXED_NONCE, attack.observations) is False
    assert check_reversed(FIXED_NONCE, attack.observations) is False


def test_the_synthesised_voice_attack_says_why_it_cannot_be_caught() -> None:
    """The limit is in the input, not in the grading, and the description has to
    say so or it reads as an unfixed bug."""
    attack = next(a for a in ATTACKS if a.key == "synthesised")
    assert "transcripts" in attack.description.lower()


def test_running_the_suite_twice_gives_the_same_answers() -> None:
    """A scoreboard that drifts between runs cannot be published."""
    first = [(o.attack.key, o.grade, o.caught) for o in run_all()]
    second = [(o.attack.key, o.grade, o.caught) for o in run_all()]
    assert first == second
