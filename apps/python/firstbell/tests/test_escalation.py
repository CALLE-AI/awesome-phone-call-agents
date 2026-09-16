"""The rule that decides an answer is not ours to close.

`Resolution` says whether a usable answer came back. `Escalation` says whether what it
said is something a person has to see. Before the second axis existed the first was doing
both jobs, and it was doing the second one wrong: a schema-valid answer was closed no
matter what it contained, so the exact case this app is an argument for, a parent learning
from an automated call that a child who left for school never arrived, was the case it
filed automatically.
"""

from __future__ import annotations

import pytest

from dispatch import Escalation, ItemResult, Resolution, WorkItem
from dispatch.models import DispatchReport
from firstbell.domain import answered_by_the_guardian, safeguarding_escalation

ITEM = WorkItem(id="S-1", phones=("+915550000001",), locale="en-IN", region="IN")


def _result(**fields) -> dict:
    base = {"reason_category": "illness", "expected_return": "tomorrow"}
    base.update(fields)
    return base


# ---------------------------------------------------------------------------
# The rule, on its own.
# ---------------------------------------------------------------------------

def test_an_explicit_yes_is_the_only_thing_that_closes_a_record():
    assert safeguarding_escalation(_result(parent_confirmed_aware="yes")) is Escalation.NONE


@pytest.mark.parametrize("value,why", [
    ("no", "the parent said they did not know"),
    ("unknown", "the call could not establish whether they knew"),
    ("", "the field came back empty"),
    ("No", "casing must not decide a safeguarding question"),
    (" no ", "nor must whitespace"),
])
def test_anything_that_is_not_yes_escalates(value, why):
    assert safeguarding_escalation(_result(parent_confirmed_aware=value)) is (
        Escalation.SAFEGUARDING), why


def test_a_missing_field_escalates_rather_than_passing():
    """`parent_confirmed_aware` is not in the schema's `required` list.

    So an answer can satisfy the schema without the field being present at all. A rule
    written as `value == "no"` reads a missing field as reassurance, which is the one
    reading the evidence cannot support: nobody said the child was accounted for.
    """
    assert "parent_confirmed_aware" not in _result()
    assert safeguarding_escalation(_result()) is Escalation.SAFEGUARDING


def test_a_non_string_value_does_not_crash_the_rule():
    """CALL-E returns whatever the model produced, and a boolean is a plausible mistake."""
    assert safeguarding_escalation(_result(parent_confirmed_aware=True)) is (
        Escalation.SAFEGUARDING)
    assert safeguarding_escalation(_result(parent_confirmed_aware=None)) is (
        Escalation.SAFEGUARDING)


# ---------------------------------------------------------------------------
# What the rest of the system does with the answer.
# ---------------------------------------------------------------------------

def _escalated() -> ItemResult:
    return ItemResult(item=ITEM, resolution=Resolution.RESOLVED,
                      structured_result=_result(parent_confirmed_aware="no"),
                      escalation=Escalation.SAFEGUARDING, reason="escalated")


def _closed() -> ItemResult:
    return ItemResult(item=ITEM, resolution=Resolution.RESOLVED,
                      structured_result=_result(parent_confirmed_aware="yes"),
                      reason="closed")


def test_a_resolved_but_escalated_item_still_needs_a_human():
    escalated = _escalated()
    # The half that was already true and was doing all the work.
    assert escalated.resolution.needs_a_human is False
    # The half that was missing.
    assert escalated.needs_a_human is True
    assert _closed().needs_a_human is False


def test_the_queue_puts_an_escalation_above_ordinary_callbacks():
    """Order is output.

    A queue that lists a safeguarding case below eleven ordinary callbacks has reported
    it, and a clerk working top-down reaches it last. That is the same defect as not
    reporting it, arriving later.
    """
    ordinary = ItemResult(item=ITEM, resolution=Resolution.UNDETERMINED, reason="no answer")
    report = DispatchReport(results=[ordinary, ordinary, _escalated(), ordinary])

    queue = report.needs_human
    assert len(queue) == 4
    assert queue[0].escalation is Escalation.SAFEGUARDING
    assert [r.escalation for r in queue[1:]] == [Escalation.NONE] * 3
    assert len(report.escalated) == 1


