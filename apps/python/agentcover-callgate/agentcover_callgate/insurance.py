"""Demo evidence summary from the in-memory audit trail.

This is an EXPERIMENTAL, IN-MEMORY demo. The audit trail is NOT a production
system of record and is NOT immutable/claims-ready. This module just summarizes
what the demo did so the walkthrough has something to show — it is not an
insurance product and must not be presented as one.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any


@dataclass
class DemoEvidenceBundle:
    agent_id: str
    user_id: str
    event_count: int
    allowed: int
    blocked: int
    chain_head: str
    claims_ready: bool
    summary: dict


def report(gate) -> DemoEvidenceBundle:
    """Build a demo summary from the live (in-memory) protocol state."""
    audit = gate.protocol.audit
    trail = audit._entries
    allowed = sum(1 for e in trail if e["event_type"] == "action_allowed")
    blocked = sum(1 for e in trail if e["event_type"].startswith("action_blocked"))
    dispatched = sum(1 for e in trail if e["event_type"] == "call_dispatched")

    # Re-derive a chain head over the in-memory entries (demo only).
    chain = hashlib.sha256(b"seed").hexdigest()
    for e in trail:
        chain = hashlib.sha256(
            (chain + json.dumps(e, sort_keys=True)).encode()
        ).hexdigest()

    return DemoEvidenceBundle(
        agent_id=gate.agent_id,
        user_id=gate.user_id,
        event_count=len(trail),
        allowed=allowed,
        blocked=blocked,
        chain_head=chain[:24],
        # EXPLICITLY False: this is an in-memory demo, not claims-ready.
        claims_ready=False,
        summary={
            "bound_agent": gate.agent_id,
            "owner": gate.user_id,
            "spent": gate.protocol._spent,
            "budget": gate.protocol.budget_limit,
            "calls_dispatched": dispatched,
            "calls_blocked": blocked,
            "protocol_state": gate.protocol._state.value,
            "chain_head": chain[:24],
            "disclaimer": "in-memory experimental demo; not a system of record",
        },
    )


def evidence_bundle(gate) -> dict[str, Any]:
    """Full, self-describing demo package (NOT an insurance claim)."""
    b = report(gate)
    return {
        "agentcover_demo_evidence": {
            "agent_id": b.agent_id,
            "user_id": b.user_id,
            "summary": b.summary,
            "experimental_audit_trail": gate.protocol.audit._entries,
            "claims_ready": b.claims_ready,
        }
    }
