"""Proves a canceled, incomplete, or evidence-free call can never become a
confirmation, no matter what structured_result claims. Before this fix,
_to_call_result only checked status == "failed" explicitly -- a canceled
call (a status TERMINAL_STATUSES already treats as terminal) with stray or
partial structured_result data could fall through to the can_come == "yes"
branch and be counted as a real, firm confirmation.
"""

from __future__ import annotations

from mobilize.core.types import CallOutcome
from mobilize.tests.test_planner import make_candidate
from mobilize.transports.calle import _to_call_result


def _call(status="completed", can_come="yes", task_completed=None, transcript_turns=None, evidence="leaving now"):
    return {
        "status": status,
        "task_completed": task_completed,
        "metadata": {"candidate_id": "c0"},
        "recipients": [{
            "phones": ["+15550000000"],
            "status": "completed",
            "structured_result": {"can_come": can_come, "evidence_summary": evidence},
            "attempts": [{"transcript_turns": transcript_turns or []}],
        }],
    }


def _candidate():
    return make_candidate("c0")  # phone defaults set by test_planner's helper


def test_canceled_status_never_becomes_a_confirmation():
    candidate = _candidate()
    call = _call(status="canceled", can_come="yes", transcript_turns=[{"speaker": "user", "text": "leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome != CallOutcome.FIRM_YES
    assert result.outcome != CallOutcome.SOFT_YES
    assert result.commitment_score == 0.0


def test_recipient_level_canceled_status_never_becomes_a_confirmation():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", transcript_turns=[{"speaker": "user", "text": "leaving now"}])
    call["recipients"][0]["status"] = "canceled"
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)


def test_task_completed_false_overrides_a_stated_yes():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=False,
                  transcript_turns=[{"speaker": "user", "text": "leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_task_completed_true_does_not_block_a_real_yes():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  transcript_turns=[{"speaker": "user", "text": "leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)


def test_task_completed_absent_does_not_block_a_real_yes():
    """task_completed missing entirely (None) must not be treated as a
    rejection -- only an explicit False should override can_come."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=None,
                  transcript_turns=[{"speaker": "user", "text": "leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)


def test_yes_with_empty_transcript_is_not_trusted():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", transcript_turns=[])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_yes_with_real_transcript_is_still_honored():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes",
                  transcript_turns=[{"speaker": "bot", "text": "can you help?"},
                                     {"speaker": "user", "text": "yes, leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
