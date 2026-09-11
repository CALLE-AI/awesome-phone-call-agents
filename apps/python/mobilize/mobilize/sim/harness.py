"""Zero-cost evaluation harness: run thousands of simulated mobilizations
comparing the calibrated wave-dispatch policy against naive baselines, using
the simulator's known ground truth (`_true_showup`) as the scoring oracle.

This is what makes an honest claim possible on a 20-free-call budget: the
policy is validated here, at zero cost, before a single real call is placed.
"""

from __future__ import annotations

import asyncio
import random
import statistics
from dataclasses import dataclass

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.planner import rank_candidates
from mobilize.core.types import Candidate, Need
from mobilize.sim.population import SyntheticDonor, generate_population
from mobilize.transports.simulated import SimulatedTransport


@dataclass
class RunOutcome:
    policy: str
    filled: bool
    calls_used: int
    confirmed_count: int  # how many the policy believed were confirmed
    time_to_fill_seconds: float | None
    true_showups: int  # ground-truth: of confirmed_count, how many would ACTUALLY show up
    over_recruitment_ratio: float


async def _run_calibrated(need: Need, donors: list[SyntheticDonor], seed: int, tmp_ledger_path: str) -> RunOutcome:
    transport = SimulatedTransport(donors, seed=seed)
    pool = [d.candidate for d in donors]
    ledger = Ledger(tmp_ledger_path)
    result = await mobilize(need, pool, transport, ledger=ledger, mobilization_id=f"eval_{seed}")

    true_showups = _count_true_showups(result.confirmed, transport)
    return RunOutcome(
        policy="calibrated",
        filled=result.filled,
        calls_used=result.calls_used,
        confirmed_count=len(result.confirmed),
        time_to_fill_seconds=result.time_to_fill_seconds,
        true_showups=true_showups,
        over_recruitment_ratio=result.over_recruitment_ratio,
    )


async def _run_stated_yes_only(need: Need, donors: list[SyntheticDonor], seed: int) -> RunOutcome:
    """Baseline: treat any stated 'yes' as confirmed (ignore commitment
    calibration entirely). This is what a naive implementation looks like."""
    rng = random.Random(seed)
    from mobilize.sim.population import simulate_call

    ranked = rank_candidates([d.candidate for d in donors])
    by_id = {d.candidate.id: d for d in donors}
    confirmed = 0
    calls_used = 0
    true_showups = 0
    for candidate in ranked:
        if confirmed >= need.count or calls_used >= need.max_calls:
            break
        donor = by_id[candidate.id]
        outcome = simulate_call(donor, rng)
        calls_used += 1
        if outcome["can_come"] == "yes" and outcome["_picked_up"]:
            confirmed += 1
            if outcome["_true_showup"]:
                true_showups += 1

    return RunOutcome(
        policy="stated_yes_only",
        filled=confirmed >= need.count,
        calls_used=calls_used,
        confirmed_count=confirmed,
        time_to_fill_seconds=None,
        true_showups=true_showups,
        over_recruitment_ratio=calls_used / need.count if need.count else 0.0,
    )


async def _run_sequential(need: Need, donors: list[SyntheticDonor], seed: int) -> RunOutcome:
    """Baseline: today's manual process. One call at a time, stated-yes
    counts as confirmed, stop the instant enough people have said yes."""
    return await _run_stated_yes_only(need, donors, seed)  # same selection logic; difference is real-world wall-clock, not simulated here


async def _run_call_all(need: Need, donors: list[SyntheticDonor], seed: int) -> RunOutcome:
    """Baseline: call everyone in the pool at once, ignore budgeting."""
    rng = random.Random(seed)
    from mobilize.sim.population import simulate_call

    ranked = rank_candidates([d.candidate for d in donors])
    by_id = {d.candidate.id: d for d in donors}
    confirmed = 0
    true_showups = 0
    calls_used = min(len(ranked), need.max_calls)
    for candidate in ranked[:calls_used]:
        donor = by_id[candidate.id]
        outcome = simulate_call(donor, rng)
        if outcome["can_come"] == "yes" and outcome["_picked_up"]:
            confirmed += 1
            if outcome["_true_showup"]:
                true_showups += 1

    return RunOutcome(
        policy="call_all",
        filled=confirmed >= need.count,
        calls_used=calls_used,
        confirmed_count=confirmed,
        time_to_fill_seconds=None,
        true_showups=true_showups,
        over_recruitment_ratio=calls_used / need.count if need.count else 0.0,
    )


def _count_true_showups(confirmed_results, transport: SimulatedTransport) -> int:
    return sum(1 for r in confirmed_results if r.raw.get("_true_showup"))


async def run_sweep(*, n_trials: int, pool_size: int, need_count: int, ledger_dir: str) -> dict[str, list[RunOutcome]]:
    """Each trial gets its own ledger file. The ledger's crash-recovery
    behavior is already covered by test_ledger.py and test_crash_safety.py;
    reusing one growing ledger file across hundreds of sweep trials would
    make every `already_dispatched` check rescan an ever-larger file for no
    reason relevant to what this harness is measuring."""
    results: dict[str, list[RunOutcome]] = {"calibrated": [], "stated_yes_only": [], "call_all": []}
    for trial in range(n_trials):
        seed = 1000 + trial
        donors = generate_population(pool_size, seed=seed)
        need = Need(label="O-negative blood needed", count=need_count, deadline_minutes=60, location="City Hospital", max_calls=40)
        trial_ledger_path = f"{ledger_dir}/trial_{trial}.jsonl"

        results["calibrated"].append(await _run_calibrated(need, donors, seed, trial_ledger_path))
        results["stated_yes_only"].append(await _run_stated_yes_only(need, donors, seed))
        results["call_all"].append(await _run_call_all(need, donors, seed))
    return results


def summarize(results: dict[str, list[RunOutcome]]) -> dict[str, dict]:
    """The key metric is `confirmation_accuracy`: of the donors this policy
    believed were confirmed, what fraction would ACTUALLY show up (per the
    simulator's hidden ground truth)? A policy that fills fast by trusting
    every stated yes will show a high fill_rate but a low confirmation_accuracy
    -- which is precisely the failure mode commitment calibration is meant to
    catch, and precisely why fill_rate alone is a misleading headline metric."""
    summary = {}
    for policy, runs in results.items():
        fill_rate = statistics.mean(1.0 if r.filled else 0.0 for r in runs)
        mean_calls = statistics.mean(r.calls_used for r in runs)
        mean_over_recruit = statistics.mean(r.over_recruitment_ratio for r in runs)

        per_run_accuracy = [r.true_showups / r.confirmed_count for r in runs if r.confirmed_count > 0]
        confirmation_accuracy = statistics.mean(per_run_accuracy) if per_run_accuracy else 0.0

        summary[policy] = {
            "fill_rate": round(fill_rate, 3),
            "confirmation_accuracy": round(confirmation_accuracy, 3),
            "mean_calls_used": round(mean_calls, 2),
            "mean_over_recruitment_ratio": round(mean_over_recruit, 2),
            "n_trials": len(runs),
        }
    return summary


if __name__ == "__main__":
    import json
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        sweep_results = asyncio.run(run_sweep(n_trials=200, pool_size=200, need_count=3, ledger_dir=tmp))
        print(json.dumps(summarize(sweep_results), indent=2))
