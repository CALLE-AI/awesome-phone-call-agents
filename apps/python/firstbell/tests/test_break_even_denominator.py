"""The break-even ceiling has to divide like by like.

`calls_placed` counts the attempts CALL-E billed, and it excludes replays deliberately: "A
call an idempotency key replayed was not placed by this run, was not billed."
`attempts_resolved` counts every attempt behind a closed record, replays included, which is
the right number for the sentence about work removed and the wrong one to divide by billed
attempts. A partly replayed run therefore put attempts in the numerator that it had removed
from the denominator, and reported a ceiling three times the real one. This is the exact
state of receipt `02-idempotent-replay-no-calls.json`, and it is what a re-run after a crash
produces once some rows are new and some are not.
"""
from __future__ import annotations

import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))

from dispatch import Escalation, ItemResult, Resolution, WorkItem  # noqa: E402
from firstbell.domain import StaffCost, summarise  # noqa: E402


def _row(name: str, placed: bool | None) -> ItemResult:
    return ItemResult(item=WorkItem(id=name, phones=("+915550000001",)),
                      resolution=Resolution.RESOLVED, escalation=Escalation.NONE,
                      attempts_made=1, placed_by_this_run=placed, spoke_to_someone=True)


def _ceiling(rows) -> float:
    return summarise(rows, live=True, staff=StaffCost.us_school_office(),
                     escalation_staff=StaffCost.us_school_safeguarding_lead()
                     ).break_even_per_call_minute


def test_a_replayed_attempt_is_in_neither_half_of_the_ratio():
    one_billed = [_row("new", True)]
    with_replays = one_billed + [_row("replay-1", False), _row("replay-2", False)]

    assert _ceiling(with_replays) == _ceiling(one_billed), (
        "two replayed attempts, billed to nobody, tripled the ceiling this entry leads with")


def test_an_unknown_placement_is_left_out_of_both_halves():
    """None means the response carried no usable created_at.

    `calls_placed` already declines to count those, so the numerator declines too. Counting
    it in one half only is the same defect this fixes, one row narrower.
    """
    assert _ceiling([_row("new", True), _row("unsure", None)]) == _ceiling(
        [_row("new", True)])


def test_the_work_removed_sentence_still_counts_every_attempt():
    """A replay did remove work from a desk even though nobody was billed for it, so the
    prose figure and the ratio numerator are two different quantities on purpose."""
    s = summarise([_row("new", True), _row("replay", False)], live=True,
                  staff=StaffCost.us_school_office(),
                  escalation_staff=StaffCost.us_school_safeguarding_lead())
    assert s.attempts_resolved == 2, "the work-removed figure lost the replayed attempt"
    assert s.attempts_resolved_billed == 1, "the billed figure gained an unbilled attempt"
