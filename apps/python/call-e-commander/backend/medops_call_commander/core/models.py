from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from .enums import AgentType, CallOutcome, ConsentStatus, PlanState


@dataclass
class EHREvent:
    event_type: str
    patient_id: str
    patient_phone: str       # E.164 — encrypted immediately on receipt, zeroed after use
    context: dict
    priority: str            # "routine" | "urgent"
    source_system: str       # "opendental" | "fhir_r4"
    received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class CallPlan:
    plan_id: str
    idempotency_key: str
    agent: AgentType
    patient_id: str
    phone_masked: str        # shown to admin only e.g. "+1... ... 8435"
    phone_e164: str          # encrypted at rest, zeroed post-dispatch
    script: str              # editable by admin before approval
    priority: str
    source_event: str
    state: PlanState = PlanState.CREATED
    dry_run: bool = True     # remains True until admin explicitly approves
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    dispatched_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    scrubbed_at: Optional[datetime] = None
    result_ref: Optional[str] = None  # opaque CALL-E result ID only

    def is_phi_scrubbed(self) -> bool:
        return self.scrubbed_at is not None

    def is_approvable(self) -> bool:
        return self.state == PlanState.PENDING_APPROVAL

    def is_dispatchable(self) -> bool:
        return (
            self.state == PlanState.APPROVED
            and not self.dry_run
            and self.approved_by is not None
            and self.approved_at is not None
        )


@dataclass
class CallResult:
    plan_id: str
    outcome: CallOutcome
    transcript_ref: str      # opaque CALL-E ID only — no content stored locally
    structured: dict         # e.g. {"rescheduled": True, "promise_date": "2026-08-10"}
    completed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AuditEntry:
    plan_id: str
    action: str
    agent_type: Optional[str] = None
    admin_id: Optional[str] = None
    reason: Optional[str] = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # Never add phone numbers, patient names, balances, or transcript content


def make_idempotency_key(
    patient_id: str,
    event_type: str,
    agent: AgentType,
    reference_id: str,
) -> str:
    payload = f"{patient_id}:{event_type}:{agent.value}:{reference_id}"
    return hashlib.sha256(payload.encode()).hexdigest()