def test_a_caller_rule_that_raises_fails_closed():
    """The safe reading of "I could not decide whether this is serious" is that it is.

    A rule is supplied by the caller, so it can be wrong in ways this package cannot
    anticipate. Failing open would drop exactly the case the rule was written to catch,
    and it would do it silently, on the run where the rule was broken.
    """
    from dispatch.scheduler import WaveDispatcher
    from firstbell.domain import RESULT_SCHEMA

    def explodes(result):
        raise ValueError("a bug in somebody else's rule")

    dispatcher = WaveDispatcher(
        client=object(), task_builder=lambda item: "task",
        result_schema=RESULT_SCHEMA, escalate=explodes,
    )
    assert dispatcher._escalation_for(_result()) is Escalation.SAFEGUARDING


def test_a_rule_returning_something_that_is_not_an_escalation_is_ignored():
    from dispatch.scheduler import WaveDispatcher
    from firstbell.domain import RESULT_SCHEMA

    dispatcher = WaveDispatcher(
        client=object(), task_builder=lambda item: "task",
        result_schema=RESULT_SCHEMA, escalate=lambda result: "safeguarding",
    )
    # A truthy string is not an Escalation, and treating it as one would put an
    # unvalidated value into the receipt and the queue.
    assert dispatcher._escalation_for(_result()) is Escalation.NONE


def test_the_default_escalates_nothing():
    """Every caller that existed before this change must behave exactly as it did."""
    from dispatch.scheduler import WaveDispatcher
    from firstbell.domain import RESULT_SCHEMA

    dispatcher = WaveDispatcher(
        client=object(), task_builder=lambda item: "task", result_schema=RESULT_SCHEMA,
    )
    assert dispatcher._escalation_for(_result(parent_confirmed_aware="no")) is (
        Escalation.NONE)


# ---------------------------------------------------------------------------
# A status is not an answer. Both of the branches below return before the
# escalation rule is consulted, so a call that connected, talked and then
# dropped was filed on its status alone and the thing the parent said went
# nowhere: no count, no clock, no receipt, and sorted below an ordinary
# callback in the queue a clerk works top-down.
# ---------------------------------------------------------------------------

def _dispatcher():
    from dispatch.scheduler import WaveDispatcher
    from firstbell.domain import RESULT_SCHEMA, safeguarding_escalation

    return WaveDispatcher(
        client=object(), task_builder=lambda item: "task",
        result_schema=RESULT_SCHEMA, escalate=safeguarding_escalation,
    )


ALARMING = {"reason_category": "unknown", "expected_return": "unknown",
            "spoke_with": "child", "parent_confirmed_aware": "no"}


@pytest.mark.parametrize("call,why", [
    ({"id": "call-1", "status": "failed", "failure_code": "call_failed",
      "structured_result": ALARMING},
     "a call that connected, said the serious thing and then dropped"),
    ({"id": "call-2", "status": "canceled", "structured_result": ALARMING},
     "a cancelled call whose recipient had already answered"),
    ({"id": "call-3", "status": "in_progress", "_timed_out": True,
      "structured_result": ALARMING},
     "a call whose result arrived but whose status never went terminal"),
])
def test_a_result_that_says_the_serious_thing_escalates_whatever_the_status(call, why):
    out = _dispatcher()._classify(ITEM, call, placed_id=call["id"])
    assert out.escalation is Escalation.SAFEGUARDING, (
        f"{why} was filed on its status and the rule was never asked")


@pytest.mark.parametrize("status", ["failed", "canceled"])
def test_a_non_completed_call_keeps_the_result_it_carried(status):
    """Without this the only surviving trace is the transcript, which is off by default."""
    out = _dispatcher()._classify(
        ITEM, {"id": "c", "status": status, "structured_result": ALARMING}, placed_id="c")
    assert out.structured_result == ALARMING, (
        "the receipt recorded null and what the child said was lost")


# ---------------------------------------------------------------------------
# A confirmation is necessary and it is not sufficient.
#
# The four results below are real. They were placed on 2026-09-11 against the
# production platform, and two of them are the reason this section exists.
# On both, a parent learned from the call that a child who had left for school
# was not in class, said so, and asked the office to go and look. The
# extraction read the parent's own account of the child's morning as an
# explanation for the absence and returned `parent_confirmed_aware: "yes"`
# with `reason_category` set to `transport` and to `other`.
#
# Every gate this app had agreed with it. The answer was schema-valid, a
# guardian was on the line, and the confirmation field said yes, so
# `safeguarding_escalation` returned NONE and the record closed with no person
# ever seeing it. The rule that exists to catch a missing child filed two of
# them, because it asked whether somebody confirmed being aware and never
# asked what they were aware of.
#
# The results are transcribed here rather than read from the receipts, which
# are held outside this repository on purpose. Nothing in them names a child.
# ---------------------------------------------------------------------------

