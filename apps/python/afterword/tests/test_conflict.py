"""Detecting a contradiction, and refusing to settle it.

The two shapes that matter are in the design note: a stated requirement against
the institution's own recorded policy, and a stated requirement against what a
different adviser at the same institution said last week. Both sides survive
into the result, because picking one in code is how a family posts an original
death certificate that then goes missing.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import date

import pytest

from afterword.conflict import (
    against_policy,
    against_prior_calls,
    compare,
    detect,
    document_set,
    normalise,
)
from afterword.models import (
    Conflict,
    DirectDebits,
    PriorCall,
    RecordedPolicy,
    Requirement,
    Ternary,
)
from tests.builders import POLICY, PRIOR, make_institution, make_observations

STATED = make_observations().as_requirement()


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------


def test_normalisation_folds_case_punctuation_and_accents() -> None:
    assert normalise("Bereavement Team") == normalise("bereavement team.")
    assert normalise(" Estates  Department ") == "estatesdepartment"


def test_a_department_written_differently_is_not_a_dispute() -> None:
    """Reporting "Bereavement Team" against "bereavement team" as a conflict
    would bury the real ones."""
    counter = Requirement(department="bereavement team,")
    assert compare(Requirement(department="Bereavement Team"), counter, "x") == ()


def test_documents_are_compared_as_a_set_not_a_sequence() -> None:
    same = Requirement(
        documents_needed=("grant of probate", "certified copy of the death certificate")
    )
    assert compare(STATED, same, "x") == ()
    assert document_set(("A", "a", " ")) == {"a"}


# --------------------------------------------------------------------------
# What counts as a contradiction
# --------------------------------------------------------------------------


def test_a_field_only_one_side_answered_is_never_a_conflict() -> None:
    """An unanswered question is a gap. `capture.py` calls that PARTIAL, and it
    is a different problem from two answers."""
    silent = Requirement()
    assert compare(STATED, silent, "x") == ()
    assert compare(silent, POLICY.as_requirement(), "x") == ()


@pytest.mark.parametrize(
    "override, field_name",
    [
        ({"department": "Estates Department"}, "department"),
        ({"documents_needed": ("original death certificate",)}, "documents_needed"),
        ({"certified_copy_accepted": Ternary.NO}, "certified_copy_accepted"),
        ({"direct_debits_action": DirectDebits.CONTINUE}, "direct_debits_action"),
    ],
)
def test_each_comparable_field_can_raise_a_conflict(
    override: dict, field_name: str
) -> None:
    stated = Requirement(
        department=STATED.department,
        documents_needed=STATED.documents_needed,
        certified_copy_accepted=STATED.certified_copy_accepted,
        direct_debits_action=STATED.direct_debits_action,
    )
    stated = Requirement(**{**stated.__dict__, **override})
    found = compare(stated, POLICY.as_requirement(), "recorded_policy:guide")
    assert [c.field_name for c in found] == [field_name]


def test_a_document_the_call_added_is_a_conflict_in_both_directions() -> None:
    """Under-sending and over-sending are both dangerous, so set inequality is
    the test, not one-way containment."""
    extra = Requirement(
        documents_needed=STATED.documents_needed + ("marriage certificate",)
    )
    assert [c.field_name for c in compare(extra, STATED, "x")] == ["documents_needed"]
    assert [c.field_name for c in compare(STATED, extra, "x")] == ["documents_needed"]


# --------------------------------------------------------------------------
# Both sides, no winner
# --------------------------------------------------------------------------


def test_a_conflict_records_both_answers_and_where_each_came_from() -> None:
    found = against_policy(
        make_observations(certified_copy_accepted=Ternary.NO).as_requirement(),
        make_institution(),
        quote="It has to be the original.",
    )
    assert len(found) == 1
    conflict = found[0]
    assert conflict.stated == "no"
    assert conflict.stated_source == "this_call"
    assert conflict.counter == "yes"
    assert conflict.counter_source == f"recorded_policy:{POLICY.source}"
    assert conflict.quote == "It has to be the original."
    assert conflict.reason == "conflict_certified_copy_accepted"


def test_a_conflict_has_no_way_to_express_a_winner() -> None:
    """The absence is the design. A resolution field would be filled in."""
    names = {f.name for f in fields(Conflict)}
    assert names == {
        "field_name",
        "stated",
        "stated_source",
        "counter",
        "counter_source",
        "quote",
    }
    for forbidden in ("winner", "resolution", "preferred", "correct", "authoritative"):
        assert forbidden not in names


def test_the_counter_source_names_the_call_and_the_day_it_was_made() -> None:
    """A dispute is only answerable if the family can say when they were told."""
    found = against_prior_calls(STATED, (PRIOR,))
    assert found
    for conflict in found:
        assert PRIOR.call_id in conflict.counter_source
        assert PRIOR.captured_on.isoformat() in conflict.counter_source


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------


def test_an_institution_that_publishes_nothing_yields_no_policy_conflict() -> None:
    assert against_policy(STATED, make_institution(policy=None)) == ()


def test_every_earlier_call_is_compared_not_only_the_latest() -> None:
    """The useful fact is that the institution has answered inconsistently at
    all, so an older call is not superseded by a newer one."""
    older = PriorCall(
        call_id="call-0000",
        captured_on=date(2026, 8, 1),
        requirement=Requirement(direct_debits_action=DirectDebits.CONTINUE),
    )
    found = against_prior_calls(STATED, (older, PRIOR))
    sources = {c.counter_source.split(":")[1] for c in found}
    assert sources == {"call-0000", "call-0001"}


def test_detect_reports_the_policy_side_before_the_prior_calls() -> None:
    found = detect(
        make_observations(certified_copy_accepted=Ternary.NO).as_requirement(),
        make_institution(),
        (PRIOR,),
    )
    assert found[0].counter_source.startswith("recorded_policy:")
    assert any(c.counter_source.startswith("prior_call:") for c in found)


def test_a_policy_silent_on_a_field_contradicts_nothing() -> None:
    silent = RecordedPolicy(
        department="",
        documents_needed=(),
        certified_copy_accepted=Ternary.UNKNOWN,
        direct_debits_action=DirectDebits.UNKNOWN,
        source="a page that says very little",
    )
    assert against_policy(STATED, make_institution(policy=silent)) == ()


def test_agreement_produces_nothing_at_all() -> None:
    assert detect(STATED, make_institution(), ()) == ()
