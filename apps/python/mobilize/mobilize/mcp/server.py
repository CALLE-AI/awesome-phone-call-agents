"""MCP server exposing mobilize() as an agent tool, so any MCP-compatible
agent (Claude Code, Codex, Cursor) can trigger a mobilization and get back a
structured result -- mirroring the shape of CALL-E's own plan_call/run_call/
get_call_run tools.

Run:
    python -m mobilize.mcp.server

Tools exposed:
    mobilize_simulated(need_label, count, deadline_minutes, pool_size, max_calls, seed)
        -- zero cost, runs against the built-in simulator. Safe to call freely.
    mobilize_real(need_label, count, phones, deadline_minutes)
        -- places REAL CALL-E calls to the exact phone numbers given. Never
           expands to a larger pool on its own; the caller must supply every
           number explicitly, so an agent can never accidentally spend a lot
           of call credits from one tool invocation.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

try:
    from mcp.server.fastmcp import FastMCP as MCPServer  # older SDK versions
except ImportError:
    from mcp.server.mcpserver import MCPServer  # mcp>=2.0

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.policy import GovernancePolicy, GovernanceState
from mobilize.core.types import Candidate, Need
from mobilize.sim.population import generate_population
from mobilize.transports.base import E164_RE
from mobilize.transports.simulated import SimulatedTransport

mcp = MCPServer("mobilize")


@mcp.tool()
async def mobilize_simulated(
    need_label: str,
    count: int = 3,
    deadline_minutes: float = 60,
    pool_size: int = 200,
    max_calls: int = 40,
    seed: int = 0,
) -> dict:
    """Run a zero-cost simulated mobilization: dispatch parallel waves of
    calls against a synthetic donor/volunteer pool with known ground truth,
    stopping as soon as `count` confirmations with sufficient commitment are
    reached. Use this to demonstrate or test the mobilize() engine without
    spending any real CALL-E call credits."""
    donors = generate_population(pool_size, seed=seed)
    pool = [d.candidate for d in donors]
    transport = SimulatedTransport(donors, seed=seed)
    need = Need(label=need_label, count=count, deadline_minutes=deadline_minutes,
                location="", max_calls=max_calls)
    ledger = Ledger("/tmp/mobilize_mcp_sim_ledger.jsonl")

    result = await mobilize(need, pool, transport, ledger=ledger, mobilization_id=f"mcp_sim_{seed}")
    return {
        "filled": result.filled,
        "confirmed_count": len(result.confirmed),
        "calls_used": result.calls_used,
        "waves_dispatched": len(result.waves),
        "time_to_fill_seconds": result.time_to_fill_seconds,
        "over_recruitment_ratio": result.over_recruitment_ratio,
        "confirmed": [
            {"candidate_id": r.candidate_id, "outcome": r.outcome.value, "commitment_score": r.commitment_score}
            for r in result.confirmed
        ],
    }


@mcp.tool()
async def mobilize_real(
    need_label: str,
    phones: list[str],
    confirm: bool = False,
    count: int | None = None,
    deadline_minutes: float = 60,
) -> dict:
    """Place REAL CALL-E calls to exactly the E.164 phone numbers listed in
    `phones` -- never more. Requires CALLE_API_KEY in the environment. Use
    only for numbers you own or are explicitly authorized to call. This
    spends real call credits; there is no default expansion to a larger pool.

    `confirm` must be explicitly set to true. Calling this with confirm=false
    (the default) returns a preview of exactly what would be dialed instead
    of placing any calls -- an agent must make a second, explicit call with
    confirm=true to actually dispatch. This mirrors the CLI's typed 'yes'
    confirmation; an MCP tool has no interactive prompt, so the two-call
    pattern is the equivalent safeguard.

    Real calls run under governance by default: do-not-call, cooldowns,
    contact fatigue, and calling-hour windows are enforced, not optional."""
    invalid = [p for p in phones if not E164_RE.match(p)]
    if invalid:
        return {"error": f"Not valid E.164 phone numbers, refusing to dispatch: {invalid}"}

    if not confirm:
        return {
            "preview": True,
            "would_call": phones,
            "need_label": need_label,
            "count_needed": count or len(phones),
            "deadline_minutes": deadline_minutes,
            "message": "No calls placed. Call again with confirm=true to actually dispatch.",
        }

    from mobilize.transports.calle import CalleTransport

    if "CALLE_API_KEY" not in os.environ:
        return {"error": "CALLE_API_KEY not set in environment"}

    candidates = [
        Candidate(id=f"real_{i}", phone=p, name=f"Recipient {i}", days_since_last_action=90,
                   distance_km=5, historical_accept_rate=0.5, historical_showup_rate=0.5)
        for i, p in enumerate(phones)
    ]
    need = Need(label=need_label, count=count or len(candidates), deadline_minutes=deadline_minutes,
                location="", max_calls=len(candidates))
    ledger = Ledger("/tmp/mobilize_mcp_real_ledger.jsonl")
    transport = CalleTransport()
    governance_state = GovernanceState()
    governance_policy = GovernancePolicy()

    result = await mobilize(need, candidates, transport, ledger=ledger,
                             governance_state=governance_state, governance_policy=governance_policy)
    await transport.aclose()
    return {
        "filled": result.filled,
        "confirmed_count": len(result.confirmed),
        "calls_used": result.calls_used,
        "confirmed": [
            {"candidate_id": r.candidate_id, "outcome": r.outcome.value, "evidence": r.evidence}
            for r in result.confirmed
        ],
    }


if __name__ == "__main__":
    mcp.run()