# S-3103. "Wait, what. Now she is not at home? Actually, she caught the school
# bus at 7:30 this morning. Are you saying she never reached school? Could you
# please check her classroom right now?"
S_3103 = {
    "expected_return": "unknown",
    "free_text_note": (
        "Parent/guardian disputed the absence, saying the student caught the school bus "
        "at 7:30 that morning and asking the school to check the classroom immediately; "
        "staff callback promised today."
    ),
    "parent_confirmed_aware": "yes",
    "reason_category": "transport",
    "spoke_with": "guardian",
}

# S-3104. "Yeah, actually he left the house on his bike with his friends an
# hour ago. Something is wrong. I am driving over to school right now to check
# it out."
S_3104 = {
    "expected_return": "unknown",
    "free_text_note": (
        "Parent confirmed they are a parent and reported the student left the house on "
        "his bike with friends about an hour ago; parent said something is wrong and was "
        "driving to school to check."
    ),
    "parent_confirmed_aware": "yes",
    "reason_category": "other",
    "spoke_with": "guardian",
}

# S-3101 and S-3102, from the same run and the same four calls. These are the
# ordinary mornings, and they are here because a rule that escalates the two
# above by escalating everything has not been shown to read anything.
S_3101 = {
    "expected_return": "longer",
    "free_text_note": (
        "She woke up with a bad cold and slight fever this morning, so they are keeping "
        "her home to rest. Probably back by Monday."
    ),
    "parent_confirmed_aware": "yes",
    "reason_category": "illness",
    "spoke_with": "guardian",
}

S_3102 = {
    "expected_return": "tomorrow",
    "free_text_note": (
        "Parent stated the student was absent due to a dentist checkup scheduled for "
        "10:30 today and will be back in class tomorrow morning."
    ),
    "parent_confirmed_aware": "yes",
    "reason_category": "medical_appointment",
    "spoke_with": "guardian",
}

LIVE_ESCALATING = [("S-3103", S_3103), ("S-3104", S_3104)]
LIVE_CLOSING = [("S-3101", S_3101), ("S-3102", S_3102)]


@pytest.mark.parametrize("pupil,result", LIVE_ESCALATING)
def test_a_reported_missing_child_does_not_close_on_a_confirmation(pupil, result):
    """The case the whole app is an argument for, filed automatically until this ran.

    Both of these arrived with `parent_confirmed_aware: "yes"` from a guardian, which was
    the entire test, so both closed. What the parent actually said was that the child left
    for school and is not accounted for, and the field that records that is
    `expected_return`, which came back `unknown` on both.
    """
    assert result["parent_confirmed_aware"] == "yes", (
        f"{pupil} no longer reproduces the defect: the platform said yes and this fixture "
        "does not")
    assert result["spoke_with"] == "guardian", (
        f"{pupil} no longer reproduces the defect: a guardian was on the line and this "
        "fixture says otherwise, so an older rule would already have caught it")
    assert safeguarding_escalation(result) is Escalation.SAFEGUARDING, (
        f"{pupil} closed with nobody seeing it, and a parent had just asked the office to "
        "go and check a classroom")


@pytest.mark.parametrize("pupil,result", LIVE_CLOSING)
def test_an_ordinary_morning_from_the_same_run_still_closes(pupil, result):
    """The cost of the rule above is a longer human queue, and it has to stay bounded.

    A rule that escalated all four of these calls would pass the test above while telling
    an office nothing, and the office would go back to closing records by hand. An illness
    with a stated return and a dentist appointment with a date are what automation is for.
    """
    assert safeguarding_escalation(result) is Escalation.NONE, (
        f"{pupil} was sent to a safeguarding lead over a cold")


def test_an_unknown_return_escalates_whatever_the_reason_says():
    """No category is benign enough to close a record that cannot say when a child is back.

    Written over the whole enum rather than over a chosen value, because the failure this
    replaces was a rule that happened to be right about the categories somebody thought of.
    """
    from firstbell.domain import RESULT_SCHEMA

    for reason in RESULT_SCHEMA["properties"]["reason_category"]["enum"]:
        result = {"reason_category": reason, "expected_return": "unknown",
                  "parent_confirmed_aware": "yes", "spoke_with": "guardian"}
        assert safeguarding_escalation(result) is Escalation.SAFEGUARDING, (
            f"a confirmed `{reason}` absence with no return date closed itself")


