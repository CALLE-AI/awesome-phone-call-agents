import importlib.util
import json
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "waitlist_rescue_evaluation", APP_ROOT / "evaluate.py"
)
assert SPEC and SPEC.loader
evaluation = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = evaluation
SPEC.loader.exec_module(evaluation)


def test_evaluation_is_reproducible_and_labels_modeled_data():
    first = evaluation.evaluate(trials=500, seed=17)
    second = evaluation.evaluate(trials=500, seed=17)

    assert first == second
    assert first["model_only_not_customer_data"] is True
    assert first["trials"] == 500
    assert first["seed"] == 17


def test_automation_reduces_operator_time_without_changing_queue_order():
    result = evaluation.evaluate(trials=2_000, seed=23)
    metrics = result["results"]

    assert metrics["automated_mean_operator_minutes"] < metrics[
        "manual_mean_operator_minutes"
    ]
    assert metrics["modeled_operator_time_reduction_percent"] > 50
    assert metrics["automated_mean_attempts"] >= metrics["manual_mean_attempts"]
    assert result["invariants"]["calls_are_sequential"] is True
    assert result["invariants"]["ambiguous_outcome_halts_queue"] is True
    assert result["invariants"]["booking_is_never_created"] is True


def test_labor_only_break_even_is_formula_driven_and_not_provider_pricing():
    result = evaluation.evaluate(trials=2_000, seed=23)
    metrics = result["results"]
    economics = result["unit_economics"]
    saved_minutes = (
        metrics["manual_mean_operator_minutes"]
        - metrics["automated_mean_operator_minutes"]
    )

    assert economics["labor_only_not_provider_pricing"] is True
    assert economics["break_even_workflow_cost_eur"]["35"] == saved_minutes / 60 * 35
    assert "excludes recovered-slot value" in economics["interpretation"]
    assert metrics["modeled_candidate_found_rate_change_percentage_points"] >= 0


def test_evaluation_output_contains_no_phone_or_personal_data():
    rendered = json.dumps(evaluation.evaluate(trials=20, seed=1))

    assert "+" not in rendered
    assert "phone" not in rendered.lower()
    assert "name" not in rendered.lower()


def test_invalid_trial_count_is_rejected():
    try:
        evaluation.evaluate(trials=0, seed=1)
    except ValueError as exc:
        assert "positive" in str(exc)
    else:
        raise AssertionError("zero trials were accepted")


def test_model_rechecks_expiry_after_a_call_like_the_application():
    result = evaluation.run_queue(["declined"] * 12, automated=False)

    assert result.status == "offer-expired-after-call-human-review"
    assert result.elapsed_seconds >= evaluation.OFFER_WINDOW_SECONDS
    assert result.attempts == 10
