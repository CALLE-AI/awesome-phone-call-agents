"""Reproducible, explicitly modeled evaluation for Waitlist Slot Rescue.

This is not customer data and it does not claim a measured production effect.
It compares a manual sequential call queue with the same queue automated by the
app under assumptions printed in every output file.
"""

from __future__ import annotations

import argparse
import json
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean


OUTCOME_WEIGHTS = (
    ("no-answer", 0.38),
    ("declined", 0.40),
    ("accepted", 0.16),
    ("unknown", 0.06),
)
OUTCOME_DURATION_SECONDS = {
    "no-answer": 30,
    "declined": 75,
    "accepted": 95,
    "unknown": 70,
}
DEFAULT_TRIALS = 10_000
DEFAULT_SEED = 20_260_823
MAX_CANDIDATES = 12
OFFER_WINDOW_SECONDS = 15 * 60
MANUAL_BETWEEN_CALLS_SECONDS = 20
MANUAL_NOTE_SECONDS = 15
AUTOMATED_BETWEEN_CALLS_SECONDS = 2
AUTOMATED_SETUP_SECONDS = 45
AUTOMATED_REVIEW_SECONDS = 30
LABOR_RATE_SCENARIOS_EUR_PER_HOUR = (25, 35, 50)


@dataclass(frozen=True)
class QueueResult:
    status: str
    attempts: int
    elapsed_seconds: int
    operator_seconds: int


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the documented Waitlist Slot Rescue model."
    )
    parser.add_argument("--trials", type=int, default=DEFAULT_TRIALS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path)
    return parser.parse_args(argv)


def sample_outcome(rng: random.Random) -> str:
    draw = rng.random()
    cumulative = 0.0
    for outcome, weight in OUTCOME_WEIGHTS:
        cumulative += weight
        if draw < cumulative:
            return outcome
    return OUTCOME_WEIGHTS[-1][0]


def run_queue(outcomes: list[str], *, automated: bool) -> QueueResult:
    elapsed = 0
    operator = AUTOMATED_SETUP_SECONDS if automated else 0
    attempts = 0
    status = "exhausted"
    between_calls = (
        AUTOMATED_BETWEEN_CALLS_SECONDS
        if automated
        else MANUAL_BETWEEN_CALLS_SECONDS
    )

    for outcome in outcomes:
        duration = OUTCOME_DURATION_SECONDS[outcome]
        if elapsed >= OFFER_WINDOW_SECONDS:
            status = "offer-expired"
            break

        elapsed += duration
        attempts += 1
        if automated:
            operator = AUTOMATED_SETUP_SECONDS + AUTOMATED_REVIEW_SECONDS
        else:
            operator += duration + MANUAL_NOTE_SECONDS

        if elapsed >= OFFER_WINDOW_SECONDS:
            status = "offer-expired-after-call-human-review"
            break

        if outcome == "accepted":
            status = "candidate-found"
            break
        if outcome == "unknown":
            status = "human-review-required"
            break

        if attempts < len(outcomes):
            elapsed += between_calls
            if not automated:
                operator += between_calls
    else:
        status = "exhausted"

    return QueueResult(status, attempts, elapsed, operator)


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    index = round((len(ordered) - 1) * quantile)
    return ordered[index]


def evaluate(*, trials: int, seed: int) -> dict:
    if trials < 1:
        raise ValueError("trials must be positive")
    rng = random.Random(seed)
    manual: list[QueueResult] = []
    automated: list[QueueResult] = []

    for _ in range(trials):
        outcomes = [sample_outcome(rng) for _ in range(MAX_CANDIDATES)]
        manual.append(run_queue(outcomes, automated=False))
        automated.append(run_queue(outcomes, automated=True))

    manual_operator = [result.operator_seconds / 60 for result in manual]
    automated_operator = [result.operator_seconds / 60 for result in automated]
    manual_wall = [result.elapsed_seconds / 60 for result in manual]
    automated_wall = [result.elapsed_seconds / 60 for result in automated]

    manual_mean_operator = mean(manual_operator)
    automated_mean_operator = mean(automated_operator)
    reduction = 100 * (1 - automated_mean_operator / manual_mean_operator)
    saved_operator_minutes = manual_mean_operator - automated_mean_operator
    break_even_workflow_cost = {
        str(rate): saved_operator_minutes / 60 * rate
        for rate in LABOR_RATE_SCENARIOS_EUR_PER_HOUR
    }

    return {
        "model_only_not_customer_data": True,
        "trials": trials,
        "seed": seed,
        "assumptions": {
            "maximum_candidates": MAX_CANDIDATES,
            "offer_window_minutes": OFFER_WINDOW_SECONDS / 60,
            "outcome_probabilities": dict(OUTCOME_WEIGHTS),
            "outcome_duration_seconds": OUTCOME_DURATION_SECONDS,
            "manual_between_calls_seconds": MANUAL_BETWEEN_CALLS_SECONDS,
            "manual_note_seconds_per_attempt": MANUAL_NOTE_SECONDS,
            "automated_between_calls_seconds": AUTOMATED_BETWEEN_CALLS_SECONDS,
            "automated_setup_seconds": AUTOMATED_SETUP_SECONDS,
            "automated_review_seconds": AUTOMATED_REVIEW_SECONDS,
        },
        "results": {
            "manual_candidate_found_rate": mean(
                result.status == "candidate-found" for result in manual
            ),
            "automated_candidate_found_rate": mean(
                result.status == "candidate-found" for result in automated
            ),
            "manual_mean_attempts": mean(result.attempts for result in manual),
            "automated_mean_attempts": mean(
                result.attempts for result in automated
            ),
            "manual_mean_wall_minutes": mean(manual_wall),
            "automated_mean_wall_minutes": mean(automated_wall),
            "manual_p90_wall_minutes": percentile(manual_wall, 0.9),
            "automated_p90_wall_minutes": percentile(automated_wall, 0.9),
            "manual_mean_operator_minutes": manual_mean_operator,
            "automated_mean_operator_minutes": automated_mean_operator,
            "modeled_operator_time_reduction_percent": reduction,
            "modeled_operator_minutes_saved": saved_operator_minutes,
            "modeled_candidate_found_rate_change_percentage_points": 100
            * (
                mean(result.status == "candidate-found" for result in automated)
                - mean(result.status == "candidate-found" for result in manual)
            ),
        },
        "unit_economics": {
            "labor_only_not_provider_pricing": True,
            "interpretation": (
                "Maximum total variable workflow cost for labor-time savings alone "
                "to break even; excludes recovered-slot value and customer impact."
            ),
            "labor_rate_scenarios_eur_per_hour": list(
                LABOR_RATE_SCENARIOS_EUR_PER_HOUR
            ),
            "break_even_workflow_cost_eur": break_even_workflow_cost,
        },
        "invariants": {
            "calls_are_sequential": True,
            "ambiguous_outcome_halts_queue": True,
            "booking_is_never_created": True,
            "automatic_redial_is_disabled": True,
        },
        "sample_results": {
            "manual": asdict(manual[0]),
            "automated": asdict(automated[0]),
        },
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = evaluate(trials=args.trials, seed=args.seed)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        destination = args.output.expanduser()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
