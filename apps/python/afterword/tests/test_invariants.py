"""Properties that must hold for every possible call.

Case-by-case tests prove the branches. These prove the things no branch is
allowed to break, over the whole cross-product of what a call can report. They
are the commitment boundary from the design note, written as code:

  * No grade means an account was closed, a service cancelled or anything
    agreed. The agent may ask; it may never do.
  * A contradiction is never resolved, and never quietly dropped.
  * Every grade names its reason.
"""

from __future__ import annotations

import itertools
from typing import Iterator, NamedTuple

from afterword.capture import capture
from afterword.models import (
    PACKABLE_GRADES,
    CaptureResult,
    DirectDebits,
    Grade,
    Observations,
    PriorCall,
    Reached,
    Ternary,
)
from tests.builders import PRIOR, RUN_ID, make_estate, make_institution, make_observations

#: Words a grade or a reason must never contain. Afterword establishes what an
#: institution requires; a family and a solicitor do the rest.
ACTION_VOCABULARY = (
    "closed",
    "cancelled",
    "canceled",
    "settled",
    "waived",
    "agreed",
    "transferred",
    "redirected",
)

ESTATE = make_estate()
INSTITUTION = make_institution()

DEPARTMENTS = ("", "Bereavement Team", "Estates Department")

DOCUMENT_SETS = (
    (),
    ("certified copy of the death certificate", "grant of probate"),
    ("original death certificate",),
)

PRIOR_SETS: tuple[tuple[PriorCall, ...], ...] = ((), (PRIOR,))


class GradedCall(NamedTuple):
    """A capture kept next to the call that produced it."""

    observed: Observations
    priors: tuple[PriorCall, ...]
    result: CaptureResult


def every_call() -> Iterator[GradedCall]:
    """Grade the cross-product of everything a call can report.

    Around five thousand calls. Cheap, deterministic, and it means an invariant
    is checked against combinations nobody thought to write down.
    """
    combinations = itertools.product(
        Reached,
        DEPARTMENTS,
        DOCUMENT_SETS,
        Ternary,
        DirectDebits,
        Ternary,
        PRIOR_SETS,
    )
    for reached, department, documents, certified, debits, executor_only, priors in combinations:
        observed = make_observations(
            reached=reached,
            department_named=department,
            documents_named=documents,
            certified_copy_accepted=certified,
            direct_debits_action=debits,
            executor_only=executor_only,
        )
        yield GradedCall(
            observed,
            priors,
            capture(ESTATE, INSTITUTION, observed, RUN_ID, priors=priors),
        )


def test_the_sweep_covers_a_serious_number_of_calls() -> None:
    """If this shrinks, the invariants below quietly stopped proving much."""
    assert sum(1 for _ in every_call()) > 1000


def test_every_grade_is_reachable_and_none_is_invented() -> None:
    seen = {call.result.grade for call in every_call()}
    assert seen == set(Grade)


# --------------------------------------------------------------------------
# The commitment boundary
# --------------------------------------------------------------------------


def test_no_grade_means_the_account_is_closed() -> None:
    """There is deliberately no vocabulary in this package for having done
    something. The strongest grade says a requirement was captured."""
    for member in Grade:
        lowered = f"{member.name} {member.value}".lower()
        for word in ACTION_VOCABULARY:
            assert word not in lowered


def test_no_capture_ever_closes_an_account() -> None:
    for call in every_call():
        assert call.result.closes_account is False


def test_no_capture_ever_accepts_terms() -> None:
    for call in every_call():
        assert call.result.accepts_terms is False
        assert call.result.binding is False


def test_no_reason_claims_an_action_was_taken() -> None:
    for call in every_call():
        for reason in call.result.reasons:
            for word in ACTION_VOCABULARY:
                assert word not in reason


# --------------------------------------------------------------------------
# Reasons and evidence
# --------------------------------------------------------------------------


def test_every_capture_carries_at_least_one_reason() -> None:
    """A grade with no named reason is not a capture, it is a bare label."""
    for call in every_call():
        reasons = call.result.reasons
        assert len(reasons) >= 1
        assert all(isinstance(r, str) and r.strip() for r in reasons)


def test_no_capture_repeats_a_reason() -> None:
    for call in every_call():
        assert len(call.result.reasons) == len(set(call.result.reasons))


def test_every_capture_names_the_estate_and_the_institution() -> None:
    for call in every_call():
        assert call.result.estate_id == ESTATE.estate_id
        assert call.result.institution_id == INSTITUTION.institution_id
        assert call.result.run_id == RUN_ID


# --------------------------------------------------------------------------
# Disputes
# --------------------------------------------------------------------------


def test_a_recorded_conflict_always_means_disputed_and_the_reverse() -> None:
    """A contradiction can never be captured as though it were an answer, and
    DISPUTED can never be reported without the two answers behind it."""
    for call in every_call():
        assert (call.result.grade is Grade.DISPUTED) is bool(call.result.conflicts)


def test_every_conflict_keeps_both_sides_and_says_where_each_came_from() -> None:
    for call in every_call():
        for conflict in call.result.conflicts:
            assert conflict.stated.strip()
            assert conflict.counter.strip()
            assert conflict.stated_source == "this_call"
            assert conflict.counter_source.strip()


def test_a_disputed_capture_still_reports_what_was_said() -> None:
    for call in every_call():
        if call.result.grade is Grade.DISPUTED:
            assert call.result.requirement is not None


def test_nothing_disputed_is_ever_reached() -> None:
    """A call that got no further than a phone menu cannot contradict anybody."""
    for call in every_call():
        if call.result.grade is Grade.UNREACHED:
            assert call.result.conflicts == ()


# --------------------------------------------------------------------------
# What each grade may and may not carry
# --------------------------------------------------------------------------


def test_an_unreached_call_never_carries_a_requirement() -> None:
    for call in every_call():
        if call.result.grade is Grade.UNREACHED:
            assert call.result.requirement is None


def test_requirements_captured_implies_a_person_answered_everything() -> None:
    for call in every_call():
        if call.result.grade is Grade.REQUIREMENTS_CAPTURED:
            assert call.observed.reached is Reached.AGENT
            assert call.result.requirement is not None
            assert call.result.requirement.complete
            assert call.result.conflicts == ()


def test_partial_implies_a_person_answered_something_but_not_everything() -> None:
    for call in every_call():
        if call.result.grade is Grade.PARTIAL:
            assert call.observed.reached is Reached.AGENT
            assert call.result.requirement is not None
            assert not call.result.requirement.complete


def test_referred_implies_the_institution_said_so() -> None:
    for call in every_call():
        if call.result.grade is Grade.REFERRED:
            assert call.observed.executor_only is Ternary.YES
            assert call.result.needs_executor is True


def test_only_a_clean_capture_reaches_the_pack_without_a_person() -> None:
    for call in every_call():
        expected = call.result.grade is Grade.REQUIREMENTS_CAPTURED
        assert call.result.goes_in_pack is expected


def test_the_packable_set_holds_exactly_one_grade() -> None:
    assert PACKABLE_GRADES == frozenset({Grade.REQUIREMENTS_CAPTURED})


def test_grading_is_a_pure_function_of_its_inputs() -> None:
    """Same call, same grade. A verdict that drifts cannot be audited."""
    first = [(c.result.grade, c.result.reasons) for c in every_call()]
    second = [(c.result.grade, c.result.reasons) for c in every_call()]
    assert first == second
