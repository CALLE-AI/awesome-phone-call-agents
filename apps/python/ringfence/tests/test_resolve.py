"""Direct unit tests for resolve.classify() itself.

Previously classify() was only exercised indirectly through fixtures and
the synthetic corpus -- this covers its branches directly, including the
connection_failed_during_attempt case, which classify() once mislabeled as
no_answer_confirmed: a provider-side failure with zero ring time is not a
recipient who chose not to answer, and treating it as one loses the
distinction the disposition table depends on.
"""

from ringfence import resolve


def _attempt(**overrides) -> dict:
    attempt = dict(
        started_at="2026-01-05T10:00:00Z",
        completed_at="2026-01-05T10:01:00Z",
        transcript_turns=[],
        failure_code=None,
        failure_message=None,
    )
    attempt.update(overrides)
    return attempt


def test_genuine_no_answer_has_nonzero_duration_and_no_attempt_failure_code():
    call = {"status": "completed", "task_completed": False, "failure_code": None, "failure_message": None}
    attempt = _attempt(started_at="2026-01-05T10:00:00Z", completed_at="2026-01-05T10:00:45Z")
    resolution = resolve.classify(call, [attempt], [])
    assert resolution.outcome == resolve.NO_ANSWER_CONFIRMED


def test_zero_duration_attempt_is_a_connection_failure_not_a_confirmed_no_answer():
    # The shape that exposed the bug: started_at == completed_at (zero
    # ring time) with an attempt-level failure_code set.
    call = {"status": "failed", "task_completed": False, "failure_code": "call_failed", "failure_message": "calling task status=FAILED"}
    attempt = _attempt(started_at="2026-01-05T10:00:00Z", completed_at="2026-01-05T10:00:00Z", failure_code="504")
    resolution = resolve.classify(call, [attempt], [])
    assert resolution.outcome == resolve.CONNECTION_FAILED_DURING_ATTEMPT
    assert resolution.confidence == "high"


def test_zero_duration_attempt_without_a_failure_code_is_still_a_connection_failure():
    call = {"status": "completed", "task_completed": False, "failure_code": None, "failure_message": None}
    attempt = _attempt(started_at="2026-01-05T10:00:00Z", completed_at="2026-01-05T10:00:00Z")
    resolution = resolve.classify(call, [attempt], [])
    assert resolution.outcome == resolve.CONNECTION_FAILED_DURING_ATTEMPT
    assert resolution.confidence == "medium"  # lower confidence: no explicit failure_code corroborating it


def test_nonzero_duration_with_an_attempt_failure_code_is_still_a_connection_failure():
    # A failure_code present at the attempt level is itself decisive, even
    # with nonzero (but still transcript-empty) duration.
    call = {"status": "failed", "task_completed": False, "failure_code": "call_failed", "failure_message": None}
    attempt = _attempt(started_at="2026-01-05T10:00:00Z", completed_at="2026-01-05T10:00:10Z", failure_code="503")
    resolution = resolve.classify(call, [attempt], [])
    assert resolution.outcome == resolve.CONNECTION_FAILED_DURING_ATTEMPT


def test_connection_failed_during_attempt_still_escalates_never_allows():
    from ringfence.decide import ESCALATE_TO_HUMAN, decide

    call = {"status": "failed", "task_completed": False, "failure_code": "call_failed", "failure_message": None}
    attempt = _attempt(started_at="2026-01-05T10:00:00Z", completed_at="2026-01-05T10:00:00Z", failure_code="504")
    resolution = resolve.classify(call, [attempt], [])
    disposition = decide(resolution, {})
    assert disposition.disposition == ESCALATE_TO_HUMAN
    assert "connection_failed_during_attempt" in disposition.reasons[0]


def test_never_dialed_is_unaffected_by_the_new_branch():
    call = {"status": "failed", "task_completed": None, "failure_code": None, "failure_message": "Unspecified provider error."}
    resolution = resolve.classify(call, [], [])
    assert resolution.outcome == resolve.REJECTED_BEFORE_RING


def test_answered_success_and_answered_declined_are_unaffected():
    call = {"status": "completed", "task_completed": True, "failure_code": None, "failure_message": None}
    attempt = _attempt(transcript_turns=[{"speaker": "bot", "text": "hi"}])
    assert resolve.classify(call, [attempt], []).outcome == resolve.ANSWERED_SUCCESS

    call_declined = dict(call, task_completed=False)
    assert resolve.classify(call_declined, [attempt], []).outcome == resolve.ANSWERED_DECLINED
