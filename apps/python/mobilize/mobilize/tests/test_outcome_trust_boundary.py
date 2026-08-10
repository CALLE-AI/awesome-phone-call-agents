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


def test_task_completed_absent_blocks_a_stated_yes():
    """A confirmation requires CALL-E's own explicit task_completed=True --
    task_completed missing entirely (None) is not "no contradiction", it's
    an absence of the one signal a confirmation is required to have."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=None,
                  transcript_turns=[{"speaker": "user", "text": "leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_hedged_recipient_language_does_not_corroborate_a_structured_yes():
    """A denial-word blocklist alone fails open: 'Maybe, I am not sure.'
    contains no denial token, so a denial-only check would let a
    provider-authored can_come='yes' through uncorroborated. Hedge
    language is not an affirmation, firm or soft."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Maybe, I am not sure."},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_recipient_declining_without_denial_words_does_not_corroborate_a_structured_yes():
    """'I will stay home.' contains no denial token either (no 'no',
    'can't', etc.) but is plainly not agreement -- affirmative corroboration
    must be required, not merely the absence of a denial word."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "I will stay home."},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_commitment_score_is_derived_from_recipient_words_not_structured_evidence_summary():
    """Gating the yes/no decision on the transcript while still scoring
    CONFIDENCE off structured_result's evidence_summary would let a
    fabricated/mismatched provider paraphrase inflate a weak, only-just-
    corroborated response into a firm_yes. Here the recipient's actual word
    is a bare, neutral "okay" (passes corroboration, but is not firm
    language), while evidence_summary independently claims strong firm
    language it never said -- if evidence_summary drove the score, this
    would be firm_yes; scored from the real transcript, it must not be."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                 evidence="absolutely, definitely, for sure, leaving right now",
                 transcript_turns=[
                     {"speaker": "bot", "text": "can you come donate right now?"},
                     {"speaker": "user", "text": "okay"},
                 ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome != CallOutcome.FIRM_YES
    # evidence_summary is still carried on the result for human display.
    assert result.evidence == "absolutely, definitely, for sure, leaving right now"


def test_recipient_denial_overrides_a_contradicting_structured_yes():
    """structured_result is a provider-authored extraction and can be
    wrong -- a recipient explicitly declining in the transcript must never
    become a firm_yes just because can_come/evidence_summary claim one."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "No, I cannot come"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_yes_with_empty_transcript_is_not_trusted():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", transcript_turns=[])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_yes_with_real_transcript_is_still_honored():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  transcript_turns=[{"speaker": "bot", "text": "can you help?"},
                                     {"speaker": "user", "text": "yes, leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
