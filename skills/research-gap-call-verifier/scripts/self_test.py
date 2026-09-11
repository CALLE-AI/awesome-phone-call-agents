#!/usr/bin/env python3
"""Run no-network regression checks for the research-gap call verifier."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import build_call_plan
import validate_results


ROOT = Path(__file__).resolve().parent.parent


def load(name: str) -> dict:
    with (ROOT / "assets" / name).open(encoding="utf-8") as handle:
        return json.load(handle)


def expect_rejected(label: str, action, error_type: type[Exception]) -> None:
    try:
        action()
    except error_type:
        return
    raise AssertionError(f"{label} was accepted")


def main() -> int:
    research = load("fictional-research.json")
    expected_plan = load("expected-call-plan.json")
    results = load("fictional-results.json")

    plan = build_call_plan.build_plan(build_call_plan.validate_input(research))
    assert plan == expected_plan, "generated plan differs from expected fixture"
    assert plan["dry_run"] is True
    assert plan["side_effect"].startswith("None.")

    reconciled = validate_results.reconcile(plan, results)
    assert reconciled["summary"] == {
        "calls_planned": 2,
        "calls_reported": 2,
        "calls_completed": 1,
        "gaps_total": 3,
        "gaps_confirmed_by_phone": 1,
    }
    statuses = [fact["status"] for fact in reconciled["facts"]]
    assert statuses == [
        "sourced",
        "confirmed_by_phone",
        "not_established",
        "not_reached",
    ]

    prohibited = copy.deepcopy(research)
    prohibited["goal"] = "Run a marketing survey for new sales leads."
    expect_rejected(
        "prohibited purpose",
        lambda: build_call_plan.validate_input(prohibited),
        build_call_plan.ValidationError,
    )

    sensitive = copy.deepcopy(research)
    sensitive["constraints"].append("Use confirmation code 123456.")
    expect_rejected(
        "sensitive numeric sequence",
        lambda: build_call_plan.validate_input(sensitive),
        build_call_plan.ValidationError,
    )

    changed_recipient = copy.deepcopy(results)
    changed_recipient["calls"][0]["recipient_e164"] = "+12025550199"
    expect_rejected(
        "changed recipient",
        lambda: validate_results.reconcile(plan, changed_recipient),
        validate_results.ValidationError,
    )

    ambiguous = copy.deepcopy(results)
    ambiguous["calls"][0]["answers"][0]["answer"] = "It is probably available."
    ambiguous["calls"][0]["answers"][0]["callee_quote"] = "I think it is open."
    ambiguous_result = validate_results.reconcile(plan, ambiguous)
    assert ambiguous_result["summary"]["gaps_confirmed_by_phone"] == 0
    assert ambiguous_result["facts"][1]["status"] == "not_established"

    print("research-gap-call-verifier self-test: PASS (no network; no calls)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"self-test failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
