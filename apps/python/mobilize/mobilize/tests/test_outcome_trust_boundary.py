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


def _call(status="completed", can_come="yes", task_completed=None, transcript_turns=None,
          evidence="leaving now", final_position="confirmed"):
    structured_result = {"can_come": can_come, "evidence_summary": evidence}
    # final_position is allowed to be omitted entirely (pass None) to
    # simulate a non-compliant/older response missing the field, which
    # must fail closed the same way an explicit "unclear" does.
    if final_position is not None:
        structured_result["final_position"] = final_position
    return {
        "status": status,
        "task_completed": task_completed,
        "metadata": {"candidate_id": "c0"},
        "recipients": [{
            "phones": ["+15550000000"],
            "status": "completed",
            "structured_result": structured_result,
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
    """'I will stay home.' is plainly not agreement even though it doesn't
    contain a generic denial token like 'no' or 'can't' -- corroboration
    requires affirmative language, not merely the absence of a denial."""
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


def test_a_later_retraction_overrides_an_earlier_stated_yes():
    """A single whole-transcript blob has no notion of order -- concatenating
    every recipient turn and searching it lets an EARLIER "yes" survive a
    LATER retraction in the same call. The recipient's LATEST position must
    win, exactly as it would for a human listening to the whole call."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I am definitely coming"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "Actually I need to stay home"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_negation_immediately_before_an_affirmative_phrase_is_not_corroboration():
    """"Not right now" must not match on the "right now" fragment of the
    affirmation regex with no awareness the phrase was negated."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Not right now"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_unlisted_negated_affirmation_phrase_fails_closed():
    """A denial-phrase list can only ever catch wordings someone
    anticipated -- "I don't think I can make it" embeds the exact
    affirmation phrase "i can make it" inside a negation the old list
    never enumerated. Must fail closed on the negation, not on whether
    this specific phrasing happens to be listed."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I am definitely coming"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "Actually, I don't think I can make it"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_explicit_retraction_without_a_negation_word_fails_closed():
    """"Scratch that, something came up" withdraws the earlier "yes" but
    contains no negation word at all ("no"/"not"/"can't"/etc.) -- a
    negation-scope check alone can't catch it. A retraction is a distinct
    category from a negation and must be recognized on its own."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I am definitely coming"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "Actually, scratch that, something came up"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_forget_i_said_that_retraction_fails_closed():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I'll be there"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "Wait, forget I said that"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_curly_apostrophe_negation_is_not_a_bypass():
    """A curly/typographic apostrophe (U+2019) in "don't" -- entirely
    plausible output from a real transcription service -- must not defeat
    the `'?` in every negation/retraction pattern at once. This is a
    Unicode normalization gap, not a missing word."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I am definitely coming"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "Actually, I don’t think I can make it"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_withdraw_that_commitment_retraction_fails_closed():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I am definitely coming"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "I withdraw that commitment"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_plans_have_changed_retraction_fails_closed():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now",
                  transcript_turns=[
                      {"speaker": "bot", "text": "can you come donate right now?"},
                      {"speaker": "user", "text": "Yes, I am definitely coming"},
                      {"speaker": "bot", "text": "great, see you soon"},
                      {"speaker": "user", "text": "Plans have changed"},
                  ])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_final_position_declined_overrides_a_retraction_no_pattern_list_would_catch():
    """"I have to cancel," "Count me out," "I rescind my commitment," and
    "That agreement is off" are all real retraction phrasings a hand-
    written pattern list failed to recognize (each still resolved to
    affirm under the old transcript-only mechanism -- verified directly
    against _recipient_effective_position before this fix). Recognizing
    an open-ended retraction in arbitrary wording is a semantic judgment
    delegated to CALL-E's own final_position extraction instead: this
    proves _to_call_result actually trusts and acts on that field when it
    correctly reports the call ended in a withdrawal, for any of the four
    phrasings, without needing our own regex to understand any of them."""
    candidate = _candidate()
    for retraction_text in (
        "I have to cancel",
        "Count me out",
        "I rescind my commitment",
        "That agreement is off",
    ):
        call = _call(status="completed", can_come="yes", task_completed=True,
                      evidence="leaving now", final_position="declined_or_withdrawn",
                      transcript_turns=[
                          {"speaker": "bot", "text": "can you come donate right now?"},
                          {"speaker": "user", "text": "Yes, I am definitely coming"},
                          {"speaker": "bot", "text": "great, see you soon"},
                          {"speaker": "user", "text": retraction_text},
                      ])
        result = _to_call_result("call_1", call, candidate)
        assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES), retraction_text
        assert result.commitment_score == 0.0, retraction_text


def test_missing_final_position_fails_closed():
    """final_position is a required schema field, but a non-compliant or
    older response could omit it -- that must fail closed exactly like an
    explicit "unclear" would, not be waved through as "no contradiction"
    the way task_completed=None almost was in an earlier round."""
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now", final_position=None,
                  transcript_turns=[{"speaker": "user", "text": "yes, leaving now"}])
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome not in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
    assert result.commitment_score == 0.0


def test_final_position_unclear_fails_closed():
    candidate = _candidate()
    call = _call(status="completed", can_come="yes", task_completed=True,
                  evidence="leaving now", final_position="unclear",
                  transcript_turns=[{"speaker": "user", "text": "yes, leaving now"}])
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
