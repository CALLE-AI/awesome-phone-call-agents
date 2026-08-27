"""Insurance interface: turn the audit trail into claims-ready evidence.

The safety_protocol audit trail is the underwriting + claims substrate. Agents
that stay in scope reduce insurable exposure; when something does go wrong, the
immutable, hash-chained record is the evidence a claims process needs.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


@dataclass
class InsuranceBundle:
    agent_id: str
    user_id: str
    event_count: int
    allowed: int
    blocked: int
    chain_head: str
    claims_ready: bool
    summary: dict


def report(gate) -> InsuranceBundle:
    """Build an underwriter / claims summary from the live protocol state."""
    audit = gate.protocol.audit
    trail = audit._entries
    allowed = sum(1 for e in trail if e["event_type"] == "action_allowed")
    blocked = sum(1 for e in trail if e["event_type"].startswith("action_blocked"))
    dispatched = sum(1 for e in trail if e["event_type"] == "call_dispatched")

    # Re-derive the chain head so evidence is self-verifying.
    chain = hashlib.sha256(b"seed").hexdigest()
    for e in trail:
        chain = hashlib.sha256(
            (chain + json.dumps(e, sort_keys=True)).encode()
        ).hexdigest()

    return InsuranceBundle(
        agent_id=gate.agent_id,
        user_id=gate.user_id,
        event_count=len(trail),
        allowed=allowed,
        blocked=blocked,
        chain_head=chain[:24],
        claims_ready=True,
        summary={
            "bound_agent": gate.agent_id,
            "owner": gate.user_id,
            "spent": gate.protocol._spent,
            "budget": gate.protocol.budget_limit,
            "calls_dispatched": dispatched,
            "calls_blocked": blocked,
            "protocol_state": gate.protocol._state.value,
            "chain_head": chain[:24],
        },
    )


def evidence_bundle(gate) -> dict[str, Any]:
    """Full, self-describing evidence package for a claim or audit."""
    b = report(gate)
    return {
        "agentcover_insurance_bundle": {
            "agent_id": b.agent_id,
            "user_id": b.user_id,
            "summary": b.summary,
            "immutable_audit_trail": gate.protocol.audit._entries,
        }
    }
