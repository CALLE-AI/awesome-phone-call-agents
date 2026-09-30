"""The escalation ladder, and the rung that may never speak for the subject.

Not confirming is the ordinary case, so the ladder is what stops Muster from
either stranding living people or teaching a scheme to ignore the signal. It
climbs, and it ends with a person.

One claim in this file matters more than the rest. A call to somebody else can
never produce evidence that the subject is alive, however convincing what they
say. That is the Sogen Kato failure, and `test_no_rung_that_speaks_to_somebody
_else_may_attest` is the test that keeps it closed.
"""

from __future__ import annotations

import pytest

from muster.ladder import (
    NEVER_ATTESTS,
    ORDER,
    RUNG_DAYS,
    RUNGS,
    SETTLED,
    Rung,
    Step,
    days_to_human,
    may_attest,
    next_step,
)
from muster.models import Grade


# --------------------------------------------------------------------------
# The ladder is complete
# --------------------------------------------------------------------------


def test_the_order_lists_every_step_exactly_once() -> None:
    """A step missing from ORDER would be unreachable; a repeated one would
    loop the ladder and never reach a person."""
    assert set(ORDER) == set(Step)
    assert len(ORDER) == len(Step)


def test_every_step_has_a_wait_and_a_described_rung() -> None:
    assert set(RUNG_DAYS) == set(Step)
    assert set(RUNGS) == set(Step)
    for step, rung in RUNGS.items():
        assert isinstance(rung, Rung)
        assert rung.step is step
        assert rung.purpose.strip()


def test_the_ladder_starts_on_the_enrolled_number_and_ends_with_a_person() -> None:
    """The shape of the whole thing in one assertion: dial the subject first,
    hand it to a human last."""
    assert ORDER[0] is Step.PRIMARY_NUMBER
    assert ORDER[-1] is Step.HUMAN_VISIT
    assert RUNGS[Step.HUMAN_VISIT].dials is False


# --------------------------------------------------------------------------
# Walking it
# --------------------------------------------------------------------------


def test_next_step_from_nothing_is_the_first_rung() -> None:
    assert next_step(None, None) is Step.PRIMARY_NUMBER


def test_next_step_walks_the_whole_order_in_sequence() -> None:
    walked: list[Step] = []
    current = next_step(None, Grade.UNPROVEN)
    while current is not None:
        walked.append(current)
        current = next_step(current, Grade.UNPROVEN)
    assert tuple(walked) == ORDER


@pytest.mark.parametrize(
    ("current", "expected"),
    [
        (Step.PRIMARY_NUMBER, Step.RETRY_PRIMARY),
        (Step.RETRY_PRIMARY, Step.ALTERNATE_NUMBER),
        (Step.ALTERNATE_NUMBER, Step.NOMINATED_CONTACT),
        (Step.NOMINATED_CONTACT, Step.HUMAN_VISIT),
    ],
)
def test_each_rung_leads_to_the_next(current: Step, expected: Step) -> None:
    assert next_step(current, Grade.UNPROVEN) is expected


def test_the_ladder_stops_at_the_human_visit() -> None:
    """Muster does not climb past a person. There is nothing above them."""
    assert next_step(Step.HUMAN_VISIT, Grade.UNPROVEN) is None
    assert next_step(Step.HUMAN_VISIT, None) is None
    assert next_step(Step.HUMAN_VISIT, Grade.CONTRA) is None


@pytest.mark.parametrize("current", [None, *ORDER])
def test_a_confirmed_live_settles_the_ladder_from_any_rung(current: Step | None) -> None:
    """Once the subject has answered and passed, the chase is over wherever it
    had got to. Continuing to escalate after a pass is harassment."""
    assert next_step(current, Grade.CONFIRMED_LIVE) is None


def test_only_a_confirmed_live_settles_the_ladder() -> None:
    """A relative's word does not settle it, and neither does silence."""
    assert SETTLED == frozenset({Grade.CONFIRMED_LIVE})
    for grade in Grade:
        if grade is Grade.CONFIRMED_LIVE:
            continue
        assert next_step(Step.PRIMARY_NUMBER, grade) is not None


