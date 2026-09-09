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
from firstbell.domain import safeguarding_escalation

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
