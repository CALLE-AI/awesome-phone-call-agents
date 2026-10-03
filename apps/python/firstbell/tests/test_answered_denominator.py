"""What "answered" is allowed to mean, in all three places that define it.

`answered` is the denominator of `net_new_escalation_rate`, the gate on
`escalation_cost_per_call_lead_minute`, the denominator of `escalation_break_even_rate`, the
`trials` argument to the Clopper-Pearson bound, and the published `answered` figure. It was
`resolved + undetermined`, and `UNDETERMINED` has eight producers of which only three mean
somebody picked up. The other five are a call that never reached a terminal status, a poll
that could not be read back, a create whose 200 carried no id, a create that ran out of
attempts unanswered, and a response the classifier could not read. One of those placed no
call at all.

Counting them understates every rate built on this, and understating the safeguarding load
under-staffs a rota. It also hands `upper_bound(events, trials)` an inflated `trials`, which
returns a tighter interval than the sample earns, so the tool claims more confidence than it
has. `NEVER_CARRIED` already exists so that "the platform refused it" is not filed as
"nobody was reached"; this is the same distinction on the other side of the same word.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "tools"))

from dispatch import Escalation, ItemResult, Resolution, WorkItem  # noqa: E402
from dispatch.scheduler import WaveDispatcher  # noqa: E402
from firstbell.domain import RESULT_SCHEMA, StaffCost, summarise  # noqa: E402

VALID = {"reason_category": "illness", "expected_return": "tomorrow"}


def _dispatcher() -> WaveDispatcher:
    return WaveDispatcher(client=object(), task_builder=lambda item: "task",
                          result_schema=RESULT_SCHEMA)


def _classify(call: dict) -> ItemResult:
    return _dispatcher()._classify(WorkItem(id="S-1", phones=("+915550000001",)),
                                   call, placed_id="c")


# The three that mean a conversation happened, straight off the classifier rather than
# asserted by hand, so the test cannot drift from what the dispatcher actually sets.
@pytest.mark.parametrize("call,why", [
    ({"id": "c", "status": "completed"}, "completed, and returned no structured result"),
    ({"id": "c", "status": "completed",
      "structured_result": {"reason_category": "not_an_enum_value",
                            "expected_return": "tomorrow"}},
     "completed, and the answer failed the schema"),
    ({"id": "c", "status": "completed",
      "structured_result": {"reason_category": "unknown", "expected_return": "unknown"}},
     "completed, and every required field came back unknown"),
])
def test_a_conversation_that_produced_nothing_usable_still_counts_as_answered(call, why):
    out = _classify(call)
    assert out.resolution is Resolution.UNDETERMINED
    assert out.spoke_to_someone is True, f"{why}: somebody picked up"


@pytest.mark.parametrize("call,why", [
    ({"id": "c", "status": "in_progress", "_timed_out": True},
     "never reached a terminal status, so nothing is known about the handset"),
    ({"id": "c", "status": "failed", "failure_code": "no_answer"},
     "the platform reported the call failed"),
    ({"id": "c", "status": "canceled"}, "the call was cancelled"),
])
def test_a_call_nobody_is_known_to_have_answered_is_not_counted_as_answered(call, why):
    assert _classify(call).spoke_to_someone is False, why


def _row(name, resolution, spoke, escalation=Escalation.NONE) -> ItemResult:
    return ItemResult(item=WorkItem(id=name, phones=("+915550000001",)),
                      resolution=resolution, escalation=escalation, attempts_made=1,
                      placed_by_this_run=True, spoke_to_someone=spoke)


def test_unreadable_outcomes_do_not_dilute_the_escalation_rate():
    """The reported effect: one escalation among one answered call is not a 20% rate."""
    escalated = _row("alarm", Resolution.RESOLVED, True, Escalation.SAFEGUARDING)
    unreadable = [_row(f"lost-{n}", Resolution.UNDETERMINED, False) for n in range(4)]

    alone = summarise([escalated], live=True, staff=StaffCost.us_school_office(),
                      escalation_staff=StaffCost.us_school_safeguarding_lead())
    with_noise = summarise([escalated] + unreadable, live=True,
                           staff=StaffCost.us_school_office(),
                           escalation_staff=StaffCost.us_school_safeguarding_lead())

    assert alone.answered == 1
    assert with_noise.answered == 1, (
        "four calls nobody answered were added to the denominator of the safeguarding rate")
    assert with_noise.net_new_escalation_rate == alone.net_new_escalation_rate == 1.0


def test_the_receipt_carries_the_fact_so_a_reader_can_recompute_it():
    """Anything reading a receipt has to be able to reach the same number."""
    from money_across_runs import _counts_from_items

    items = [
        {"id": "a", "resolution": "resolved", "attempts": 1, "spoke_to_someone": True},
        {"id": "b", "resolution": "undetermined", "attempts": 1, "spoke_to_someone": True},
        {"id": "c", "resolution": "undetermined", "attempts": 1, "spoke_to_someone": False},
    ]
    counts = _counts_from_items(items)
    answered = counts[2] if isinstance(counts, tuple) else counts["answered"]
    assert answered == 2, "the row nobody answered was counted as answered"


def test_a_receipt_written_before_the_field_existed_reports_what_it_always_did():
    """An old receipt must not silently restate its own history."""
    from money_across_runs import _counts_from_items

    items = [{"id": "a", "resolution": "undetermined", "attempts": 1}]
    counts = _counts_from_items(items)
    answered = counts[2] if isinstance(counts, tuple) else counts["answered"]
    assert answered == 1, (
        "a receipt with no such key was measured under the old rule and keeps it")


def test_the_receipt_records_the_id_this_run_placed_not_the_one_the_body_returned():
    """A mismatched poll body put an id on the receipt that this run never placed.

    `placed_id` was added so "once a call is placed the id does not get lost", and the fix
    reached only the case where the body carries no id. A body carrying a different id still
    won. The in-flight bookkeeping uses the placed id and the receipt used the body's, so
    the two never disagreed out loud, and a clerk ringing the family back reads the receipt.
    """
    out = _dispatcher()._classify(
        WorkItem(id="S-1", phones=("+915550000001",)),
        {"id": "call-SOMEONE-ELSES", "status": "completed", "structured_result": VALID},
        placed_id="call-PLACED")
    assert out.call_id == "call-PLACED"


def test_a_body_with_no_id_still_falls_back_to_the_body():
    """The case the earlier fix was written for has to keep working."""
    out = _dispatcher()._classify(
        WorkItem(id="S-1", phones=("+915550000001",)),
        {"id": "call-FROM-BODY", "status": "completed", "structured_result": VALID},
        placed_id=None)
    assert out.call_id == "call-FROM-BODY"
