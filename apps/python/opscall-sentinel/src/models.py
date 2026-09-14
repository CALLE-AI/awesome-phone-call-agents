from __future__ import annotations

import time
import hashlib
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class IncidentSeverity(str, Enum):
    P0_CRITICAL = "P0"
    P1_HIGH = "P1"
    P2_MEDIUM = "P2"


class IncidentState(str, Enum):
    # Primary lifecycle states
    UNASSIGNED = "UNASSIGNED"
    CALLING_PRIMARY = "CALLING_PRIMARY"
    PRIMARY_CONNECTED = "PRIMARY_CONNECTED"
    PRIMARY_VERIFIED = "PRIMARY_VERIFIED"
    PRIMARY_ACKNOWLEDGED = "PRIMARY_ACKNOWLEDGED"
    PRIMARY_UNAVAILABLE = "PRIMARY_UNAVAILABLE"
    ESCALATING = "ESCALATING"
    CALLING_SECONDARY = "CALLING_SECONDARY"
    SECONDARY_CONNECTED = "SECONDARY_CONNECTED"
    SECONDARY_VERIFIED = "SECONDARY_VERIFIED"
    SECONDARY_ACKNOWLEDGED = "SECONDARY_ACKNOWLEDGED"
    OWNERSHIP_ESTABLISHED = "OWNERSHIP_ESTABLISHED"
    ESCALATION_EXHAUSTED = "ESCALATION_EXHAUSTED"

    # Compatibility aliases
    TRIGGERED = "TRIGGERED"
    DISPATCHING = "DISPATCHING"
    CALL_IN_PROGRESS = "CALL_IN_PROGRESS"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    ESCALATED = "ESCALATED"
    RESOLVED = "RESOLVED"
    FAILED = "FAILED"


class IncidentAction(str, Enum):
    ACKNOWLEDGE = "ACKNOWLEDGE"
    ESCALATE = "ESCALATE"
    TRIGGER_ROLLBACK = "TRIGGER_ROLLBACK"
    UNKNOWN = "UNKNOWN"


class IncidentAlert(BaseModel):
    id: str = Field(default_factory=lambda: f"INC-{int(time.time() * 1000) % 1000000:06d}")
    service: str
    severity: IncidentSeverity = IncidentSeverity.P0_CRITICAL
    title: str
    description: str
    cluster: str = "prod-us-east-1"
    runbook_url: Optional[str] = "https://wiki.corp.internal/runbooks/db-failover"
    timestamp: float = Field(default_factory=time.time)


class CallResultSchema(BaseModel):
    """Deterministic structured schema enforced on CALL-E voice agent runtime."""
    incident_id: str
    callee_name: str
    callee_verified: bool = True
    pin_matched: bool = True
    verdict: IncidentAction = IncidentAction.ACKNOWLEDGE
    spoken_eta_minutes: int = 0
    dtmf_key_pressed: Optional[str] = None
    call_duration_seconds: float = 0.0
    transcript_summary: str = ""
    outcome: str = "ownership_established"
    reason: Optional[str] = None
    call_completed: bool = True
    completion_confidence: float = 1.0
    notes: Optional[str] = None


class CallRecord(BaseModel):
    call_id: str
    to_phone: str
    status: str
    mode: str  # "mock" or "live"
    duration_seconds: float
    result: Optional[CallResultSchema] = None
    transcript: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)


class IncidentRecord(BaseModel):
    alert: IncidentAlert
    state: IncidentState = IncidentState.UNASSIGNED
    owner: str = "UNASSIGNED"
    assigned_engineer: str = "Primary On-Call SRE"
    phone_dialed: str
    escalation_level: int = 1
    calls: List[CallRecord] = Field(default_factory=list)
    state_history: List[Dict[str, Any]] = Field(default_factory=list)
    audit_hash: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def transition_to(self, new_state: IncidentState, detail: str = "") -> None:
        """Record an explicit state transition with timestamp and reason."""
        self.state = new_state
        self.updated_at = time.time()
        self.state_history.append({
            "state": new_state.value,
            "timestamp": self.updated_at,
            "detail": detail
        })
        self.audit_hash = self.compute_audit_hash()

    def compute_audit_hash(self) -> str:
        """Compute SHA-256 seal detecting modification of recorded evidence."""
        payload = f"{self.alert.id}|{self.state.value}|{self.owner}|{self.phone_dialed}|{self.updated_at}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
