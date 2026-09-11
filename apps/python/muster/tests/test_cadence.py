"""When the next call is due.

The whole argument for doing this by phone is that a weak check run often beats
a strong check run once a year. That argument only survives if the interval
actually responds to the evidence, so the ordering between grades is asserted
here rather than left to the comment above the table.

An interval is never a deadline for the subject: these tests check when Muster
next dials, and nothing else. No test here may ever assert that something
expires.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from muster.cadence import (
    INTERVAL_DAYS,
    interval_days,
    next_due,
    worst_case_detection_days,
)
from muster.ladder import days_to_human
from muster.models import Attestation, Grade

FIXED_NOW = datetime(2026, 9, 8, 9, 30, tzinfo=timezone.utc)

#: Weakest to strongest, as the schedule ought to see them. Written out rather
#: than derived from `Grade` so that reordering the enum cannot quietly rewrite
#: what this file claims.
BY_STRENGTH: tuple[Grade, ...] = (
    Grade.CONTRA,
    Grade.THIRD_PARTY_CLAIM,
    Grade.UNPROVEN,
    Grade.PRESUMED_LIVE_WEAK,
    Grade.CONFIRMED_LIVE,
)


def attested(grade: Grade, when: datetime = FIXED_NOW) -> Attestation:
    """An attestation cut down to what the schedule reads: a grade and a time.

    Built directly rather than graded from a call, because the cadence table is
    a function of the grade alone and a fabricated call would only obscure that.
    """
    return Attestation(
        subject_id="subj-0001",
        run_id="run-0001",
        graded_at=when,
        grade=grade,
        reasons=("fixture",),
    )


# --------------------------------------------------------------------------
# The table
# --------------------------------------------------------------------------


def test_every_grade_has_an_entry_in_the_table() -> None:
    """A grade with no interval would silently fall out of the schedule."""
    assert set(INTERVAL_DAYS) == set(Grade)


def test_needs_human_has_no_interval_because_a_person_owns_it() -> None:
    """The schedule stops when a caseworker takes the case. Re-dialling behind
    a person is how a subject gets pestered by a machine they already spoke to."""
    assert INTERVAL_DAYS[Grade.NEEDS_HUMAN] is None
    assert interval_days(Grade.NEEDS_HUMAN) is None


@pytest.mark.parametrize("grade", BY_STRENGTH)
def test_every_machine_gradeable_outcome_keeps_the_schedule_running(grade: Grade) -> None:
    """Everything short of a human takeover gets called again, and soon."""
    days = interval_days(grade)
    assert days is not None
    assert days >= 1


def test_interval_days_agrees_with_the_table() -> None:
    for grade in Grade:
        assert interval_days(grade) == INTERVAL_DAYS[grade]


# --------------------------------------------------------------------------
# The ordering, which is the whole design
# --------------------------------------------------------------------------


def test_stronger_evidence_always_buys_a_longer_interval() -> None:
    """The named ordering, spelled out so a table edit cannot invert it.

    A call that confirmed a live human earns the longest rest; a call that
    contradicted itself earns the shortest. If someone lengthens the CONTRA
    interval to save call minutes, this fails.
    """
    assert (
        INTERVAL_DAYS[Grade.CONFIRMED_LIVE]
        > INTERVAL_DAYS[Grade.PRESUMED_LIVE_WEAK]
        > INTERVAL_DAYS[Grade.UNPROVEN]
        > INTERVAL_DAYS[Grade.THIRD_PARTY_CLAIM]
        >= INTERVAL_DAYS[Grade.CONTRA]
    )


def test_the_ordering_holds_pairwise_across_the_whole_ladder_of_evidence() -> None:
    """The same claim, checked on every adjacent pair rather than one chain."""
    for weaker, stronger in zip(BY_STRENGTH, BY_STRENGTH[1:]):
        weak_days = interval_days(weaker)
        strong_days = interval_days(stronger)
        assert weak_days is not None and strong_days is not None
        assert strong_days >= weak_days, f"{stronger.value} rests less than {weaker.value}"


def test_a_relatives_word_is_chased_harder_than_silence() -> None:
    """Someone answered and vouched for the subject. That is the Kato shape, so
    it must be chased at least as hard as a call nobody picked up."""
    assert INTERVAL_DAYS[Grade.THIRD_PARTY_CLAIM] <= INTERVAL_DAYS[Grade.UNPROVEN]


# --------------------------------------------------------------------------
# next_due
# --------------------------------------------------------------------------


def test_next_due_is_none_when_a_human_owns_the_case() -> None:
    assert next_due(attested(Grade.NEEDS_HUMAN)) is None


def test_next_due_is_none_for_a_human_case_even_with_an_explicit_start() -> None:
    """Handing the case over stops the schedule; it does not merely defer it."""
    assert next_due(attested(Grade.NEEDS_HUMAN), after=date(2026, 12, 25)) is None


@pytest.mark.parametrize(
    ("grade", "expected"),
    [
        (Grade.CONFIRMED_LIVE, date(2026, 10, 8)),
        (Grade.PRESUMED_LIVE_WEAK, date(2026, 9, 15)),
        (Grade.UNPROVEN, date(2026, 9, 11)),
        (Grade.THIRD_PARTY_CLAIM, date(2026, 9, 10)),
        (Grade.CONTRA, date(2026, 9, 9)),
    ],
)
def test_next_due_counts_from_the_day_the_call_was_graded(
    grade: Grade, expected: date
) -> None:
    assert next_due(attested(grade)) == expected


def test_next_due_crosses_a_month_boundary_correctly() -> None:
    """Thirty days from late September lands in October, not on the 61st."""
    late = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)
    assert next_due(attested(Grade.CONFIRMED_LIVE, late)) == date(2026, 10, 30)


def test_an_explicit_start_date_overrides_the_grading_date() -> None:
    """A scheme that pauses calling over a holiday resumes from the date it
    gives, not from a grading stamp weeks in the past."""
    due = next_due(attested(Grade.CONFIRMED_LIVE), after=date(2027, 1, 4))
    assert due == date(2027, 2, 3)


def test_next_due_ignores_the_time_of_day() -> None:
    """Two calls on the same day are due back on the same day."""
    morning = attested(Grade.UNPROVEN, datetime(2026, 9, 8, 0, 1, tzinfo=timezone.utc))
    evening = attested(Grade.UNPROVEN, datetime(2026, 9, 8, 23, 59, tzinfo=timezone.utc))
    assert next_due(morning) == next_due(evening)


# --------------------------------------------------------------------------
# Worst case detection
# --------------------------------------------------------------------------


def test_worst_case_is_one_full_interval_plus_the_ladder() -> None:
    """The headline number, and the arithmetic behind it stated openly: a whole
    cycle can pass before the next attempt, and then the ladder has to climb."""
    rungs = days_to_human()
    assert worst_case_detection_days(rungs) == INTERVAL_DAYS[Grade.CONFIRMED_LIVE] + rungs


def test_worst_case_accepts_a_scheme_chosen_interval() -> None:
    assert worst_case_detection_days(10, confirmed_interval=90) == 100


def test_a_daily_cadence_is_dominated_by_the_ladder() -> None:
    """Calling every day does not detect anything in a day: the ladder still has
    to run before a person sees the case."""
    rungs = days_to_human()
    assert worst_case_detection_days(rungs, confirmed_interval=1) == 1 + rungs


def test_worst_case_treats_a_zero_interval_as_zero_not_as_the_default() -> None:
    """Guarding against `or` swallowing a deliberate 0."""
    assert worst_case_detection_days(10, confirmed_interval=0) == 10


def test_worst_case_returns_a_plain_integer_of_days() -> None:
    value = worst_case_detection_days(days_to_human())
    assert isinstance(value, int)
    assert value > 0