@pytest.mark.parametrize("reason", ["transport", "other", "unknown"])
def test_an_unexplained_absence_needs_a_date_and_not_just_a_direction(reason):
    """`longer` is a direction of travel. It is not a date an office can diary.

    These three categories are the ones that carry no account of where a child is.
    `transport` is what the platform returned for a parent describing a school bus their
    child boarded, `other` is what it returned for a parent describing a bike ride, and
    `unknown` is the model declining to guess. Paired with a return nobody could name,
    none of the three is a closeable record.
    """
    result = {"reason_category": reason, "expected_return": "longer",
              "parent_confirmed_aware": "yes", "spoke_with": "guardian"}
    assert safeguarding_escalation(result) is Escalation.SAFEGUARDING


def test_an_explained_absence_may_run_longer_than_a_week_and_still_close():
    """The asymmetry is the rule.

    `illness` with `longer` is a child in bed for a fortnight, and S-3101 is that call.
    Treating an indefinite return as serious regardless of reason would escalate every long
    illness in a district, which is the reading that makes the queue useless.
    """
    assert safeguarding_escalation(dict(S_3101, expected_return="longer")) is Escalation.NONE


@pytest.mark.parametrize("back", ["today", "tomorrow", "later_this_week"])
def test_a_transport_absence_with_a_named_day_still_closes(back):
    """A bus that broke down is a transport absence and it is not a missing child.

    This is the test that stops the fix becoming "escalate anything the model called
    transport", which would be a keyword rule wearing a safeguarding label.
    """
    result = {"reason_category": "transport", "expected_return": back,
              "parent_confirmed_aware": "yes", "spoke_with": "guardian"}
    assert safeguarding_escalation(result) is Escalation.NONE


def test_a_missing_return_field_escalates_rather_than_passing():
    """`expected_return` is required by the schema, and this rule is handed partial dicts.

    `tools/replay_escalation.py` re-files historic receipts, and a receipt written by an
    older version of this app can be missing a field today's schema requires. An absent
    return date is not a stated one.
    """
    result = {"reason_category": "illness", "parent_confirmed_aware": "yes",
              "spoke_with": "guardian"}
    assert "expected_return" not in result
    assert safeguarding_escalation(result) is Escalation.SAFEGUARDING


@pytest.mark.parametrize("value", [None, True, 0, [], {"day": "monday"}])
def test_a_non_string_return_does_not_crash_the_rule(value):
    """The platform returns whatever the model produced, and the rule fails closed."""
    result = {"reason_category": "illness", "expected_return": value,
              "parent_confirmed_aware": "yes", "spoke_with": "guardian"}
    assert safeguarding_escalation(result) is Escalation.SAFEGUARDING


def test_a_value_outside_the_enum_escalates():
    """A schema-valid answer cannot contain this, and a re-filed historic one can.

    `next_week` is not one of the five the schema allows. Reading an unrecognised value as
    a return date would let a future platform change close records by inventing a word.
    """
    result = {"reason_category": "illness", "expected_return": "next_week",
              "parent_confirmed_aware": "yes", "spoke_with": "guardian"}
    assert safeguarding_escalation(result) is Escalation.SAFEGUARDING


def test_closing_a_record_requires_more_than_the_confirmation_field():
    """A necessary condition, checked over every result the schema allows.

    Deliberately not a table of expected outcomes, which would be a second copy of the rule
    and would go stale the way the README count did. It asserts only what must always hold:
    nothing closes without an explicit confirmation, nothing closes without a return date,
    and nothing closes on an answer a call recorded as coming from somebody other than the
    guardian. `spoke_with: "unknown"` is deliberately not folded into that last one: the run
    counts how many records closed with nobody recorded, and reading absent as "not a
    guardian" would invent a fact about a call. It also asserts
    that the rule is not equivalent to reading the confirmation field alone, which is the
    exact shape of the defect it replaces.
    """
    import itertools

    from firstbell.domain import RESULT_SCHEMA

    properties = RESULT_SCHEMA["properties"]
    closed = 0
    escalated_on_a_yes = 0
    for reason, back, confirmed, who in itertools.product(
            properties["reason_category"]["enum"],
            properties["expected_return"]["enum"],
            properties["parent_confirmed_aware"]["enum"],
            properties["spoke_with"]["enum"]):
        result = {"reason_category": reason, "expected_return": back,
                  "parent_confirmed_aware": confirmed, "spoke_with": who}
        if safeguarding_escalation(result) is not Escalation.NONE:
            escalated_on_a_yes += confirmed == "yes"
            continue
        assert confirmed == "yes", f"{result} closed without a confirmation"
        assert back != "unknown", f"{result} closed with no return date"
        assert answered_by_the_guardian(result) is not False, (
            f"{result} closed on an answer from a {who}")
        closed += 1

    assert closed, "nothing in the schema can be closed automatically any more"
    assert escalated_on_a_yes, (
        "every confirmed answer closes, so the rule is still reading one field")