# --------------------------------------------------------------------------
# The Kato defence
# --------------------------------------------------------------------------


def test_the_nominated_contact_may_never_attest() -> None:
    """Sogen Kato lay dead in a Tokyo bedroom from 1978 to 2010 while his family
    told every caller he was resting. The rung that phones the family is the
    rung that failed, so it is denied the power to conclude anything."""
    assert may_attest(Step.NOMINATED_CONTACT) is False
    assert RUNGS[Step.NOMINATED_CONTACT].may_attest is False


def test_the_human_visit_may_never_attest_either() -> None:
    """The visit hands the case to a person. Muster records no verdict of its
    own from it."""
    assert may_attest(Step.HUMAN_VISIT) is False
    assert RUNGS[Step.HUMAN_VISIT].may_attest is False


def test_no_rung_that_speaks_to_somebody_else_may_attest() -> None:
    """The Sogen Kato defence, asserted over the whole set rather than one rung.

    Any step listed in NEVER_ATTESTS reaches somebody other than the subject.
    Nothing such a call produces may ever be read as evidence that the subject
    is alive -- not a reassurance, not a knowledge answer, not a nonce repeated
    back perfectly. If a future rung is added to NEVER_ATTESTS and given
    `may_attest=True`, this fails, and it is meant to.
    """
    assert NEVER_ATTESTS
    for step in NEVER_ATTESTS:
        assert step in set(Step)
        assert may_attest(step) is False, f"{step.value} must never attest"
        assert RUNGS[step].may_attest is False, f"{step.value} must never attest"


def test_may_attest_agrees_with_the_rung_table_for_every_step() -> None:
    """Two statements of the same rule, kept in step. A caller that reads the
    table must get the same answer as one that calls the function."""
    for step in Step:
        assert may_attest(step) is RUNGS[step].may_attest


def test_only_rungs_that_reach_the_subject_may_attest() -> None:
    """The positive half of the rule: the three that dial the subject's own
    numbers, and nothing else."""
    attesting = {step for step in Step if may_attest(step)}
    assert attesting == {
        Step.PRIMARY_NUMBER,
        Step.RETRY_PRIMARY,
        Step.ALTERNATE_NUMBER,
    }


def test_the_nominated_contact_is_only_ever_asked_to_pass_on_a_message() -> None:
    """The purpose text is the instruction the caller runs, so it carries the
    rule too: ask them nothing, record nothing they volunteer."""
    purpose = RUNGS[Step.NOMINATED_CONTACT].purpose.lower()
    assert "pass on a message" in purpose
    assert "record nothing they volunteer" in purpose


# --------------------------------------------------------------------------
# How long it takes
# --------------------------------------------------------------------------


def test_days_to_human_sums_every_rung_from_the_start() -> None:
    assert days_to_human() == sum(RUNG_DAYS.values())
    assert days_to_human(Step.PRIMARY_NUMBER) == days_to_human()


@pytest.mark.parametrize("start", list(ORDER))
def test_days_to_human_sums_the_remaining_rungs_from_anywhere(start: Step) -> None:
    remaining = ORDER[ORDER.index(start):]
    assert days_to_human(start) == sum(RUNG_DAYS[s] for s in remaining)


def test_starting_further_up_never_takes_longer() -> None:
    """Each rung climbed is time already spent, so the remaining wait only
    shrinks."""
    waits = [days_to_human(step) for step in ORDER]
    assert waits == sorted(waits, reverse=True)


def test_the_last_rung_costs_nothing_because_it_is_the_handover() -> None:
    assert RUNG_DAYS[Step.HUMAN_VISIT] == 0
    assert days_to_human(Step.HUMAN_VISIT) == 0


def test_the_ladder_reaches_a_person_inside_a_fortnight() -> None:
    """A characterisation of the current waits. If someone lengthens a rung, it
    should be a deliberate decision about how long a case may sit unlooked-at."""
    assert 0 < days_to_human() <= 14
