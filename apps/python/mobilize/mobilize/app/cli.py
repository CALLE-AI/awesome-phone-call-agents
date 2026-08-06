"""CLI demo runner: watch a mobilization unfold wave by wave, either against
the free simulator (default) or real CALL-E calls (--real, spends credits).

    python -m mobilize.app.cli                      # simulated, free, instant
    python -m mobilize.app.cli --real --phones a,b,c # real CALL-E calls

--real requires CALLE_API_KEY in the environment and calls only the E.164
phone numbers you pass explicitly via --phones -- it will never call a
larger pool, by design, so real credits are never spent by accident.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from mobilize.core.dispatcher import mobilize
from mobilize.core.ids import derive_mobilization_id
from mobilize.core.ledger import Ledger
from mobilize.core.policy import GovernancePolicy, load_governance_state
from mobilize.core.types import Candidate, Need
from mobilize.sim.population import generate_population
from mobilize.transports.base import validate_e164
from mobilize.transports.simulated import SimulatedTransport

GOVERNANCE_STATE_PATH = "/tmp/mobilize_real_governance.json"

GREEN, YELLOW, RED, DIM, RESET = "\033[92m", "\033[93m", "\033[91m", "\033[2m", "\033[0m"


def _print_event(event: str, data: dict) -> None:
    if event == "wave_dispatch":
        print(f"\n{DIM}── wave {data['wave']}: dialing {len(data['candidates'])} candidates in parallel{RESET}")
    elif event == "call_result":
        color = GREEN if data["outcome"] in ("firm_yes",) else (YELLOW if data["outcome"] == "soft_yes" else DIM)
        print(f"  {color}{data['candidate_id']:<12} {data['outcome']:<12} commitment={data['commitment']:.2f}{RESET}")
    elif event == "need_met":
        print(f"\n{GREEN}✓ need met — {data['confirmed']} confirmed at {data['time_to_fill_seconds']:.1f}s. "
              f"No further wave will be dispatched.{RESET}")
    elif event == "call_timed_out":
        print(f"  {RED}{data['candidate_id']:<12} timed out{RESET}")


async def run_simulated(pool_size: int, need_count: int, max_calls: int, seed: int) -> None:
    print(f"Generating a simulated donor pool of {pool_size} (seed={seed})...")
    donors = generate_population(pool_size, seed=seed)
    pool = [d.candidate for d in donors]
    transport = SimulatedTransport(donors, seed=seed)
    need = Need(label="O-negative blood needed", count=need_count, deadline_minutes=60,
                location="City Hospital", max_calls=max_calls)
    ledger = Ledger("/tmp/mobilize_demo_ledger.jsonl")

    print(f"\nNeed: {need_count} confirmed donors, budget {max_calls} calls, deadline {need.deadline_minutes} min.\n")
    start = time.monotonic()
    result = await mobilize(need, pool, transport, ledger=ledger, on_progress=_print_event,
                             mobilization_id=f"cli_{seed}_{int(start)}")

    print(f"\n{'='*60}")
    print(f"Filled: {result.filled}   Confirmed: {len(result.confirmed)}/{need_count}   "
          f"Calls used: {result.calls_used}   Waves: {len(result.waves)}")
    if result.time_to_fill_seconds:
        print(f"Time to fill: {result.time_to_fill_seconds:.1f}s")
    print(f"Over-recruitment ratio: {result.over_recruitment_ratio:.2f}x")
    print(f"{'='*60}")
    print(f"\n{DIM}Manual baseline for comparison: a human coordinator phoning down "
          f"this same list one at a time typically takes 30-40+ minutes for a "
          f"3-donor need (see README for the cited literature).{RESET}")


async def run_real(phones: list[str], need_count: int, need_label: str) -> None:
    from mobilize.transports.calle import CalleTransport

    if "CALLE_API_KEY" not in os.environ:
        print("CALLE_API_KEY not set. Export it before running --real.", file=sys.stderr)
        sys.exit(1)

    for p in phones:
        try:
            validate_e164(p)
        except ValueError as exc:
            print(f"Refusing to dispatch: {exc}", file=sys.stderr)
            sys.exit(1)

    candidates = [
        Candidate(id=f"real_{i}", phone=p, name=f"Recipient {i}", days_since_last_action=90,
                   distance_km=5, historical_accept_rate=0.5, historical_showup_rate=0.5)
        for i, p in enumerate(phones)
    ]
    need = Need(label=need_label, count=need_count, deadline_minutes=60,
                location="City Hospital", max_calls=len(candidates))
    ledger = Ledger("/tmp/mobilize_real_ledger.jsonl")
    transport = CalleTransport()
    # Real calls always run under governance -- do-not-call, cooldowns,
    # contact fatigue, and calling-hour windows -- by default, not as
    # something the caller has to remember to opt into. Loaded from disk so
    # it actually persists across separate CLI invocations; a fresh
    # GovernanceState() every run would make cooldown/fatigue tracking
    # silently useless beyond a single process.
    governance_state = load_governance_state(GOVERNANCE_STATE_PATH)
    governance_policy = GovernancePolicy()

    # Derived from the request itself, not a timestamp or random UUID, so
    # retrying the exact same mobilization after a crash reuses the same
    # idempotency keys instead of silently starting an indistinguishable
    # parallel run that can redial everyone.
    mobilization_id = derive_mobilization_id(need_label, phones)

    print(f"⚠️  REAL CALL-E CALLS to {len(phones)} number(s). This spends real call credits.")
    confirm = input("Type 'yes' to proceed: ")
    if confirm.strip().lower() != "yes":
        print("Aborted.")
        return

    result = await mobilize(need, candidates, transport, ledger=ledger, on_progress=_print_event,
                             mobilization_id=mobilization_id,
                             governance_state=governance_state, governance_policy=governance_policy,
                             governance_state_path=GOVERNANCE_STATE_PATH)
    print(f"\nFilled: {result.filled}   Confirmed: {len(result.confirmed)}   Calls used: {result.calls_used}")
    await transport.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description="mobilize() demo runner")
    parser.add_argument("--real", action="store_true", help="place real CALL-E calls (spends credits)")
    parser.add_argument("--phones", type=str, default="", help="comma-separated E.164 phone numbers, --real only")
    parser.add_argument("--need-label", type=str, default="Can you help with an urgent request right now?")
    parser.add_argument("--pool-size", type=int, default=200)
    parser.add_argument("--need-count", type=int, default=3)
    parser.add_argument("--max-calls", type=int, default=40)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.real:
        phones = [p.strip() for p in args.phones.split(",") if p.strip()]
        if not phones:
            print("--real requires --phones a,b,c (E.164 numbers you own or are authorized to call)", file=sys.stderr)
            sys.exit(1)
        asyncio.run(run_real(phones, min(args.need_count, len(phones)), args.need_label))
    else:
        asyncio.run(run_simulated(args.pool_size, args.need_count, args.max_calls, args.seed))


if __name__ == "__main__":
    main()