# ---------------------------------------------------------------------------
# The sentence beside the count.
#
# The office queue printed one fixed reason over every escalated row: that the
# parent had not confirmed. It was the only way a row could escalate until the
# rule was widened, and afterwards it was false of exactly the rows the
# widening was for. A clerk reads the sentence and not the enum, and a queue
# that says the parent did not confirm when the parent did sends them into the
# call with the wrong first question.
# ---------------------------------------------------------------------------

def test_a_closed_record_has_no_reason_to_print():
    from firstbell.domain import why_escalated

    assert why_escalated(S_3101) == ""
    assert why_escalated(S_3102) == ""


@pytest.mark.parametrize("result,expected", [
    ({"reason_category": "illness", "expected_return": "tomorrow",
      "parent_confirmed_aware": "no", "spoke_with": "guardian"},
     "did not confirm"),
    ({"reason_category": "illness", "expected_return": "unknown",
      "parent_confirmed_aware": "yes", "spoke_with": "guardian"},
     "never established when the child is coming back"),
    ({"reason_category": "transport", "expected_return": "longer",
      "parent_confirmed_aware": "yes", "spoke_with": "guardian"},
     "neither the reason given nor the return date"),
    ({"reason_category": "illness", "expected_return": "tomorrow",
      "parent_confirmed_aware": "yes", "spoke_with": "child"},
     "came from a child"),
])
def test_the_reason_names_the_branch_that_was_actually_taken(result, expected):
    from firstbell.domain import why_escalated

    assert expected in why_escalated(result), (
        f"{result} escalates, and the reason printed beside it is "
        f"{why_escalated(result)!r}")


@pytest.mark.parametrize("pupil,result", LIVE_ESCALATING)
def test_the_live_calls_are_not_described_as_a_parent_who_did_not_confirm(pupil, result):
    """The exact false sentence, on the exact rows it was false about.

    On both of these the platform returned `parent_confirmed_aware: "yes"`. A queue row
    saying the parent did not confirm is not a rounding error in the prose: it is the one
    fact about the call that a clerk would act on, stated backwards.
    """
    from firstbell.domain import why_escalated

    said = why_escalated(result)
    assert said, f"{pupil} escalates and the queue would print no reason at all"
    assert "did not confirm" not in said, (
        f"{pupil} came back with the parent confirming, and the queue says {said!r}")
    assert "coming back" in said, (
        f"{pupil} escalates because no return date was established, and the reason given "
        f"is {said!r}")


def test_every_escalating_result_the_schema_allows_carries_a_reason():
    """No escalated row may reach a clerk with an empty explanation.

    Written over the whole product rather than over chosen values, because a branch added
    to the rule without a matching sentence here would otherwise ship a blank line in the
    one place on the page that is a work instruction.
    """
    import itertools

    from firstbell.domain import RESULT_SCHEMA, why_escalated

    properties = RESULT_SCHEMA["properties"]
    seen = set()
    for reason, back, confirmed, who in itertools.product(
            properties["reason_category"]["enum"],
            properties["expected_return"]["enum"],
            properties["parent_confirmed_aware"]["enum"],
            properties["spoke_with"]["enum"]):
        result = {"reason_category": reason, "expected_return": back,
                  "parent_confirmed_aware": confirmed, "spoke_with": who}
        said = why_escalated(result)
        if safeguarding_escalation(result) is Escalation.NONE:
            assert said == "", f"{result} closes and still carries the reason {said!r}"
            continue
        assert said and said.endswith("."), (
            f"{result} escalates with no reason a clerk can read: {said!r}")
        seen.add(said)

    assert len(seen) >= 4, (
        f"only {len(seen)} distinct reasons across the whole schema, so the queue is back "
        "to printing one sentence over rows that escalate for different causes")
