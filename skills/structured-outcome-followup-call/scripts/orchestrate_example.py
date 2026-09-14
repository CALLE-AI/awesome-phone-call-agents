"""
Worked example: delivery-exception follow-up call.

A logistics agent needs to call a recipient after a delivery exception
(damaged package, missed delivery window, etc.), ask three structured
questions, score the answers with a simple rubric, and decide whether the
case can be closed automatically or needs a human dispatcher.

Run it:

    python scripts/orchestrate_example.py

No network access, no credentials, no dependencies beyond the Python
standard library and mock_provider.py in this same folder.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from mock_provider import (  # noqa: E402
    CallQuestion,
    CallTask,
    MockVoiceProvider,
    new_reference_id,
    run_structured_call,
)

QUESTIONS = [
    CallQuestion(key="package_received", prompt="Did the package eventually arrive?"),
    CallQuestion(key="condition_ok", prompt="Was the package in good condition when it arrived?"),
    CallQuestion(key="reschedule_needed", prompt="Does the delivery need to be rescheduled?"),
]


def load_rubric():
    """Load the scoring rubric from assets/example_rubric.json as data, not code."""
    rubric_path = os.path.join(os.path.dirname(__file__), "..", "assets", "example_rubric.json")
    with open(rubric_path) as f:
        return json.load(f)


def make_rubric_function(rubric_data):
    """
    Turn the JSON rubric into the (answers) -> (level, score, reasons)
    callable run_structured_call expects. Kept as a small adapter function
    so the rubric itself can stay pure data (easy for a non-engineer
    contributor to edit) while the scoring logic pattern stays in code.
    """

    def rubric(answers):
        score = 0
        reasons = []
        for rule in rubric_data["rules"]:
            answer_value = answers.get(rule["answer_key"])
            if answer_value == rule["triggers_on"]:
                score += rule["points"]
                reasons.append(rule["reason"])

        if score >= rubric_data["thresholds"]["needs_dispatcher"]:
            level = "needs_dispatcher"
        elif score >= rubric_data["thresholds"]["minor_issue"]:
            level = "minor_issue"
        else:
            level = "no_issue"

        if not reasons:
            reasons.append("No exceptions reported")

        return level, score, reasons

    return rubric


def on_result(level, score, reasons, task):
    """The follow-up action: for this example, just a clearly-labeled log line."""
    print(f"  -> Outcome for {task.subject_name}: {level.upper()} (score={score})")
    print(f"     Reasons: {', '.join(reasons)}")
    if level == "needs_dispatcher":
        print("     [ACTION] Would notify a human dispatcher here (stub — no real integration in this example).")


# Scenario generators the mock provider can be asked to produce — kept in
# the example, not in mock_provider.py, since these are domain-specific.
SCENARIO_GENERATORS = {
    "no_issue": lambda task: {
        "package_received": True,
        "condition_ok": True,
        "reschedule_needed": False,
    },
    "minor_issue": lambda task: {
        "package_received": True,
        "condition_ok": False,
        "reschedule_needed": False,
    },
    "needs_reschedule": lambda task: {
        "package_received": False,
        "condition_ok": False,
        "reschedule_needed": True,
    },
}


def main():
    rubric_data = load_rubric()
    rubric = make_rubric_function(rubric_data)
    provider = MockVoiceProvider(scenario_generators=SCENARIO_GENERATORS)

    print("Structured Outcome Follow-up Call — delivery-exception example\n")

    for scenario_name in ("no_issue", "minor_issue", "needs_reschedule", "failed", "no_answer"):
        task = CallTask(
            subject_name=f"Recipient ({scenario_name})",
            phone_number="+15550000000",
            context="a recent delivery exception",
            questions=QUESTIONS,
            reference_id=new_reference_id(),
        )
        print(f"Running scenario: {scenario_name}")
        outcome = run_structured_call(
            provider, task, rubric, on_result, forced_scenario=scenario_name
        )
        if outcome.event_type != "completed":
            print(f"  -> Call did not complete ({outcome.event_type}): {outcome.failure_reason}")
        print()


if __name__ == "__main__":
    main()
