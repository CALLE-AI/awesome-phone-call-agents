"""Who was on the line, and what the run may close on their answer.

A call reaches the number a school has on record for a child. That does not mean a
guardian picked it up. A brother, a lodger, a neighbour minding the house, or the child
themselves can answer, and until this existed the instruction named the pupil and said the
pupil was absent before anybody had said who they were. The fact that a child is absent is
itself the disclosure, so the order the sentences are spoken in is the whole control.
"""
from __future__ import annotations

import pytest

from dispatch import Escalation, ItemResult, Resolution, WorkItem
from firstbell.domain import (
    RESULT_SCHEMA,
    answered_by_the_guardian,
    safeguarding_escalation,
    summarise,
    build_task,
)


def closed(**result):
    return ItemResult(item=WorkItem(id="S-1", phones=("+15550100001",)),
                      resolution=Resolution.RESOLVED, structured_result=dict(result),
                      escalation=Escalation.NONE, attempts_made=1)


# --- three values, not two -----------------------------------------------------------


def test_a_guardian_is_a_guardian():
    assert answered_by_the_guardian({"spoke_with": "guardian"}) is True


@pytest.mark.parametrize("who", ["other_adult", "child", "voicemail"])
def test_anybody_else_is_not(who):
    assert answered_by_the_guardian({"spoke_with": who}) is False


def test_a_missing_field_is_none_and_not_false():
    """None is not False, and the difference is a claim about a call.

    Reading absent as "not a guardian" would invent a fact while trying to be careful,
    which is worse than the carelessness. The run counts it instead.
    """
    assert answered_by_the_guardian({}) is None


def test_an_explicit_unknown_is_also_none():
    assert answered_by_the_guardian({"spoke_with": "unknown"}) is None


def test_the_value_is_read_case_and_space_insensitively():
    assert answered_by_the_guardian({"spoke_with": "  Guardian "}) is True


def test_the_field_is_in_the_schema_and_is_not_required():
    """Required would make every call CALL-E does not fill schema-invalid, which is a
    worse failure than the one this catches."""
    assert "spoke_with" in RESULT_SCHEMA["properties"]
    assert "spoke_with" not in RESULT_SCHEMA["required"]
    assert set(RESULT_SCHEMA["properties"]["spoke_with"]["enum"]) == {
        "guardian", "other_adult", "child", "voicemail", "unknown"}


# --- what closes and what does not ---------------------------------------------------
#
# Every case below starts from a record that closes, and changes one field.
#
# That is not tidiness. These tests were once written as the two fields they are about and
# nothing else, and when `safeguarding_escalation` grew a third condition in September 2026
# a bare `{"parent_confirmed_aware": "yes", "spoke_with": "child"}` started escalating for
# a reason that has nothing to do with who answered: it carries no `expected_return`. Every
# assertion in this block would have gone on passing with the guardian rule deleted from
# the module. A test that cannot fail when the thing it names is removed is not testing it.


def _closeable(**fields) -> dict:
    """A record the live rule closes. Change one field and it should stop closing."""
    base = {"reason_category": "illness", "expected_return": "tomorrow",
            "parent_confirmed_aware": "yes", "spoke_with": "guardian"}
    base.update(fields)
    return base


def test_the_base_case_this_block_varies_actually_closes():
    """The guard on every assertion below. If this fails they are all measuring nothing."""
    assert safeguarding_escalation(_closeable()) is Escalation.NONE


def test_a_confirmation_from_a_guardian_closes_the_record():
    assert safeguarding_escalation(_closeable(spoke_with="guardian")) is Escalation.NONE


def test_a_confirmation_from_a_sibling_does_not_close_the_record():
    """"Yeah she's sick" from a brother is not a guardian accounting for a child."""
    assert safeguarding_escalation(_closeable(spoke_with="child")) is Escalation.SAFEGUARDING


def test_a_confirmation_from_another_adult_does_not_close_the_record():
    assert safeguarding_escalation(
        _closeable(spoke_with="other_adult")) is Escalation.SAFEGUARDING


def test_an_answering_machine_does_not_close_the_record():
    assert safeguarding_escalation(
        _closeable(spoke_with="voicemail")) is Escalation.SAFEGUARDING


def test_who_answered_is_checked_before_what_they_said():
    """A record answered by a child is held whatever the awareness field says."""
    for aware in ("yes", "no", "unknown"):
        assert safeguarding_escalation(
            _closeable(parent_confirmed_aware=aware, spoke_with="child")
        ) is Escalation.SAFEGUARDING


def test_a_call_that_did_not_say_who_answered_is_not_read_as_a_refusal():
    """`None` is not `False`, and this is the assertion that holds the difference.

    A call that never recorded who spoke is counted and printed rather than escalated on
    that basis alone, because folding "nobody wrote it down" into "not a guardian" would
    invent a fact about a call. So a record with the field absent, and one with it set to
    `unknown`, both close on the strength of the rest of the answer.
    """
    without = _closeable()
    without.pop("spoke_with")
    assert safeguarding_escalation(without) is Escalation.NONE
    assert safeguarding_escalation(_closeable(spoke_with="unknown")) is Escalation.NONE
    # And the confirmation is still doing its own job in both shapes.
    without["parent_confirmed_aware"] = "no"
    assert safeguarding_escalation(without) is Escalation.SAFEGUARDING
    assert safeguarding_escalation(
        _closeable(spoke_with="unknown", parent_confirmed_aware="no")
    ) is Escalation.SAFEGUARDING


# --- the run says what it closed on --------------------------------------------------


