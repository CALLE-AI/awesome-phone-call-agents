"""AgentCover CallGate CLI.

Usage:
  python -m agentcover_callgate demo
  python -m agentcover_callgate gate examples/appointment.json --dry-run
  python -m agentcover_callgate gate examples/appointment.json --execute
  python -m agentcover_callgate status
  python -m agentcover_callgate kill "operator"
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.environ.get(
    "SAFETY_PROTOCOL_SRC", r"C:/Users/michael/safety-protocol/src"))

from agentcover_callgate import AgentCoverCallGate, CallPlan, evidence_bundle


def _build_gate(args) -> AgentCoverCallGate:
    return AgentCoverCallGate(
        agent_id=getattr(args, "agent_id", "sched_agent_01") or "sched_agent_01",
        user_id=os.environ.get("AGENTCOVER_OWNER", "michael"),
        budget_limit=float(os.environ.get("AGENTCOVER_BUDGET", "5000")),
        offline=not getattr(args, "execute", False),
    )


def cmd_demo(args) -> int:
    g = _build_gate(args)
    print("== AgentCover CallGate demo (offline, real SDK via mock transport) ==")
    print(f"bound agent {g.agent_id} -> owner {g.user_id}")
    plan = CallPlan(
        task="Confirm Tuesday 2:00 PM appointment for patient #4471.",
        phones=["+15551234567"],
        region="US",
        locale="en-US",
        estimated_cost=1.0,
        idempotency_key="demo_appt_4471",
    )
    res = g.gate(plan, execute=True)
    print(f"[GATE] outcome={res.outcome} reason={res.reason}")
    print(f"[SDK ] call returned status={res.call_result and res.call_result.get('status')}")
    ev = evidence_bundle(g)
    print("[AUDIT] events:", len(ev["agentcover_insurance_bundle"]["immutable_audit_trail"]))
    print("[AUDIT] sample:", ev["agentcover_insurance_bundle"]["immutable_audit_trail"][-1]["event_type"])
    print("[INSURANCE] summary:", ev["agentcover_insurance_bundle"]["summary"])
    # now exercise the kill switch
    g.kill("demo")
    res2 = g.gate(CallPlan(task="x", phones=["+15551234567"],
                           estimated_cost=1.0, idempotency_key="demo_k"),
                  execute=True)
    print(f"[KILL] subsequent call outcome={res2.outcome}")
    return 0


def cmd_gate(args) -> int:
    with open(args.plan) as f:
        plan = CallPlan.from_dict(json.load(f))
    g = _build_gate(args)
    res = g.gate(plan, execute=args.execute)
    print(json.dumps({
        "outcome": res.outcome,
        "request_id": res.request_id,
        "reason": res.reason,
        "approval_token": res.approval_token,
        "call_status": (res.call_result or {}).get("status"),
        "call_id": (res.call_result or {}).get("id"),
    }, indent=2))
    return 0 if res.outcome in ("allowed", "pending_approval") else 1


def cmd_status(args) -> int:
    g = _build_gate(args)
    print(json.dumps(g.status(), indent=2, default=str))
    return 0


def cmd_kill(args) -> int:
    g = _build_gate(args)
    g.kill(args.reason)
    print("kill switch engaged:", g.protocol._state.value)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="agentcover-callgate",
                                description="Bounded-autonomy gate for CALL-E calls.")
    sub = p.add_subparsers(dest="cmd", required=True)

    pd = sub.add_parser("demo", help="offline full walkthrough")
    pd.set_defaults(func=cmd_demo, agent_id="sched_agent_01")

    pg = sub.add_parser("gate", help="gate a call plan JSON")
    pg.add_argument("plan", help="path to call plan JSON")
    pg.add_argument("--execute", action="store_true", help="place real calls")
    pg.add_argument("--agent-id", default="sched_agent_01")
    pg.set_defaults(func=cmd_gate)

    ps = sub.add_parser("status")
    ps.add_argument("--agent-id", default="sched_agent_01")
    ps.set_defaults(func=cmd_status)

    pk = sub.add_parser("kill")
    pk.add_argument("reason", nargs="?", default="operator")
    pk.add_argument("--agent-id", default="sched_agent_01")
    pk.set_defaults(func=cmd_kill)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
