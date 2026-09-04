"""
test_orchestrate_example.py — minimal automated regression test for the
structured-outcome-followup-call skill's deterministic worked example.

DELIBERATELY dependency-free: uses only the Python standard library and
bare `assert` statements, run directly via `python3`, not pytest. This is
intentional, not an oversight — this skill's entire pitch is "runnable
with zero dependencies, in under a minute, by anyone." Requiring pytest to
verify it would quietly break that promise for exactly the audience this
skill is aimed at (a contributor evaluating whether to adopt the pattern,
who may not have — or want to install — a test framework just to check).

What this tests: that each of the five documented scenarios
(no_issue, minor_issue, needs_reschedule, failed, no_answer) produces its
documented, deterministic outcome — not just that the script runs without
raising. Asserts on the actual rubric level, score, and reasons, and on
the failure-scenario event types/reasons.

Run it:

    python3 scripts/test_orchestrate_example.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mock_provider import CallQuestion, CallTask, MockVoiceProvider, new_reference_id, run_structured_call  # noqa: E402
from orchestrate_example import (  # noqa: E402
    QUESTIONS,
    SCENARIO_GENERATORS,
    load_rubric,
    make_rubric_function,
)


def _make_task(scenario_name: str) -> CallTask:
    return CallTask(
        subject_name=f"Recipient ({scenario_name})",
        phone_number="+15550000000",
        context="a recent delivery exception",
        questions=QUESTIONS,
        reference_id=new_reference_id(),
    )


def _capture_result(rubric, provider, scenario_name):
    """Runs one scenario and returns (outcome, captured_level, captured_score, captured_reasons)."""
    captured = {}

    def _capture_on_result(level, score, reasons, task):
        captured["level"] = level
        captured["score"] = score
        captured["reasons"] = reasons

    task = _make_task(scenario_name)
    outcome = run_structured_call(provider, task, rubric, _capture_on_result, forced_scenario=scenario_name)
    return outcome, captured


def test_no_issue_scenario_is_deterministic():
    rubric = make_rubric_function(load_rubric())
    provider = MockVoiceProvider(scenario_generators=SCENARIO_GENERATORS)
    outcome, captured = _capture_result(rubric, provider, "no_issue")

    assert outcome.event_type == "completed"
    assert captured["level"] == "no_issue"
    assert captured["score"] == 0
    assert captured["reasons"] == ["No exceptions reported"]


def test_minor_issue_scenario_is_deterministic():
    rubric = make_rubric_function(load_rubric())
    provider = MockVoiceProvider(scenario_generators=SCENARIO_GENERATORS)
    outcome, captured = _capture_result(rubric, provider, "minor_issue")

    assert outcome.event_type == "completed"
    assert captured["level"] == "minor_issue"
    assert captured["score"] == 3
    assert captured["reasons"] == ["Package arrived in poor condition"]


def test_needs_reschedule_scenario_is_deterministic():
    """
    All three rubric rules fire simultaneously for this scenario — the
    scenario most likely to break silently if the rubric or scenario data
    ever drifts, since it depends on every rule firing together correctly.
    """
    rubric = make_rubric_function(load_rubric())
    provider = MockVoiceProvider(scenario_generators=SCENARIO_GENERATORS)
    outcome, captured = _capture_result(rubric, provider, "needs_reschedule")

    assert outcome.event_type == "completed"
    assert captured["level"] == "needs_dispatcher"
    assert captured["score"] == 12  # 5 + 3 + 4, every rule firing
    assert captured["reasons"] == [
        "Package still has not been received",
        "Package arrived in poor condition",
        "Recipient requested a reschedule",
    ]


def test_failed_scenario_never_reaches_the_rubric():
    """
    A failed call must not produce a rubric result at all — run_result
    should never be invoked, and the outcome must clearly report failure.
    """
    rubric = make_rubric_function(load_rubric())
    provider = MockVoiceProvider(scenario_generators=SCENARIO_GENERATORS)
    outcome, captured = _capture_result(rubric, provider, "failed")

    assert outcome.event_type == "failed"
    assert outcome.structured_answers is None
    assert outcome.failure_reason is not None
    assert captured == {}, "on_result must not fire for a failed call"


def test_no_answer_scenario_never_reaches_the_rubric():
    rubric = make_rubric_function(load_rubric())
    provider = MockVoiceProvider(scenario_generators=SCENARIO_GENERATORS)
    outcome, captured = _capture_result(rubric, provider, "no_answer")

    assert outcome.event_type == "no_answer"
    assert outcome.structured_answers is None
    assert outcome.failure_reason is not None
    assert captured == {}, "on_result must not fire for a no-answer call"


def test_rubric_data_loads_from_the_actual_asset_file():
    """Guards against the rubric json and the code silently drifting apart."""
    rubric_data = load_rubric()
    assert rubric_data["thresholds"]["minor_issue"] == 3
    assert rubric_data["thresholds"]["needs_dispatcher"] == 5
    assert {rule["answer_key"] for rule in rubric_data["rules"]} == {
        "package_received", "condition_ok", "reschedule_needed",
    }


ALL_TESTS = [
    test_no_issue_scenario_is_deterministic,
    test_minor_issue_scenario_is_deterministic,
    test_needs_reschedule_scenario_is_deterministic,
    test_failed_scenario_never_reaches_the_rubric,
    test_no_answer_scenario_never_reaches_the_rubric,
    test_rubric_data_loads_from_the_actual_asset_file,
]


def main():
    passed, failed = 0, []
    for test_fn in ALL_TESTS:
        try:
            test_fn()
            passed += 1
            print(f"PASS: {test_fn.__name__}")
        except AssertionError as e:
            failed.append((test_fn.__name__, str(e)))
            print(f"FAIL: {test_fn.__name__} -> {e}")

    print(f"\n{passed}/{len(ALL_TESTS)} passed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
