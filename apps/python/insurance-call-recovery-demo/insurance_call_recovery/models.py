from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Intent = Literal["claim_status", "billing", "renewal", "policy_service", "ambiguous"]
Status = Literal[
    "recovered",
    "partially_recovered",
    "no_answer",
    "refused",
    "ambiguous",
    "human_escalation_required",
]

@dataclass
class RecoveryTask:
    task_description: str
    task_type: Intent
    destination: str
    intended_outcome: str
    policy_or_claim_reference: str | None = None
    deadline: str | None = None
    previous_call_context: str | None = None

@dataclass
class Evidence:
    source: str
    verified: bool

@dataclass
class RecoveryResult:
    recovery_id: str
    status: Status
    intent: Intent
    task: str
    party_contacted: str
    outcome: dict[str, Any] = field(default_factory=dict)
    evidence: Evidence = field(default_factory=lambda: Evidence("phone_call", False))
    confidence: Literal["high", "medium", "low"] = "low"
    human_escalation_required: bool = False
    mode: str | None = None
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
