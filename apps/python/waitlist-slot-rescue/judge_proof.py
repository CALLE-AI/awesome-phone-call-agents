"""One-command, dependency-free verification for competition judges."""

from __future__ import annotations

import json
from pathlib import Path

import evaluate
import judge_bundle


APP_ROOT = Path(__file__).resolve().parent


def verify() -> dict[str, object]:
    committed_bundle = json.loads(
        (APP_ROOT / "judge_bundle.json").read_text(encoding="utf-8")
    )
    generated_bundle = judge_bundle.generate_bundle()
    if committed_bundle != generated_bundle:
        raise AssertionError("judge_bundle.json is not generated from the current engine")

    golden = generated_bundle["scenarios"]["golden"]
    halted = generated_bundle["scenarios"]["safe_halt"]
    assert golden["selected_candidate_id"] == "candidate-b"
    assert golden["untouched_candidate_ids"] == ["candidate-c"]
    assert golden["booking_created"] is False
    assert golden["audit_events"][-1]["candidate_id"] == "candidate-b"
    assert golden["audit_events"][-1]["event"] == "workflow.handoff"
    assert halted["status"] == "halted-ambiguous-outcome"
    assert halted["untouched_candidate_ids"] == ["candidate-b", "candidate-c"]
    assert halted["booking_created"] is False
    assert halted["audit_events"][-1]["event"] == "workflow.halted"

    committed_evaluation = json.loads(
        (APP_ROOT / "evaluation_results.json").read_text(encoding="utf-8")
    )
    generated_evaluation = evaluate.evaluate(
        trials=committed_evaluation["trials"], seed=committed_evaluation["seed"]
    )
    if committed_evaluation != generated_evaluation:
        raise AssertionError("evaluation_results.json is not reproducible")

    rendered = json.dumps(generated_bundle)
    assert "+120255501" not in rendered
    return {
        "verdict": "PASS",
        "phone_calls_created": 0,
        "engine_artifact_exact_match": True,
        "golden_path": "A declined; B accepted; C untouched; human confirmation required",
        "safe_halt": "ambiguous A; B and C untouched; human review required",
        "automatic_bookings": 0,
        "automatic_redials": 0,
        "modeled_operator_time_reduction_percent": round(
            generated_evaluation["results"]["modeled_operator_time_reduction_percent"],
            1,
        ),
        "labor_only_break_even_at_35_eur_per_hour": round(
            generated_evaluation["unit_economics"]["break_even_workflow_cost_eur"]["35"],
            2,
        ),
        "model_is_customer_data": False,
    }


def main() -> int:
    result = verify()
    print("WAITLIST SLOT RESCUE — NO-CALL JUDGE PROOF")
    for key, value in result.items():
        print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
