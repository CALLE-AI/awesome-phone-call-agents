"""Minimal, self-contained enforcement engine for the AgentCover CALL-E demo.

This is a SMALL, FAITHFUL SUBSET of github.com/TheDub-lab/safety-protocol,
vendored into the app so it runs from a clean checkout with no external path
hacks and no network. The audit trail here is IN-MEMORY and EXPERIMENTAL — it
is NOT a production system of record and is NOT immutable/claims-ready. It
exists to show the gating shape (binding, scope, budget, kill switch) that a
real CALL-E deployment should sit behind.

Do not depend on this module outside the demo. For production use, point at the
real safety_protocol package and a durable audit store.
"""
from __future__ import annotations

import enum
import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any


class ProtocolState(enum.Enum):
    active = "active"
    frozen = "frozen"


class ActionOutcome(enum.Enum):
    allowed = "allowed"
    blocked_scope = "blocked_scope"
    blocked_budget = "blocked_budget"
    blocked_killswitch = "blocked_killswitch"
    pending_approval = "pending_approval"


@dataclass
class ActionRequest:
    action_type: str
    target: str
    params: dict = field(default_factory=dict)
    method: str = "POST"
    estimated_cost: float = 0.0
    urgency: str = "normal"
    request_id: str | None = None


@dataclass
class ActionResult:
    outcome: ActionOutcome
    request_id: str | None
    block_reason: str | None = None
    requires_approval_for: str | None = None


@dataclass
class ScopeRule:
    action_type: str
    allowed_targets: list[str]
    match: str = "exact"
    methods: list[str] = field(default_factory=lambda: ["POST"])
    param_schema: dict | None = None
    max_cost: float = 5.0
    requires_approval: bool = False


class AuditTrail:
    """In-memory, experimental event log. NOT durable, NOT a system of record."""

    def __init__(self) -> None:
        self._entries: list[dict] = []
        self._head_hash: str | None = None

    def append(self, event_type: str, agent_id: str, data: dict) -> str:
        entry = {
            "seq": len(self._entries),
            "event_type": event_type,
            "agent_id": agent_id,
            "data": data,
            "timestamp": time.time(),
            "prev_hash": self._head_hash,
        }
        entry["entry_hash"] = hashlib.sha256(
            json.dumps(entry, sort_keys=True, default=str).encode()
        ).hexdigest()[:16]
        self._entries.append(entry)
        self._head_hash = entry["entry_hash"]
        return entry["entry_hash"]

    def verify_integrity(self) -> list[str]:
        # Best-effort: in-memory only, can be mutated; this just re-checks the chain.
        broken: list[str] = []
        prev = None
        for e in self._entries:
            if e["prev_hash"] != prev:
                broken.append(e["seq"])
            prev = e["entry_hash"]
        return broken


def validate_params(params: dict, schema: dict) -> str | None:
    props = schema.get("properties", {})
    required = schema.get("required", [])
    for k in required:
        if k not in params:
            return f"missing required param: {k}"
    for k, v in params.items():
        spec = props.get(k)
        if spec is None:
            if not schema.get("additional_properties", True):
                return f"unexpected param: {k}"
            continue
        if spec.get("type") == "string" and "enum" in spec:
            if v not in spec["enum"]:
                return f"param {k} not in allowed values"
        if spec.get("type") == "integer":
            if not isinstance(v, int):
                return f"param {k} must be integer"
            if "minimum" in spec and v < spec["minimum"]:
                return f"param {k} below minimum"
            if "maximum" in spec and v > spec["maximum"]:
                return f"param {k} above maximum"
    return None


class SafetyProtocol:
    """Small, experimental enforcement layer. In-memory only."""

    def __init__(
        self,
        *,
        agent_id: str,
        user_id: str,
        scope_rules: list[ScopeRule],
        budget_limit: float,
        approval_threshold_cost: float = 10.0,
        allowed_action_types: list[str] | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.user_id = user_id
        self.scope_rules = scope_rules
        self.budget_limit = budget_limit
        self.approval_threshold_cost = approval_threshold_cost
        self.allowed_action_types = allowed_action_types or []
        self._spent = 0.0
        self._state = ProtocolState.active
        self._pending: list[dict] = []
        self.audit = AuditTrail()
        self.audit.append("binding", agent_id, {"owner": user_id})
        self.binding = {"agent_id": agent_id, "owner": user_id}

    def engage_killswitch(self, reason: str) -> None:
        self._state = ProtocolState.frozen
        self.audit.append("killswitch_engaged", self.agent_id, {"reason": reason})

    def disengage_killswitch(self) -> None:
        self._state = ProtocolState.active
        self.audit.append("killswitch_disengaged", self.agent_id, {})

    def get_pending_approvals(self) -> list[dict]:
        return list(self._pending)

    def execute(self, req: ActionRequest) -> ActionResult:
        # 1. kill switch
        if self._state == ProtocolState.frozen:
            self.audit.append("action_blocked_killswitch", self.agent_id,
                              {"target": req.target})
            return ActionResult(ActionOutcome.blocked_killswitch, req.request_id,
                                "protocol frozen (kill switch)")
        # 2. closed verb vocabulary
        if req.action_type not in self.allowed_action_types:
            self.audit.append("action_blocked_scope", self.agent_id,
                              {"reason": "unknown verb", "target": req.target})
            return ActionResult(ActionOutcome.blocked_scope, req.request_id,
                                "denied by default: unknown action verb")
        # 3. scope rule
        rule = next((r for r in self.scope_rules
                     if r.action_type == req.action_type), None)
        if rule is None:
            self.audit.append("action_blocked_scope", self.agent_id,
                              {"reason": "no rule", "target": req.target})
            return ActionResult(ActionOutcome.blocked_scope, req.request_id,
                                "denied by default: no scope rule")
        if req.target not in rule.allowed_targets:
            self.audit.append("action_blocked_scope", self.agent_id,
                              {"reason": "target not allowlisted", "target": req.target})
            return ActionResult(ActionOutcome.blocked_scope, req.request_id,
                                "denied by default: target not in allowlist")
        if req.method not in rule.methods:
            self.audit.append("action_blocked_scope", self.agent_id,
                              {"reason": "method", "target": req.target})
            return ActionResult(ActionOutcome.blocked_scope, req.request_id,
                                "denied by default: method not allowed")
        perr = validate_params(req.params, rule.param_schema or {})
        if perr:
            self.audit.append("action_blocked_scope", self.agent_id,
                              {"reason": perr, "target": req.target})
            return ActionResult(ActionOutcome.blocked_scope, req.request_id, perr)
        # 4. budget
        if self._spent + req.estimated_cost > self.budget_limit:
            self.audit.append("action_blocked_budget", self.agent_id,
                              {"target": req.target,
                               "spent": self._spent, "cost": req.estimated_cost})
            return ActionResult(ActionOutcome.blocked_budget, req.request_id,
                                "over budget")
        # 5. approval
        if rule.requires_approval or req.estimated_cost >= self.approval_threshold_cost:
            token = f"apr_{req.request_id or req.target}_{int(time.time())}"
            self._pending.append({"token": token, "target": req.target,
                                  "cost": req.estimated_cost})
            self.audit.append("action_pending_approval", self.agent_id,
                              {"target": req.target})
            return ActionResult(ActionOutcome.pending_approval, req.request_id,
                                "requires approval", requires_approval_for=token)
        # allow
        self._spent += req.estimated_cost
        self.audit.append("action_allowed", self.agent_id,
                          {"target": req.target, "cost": req.estimated_cost})
        return ActionResult(ActionOutcome.allowed, req.request_id)