def test_a_closure_with_a_guardian_on_the_line_is_counted_as_one():
    summary = summarise([closed(parent_confirmed_aware="yes", spoke_with="guardian")],
                        calls_placed=1)
    assert summary.closed_with_a_guardian == 1
    assert summary.closed_with_no_answerer_recorded == 0


def test_a_closure_with_nobody_recorded_is_counted_separately():
    summary = summarise([closed(parent_confirmed_aware="yes")], calls_placed=1)
    assert summary.closed_with_no_answerer_recorded == 1
    assert summary.closed_with_a_guardian == 0


def test_the_two_counts_are_not_added_together_anywhere():
    """The exposure is the second one, so it has to survive as its own number."""
    summary = summarise([closed(parent_confirmed_aware="yes", spoke_with="guardian"),
                         closed(parent_confirmed_aware="yes")], calls_placed=2)
    assert (summary.closed_with_a_guardian,
            summary.closed_with_no_answerer_recorded) == (1, 1)


def test_a_record_that_did_not_close_is_in_neither_count():
    escalated = ItemResult(
        item=WorkItem(id="S-2", phones=("+15550100001",)),
        resolution=Resolution.RESOLVED, escalation=Escalation.SAFEGUARDING,
        structured_result={"parent_confirmed_aware": "no"}, attempts_made=1)
    summary = summarise([escalated], calls_placed=1)
    assert summary.closed_with_a_guardian == 0
    assert summary.closed_with_no_answerer_recorded == 0


def test_the_run_prints_the_exposure_rather_than_folding_it_in():
    summary = summarise([closed(parent_confirmed_aware="yes")], calls_placed=1)
    printed = "\n".join(summary.lines())
    assert "not recorded" in printed
    assert "Not a claim that a child answered" in printed


# --- the instruction ------------------------------------------------------------------


def test_the_instruction_asks_who_is_there_before_it_names_a_pupil():
    """The order of the sentences is the control, so the order is what is asserted."""
    text = build_task(WorkItem(id="S-1", phones=("+15550100001",),
                              context={"student_name": "Anitha",
                                       "school_name": "Oakridge"}))
    asked = text.find("parent or guardian")
    named = text.find("Anitha")
    assert asked > 0 and named > 0, "the instruction no longer asks or no longer names"
    assert asked < named, (
        "the instruction names the pupil before it establishes who answered, which "
        "discloses a pupil's absence to whoever picked up the telephone"
    )


def test_the_instruction_says_not_to_disclose_the_absence_first():
    text = build_task(WorkItem(id="S-1", phones=("+15550100001",)))
    assert "do not say that anybody is absent" in text.lower()


def test_the_instruction_says_what_to_do_when_a_child_answers():
    text = build_task(WorkItem(id="S-1", phones=("+15550100001",))).lower()
    assert "if a child answers" in text
    assert "call back" in text


def test_the_disclosure_is_still_the_first_thing_spoken():
    """Verifying the answerer must not push the automated-caller disclosure down."""
    from firstbell.domain import AI_DISCLOSURE

    assert build_task(WorkItem(id="S-1", phones=("+15550100001",))).startswith(
        AI_DISCLOSURE)


# --- the word over the number ---------------------------------------------------------


def test_the_attempt_count_is_never_printed_under_the_word_calls():
    """The one defect a reader met without looking for it.

    `calls_placed` sums `attempts_made`, and it printed as "calls placed 8" six lines
    under "attempted 6" on a run that dialled six rows. Nothing could catch it: the
    arithmetic was right because the break-even divides attempts by attempts, and the gate
    on the printed block asserts the README matches the program, so a wrong word is copied
    into the README and then defended there.

    So the assertion is about the word, not the number. A count that means attempts may
    not appear under a heading that says calls.
    """
    from dispatch import ItemResult, Resolution, WorkItem
    from firstbell.domain import summarise

    # One row, two guardian numbers, the first of which did not answer. Two attempts, one
    # call, and the pair of numbers this line has to keep apart.
    two_tries = ItemResult(
        item=WorkItem(id="S-1", phones=("+15550100001", "+15550100002")),
        resolution=Resolution.RESOLVED, escalation=Escalation.NONE,
        structured_result={"parent_confirmed_aware": "yes", "spoke_with": "guardian"},
        attempts_made=2, placed_by_this_run=True)
    summary = summarise([two_tries])
    printed = "\n".join(summary.lines())

    assert summary.calls_placed == 2, "calls_placed no longer holds the attempt count"
    assert summary.calls_dialled == 1, "calls_dialled no longer holds the row count"

    import re

    under_calls = re.search(r"^\s+calls placed\s+(\d+)", printed, re.M)
    assert under_calls is None or int(under_calls.group(1)) == summary.calls_dialled, (
        f"the run prints {under_calls.group(1)} under the words 'calls placed' and "
        f"dialled {summary.calls_dialled} call(s)"
    )
    attempts = re.search(r"^\s+attempts placed\s+(\d+)", printed, re.M)
    assert attempts and int(attempts.group(1)) == summary.calls_placed, (
        "the attempt count is not printed under a heading that says attempts"
    )
    assert f"on {summary.calls_dialled} call(s)" in printed, (
        "the run states an attempt count without saying how many calls it is spread over, "
        "which is the pair of numbers a district billed per call has to tell apart"
    )


def test_a_row_dialled_with_no_attempt_is_not_a_call():
    from dispatch import ItemResult, Resolution, WorkItem
    from firstbell.domain import summarise

    nothing = ItemResult(item=WorkItem(id="S-1", phones=("+15550100001",)),
                         resolution=Resolution.SKIPPED, attempts_made=0,
                         placed_by_this_run=True)
    assert summarise([nothing]).calls_dialled == 0
