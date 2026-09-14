from __future__ import annotations

import time
import hashlib
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


def mask_phone(phone: Optional[str]) -> str:
    """Mask phone numbers to protect PII in logs, API responses, and client dashboards."""
    if not phone or not isinstance(phone, str):
        return "••••••••"
    clean = phone.strip()
    if len(clean) <= 5:
        return "••••••••"
    if clean.startswith("+"):
        prefix = clean[:3]
        suffix = clean[-3:]
        return f"{prefix} •••• •••{suffix}"
    suffix = clean[-3:]
    return f"•••• •••{suffix}"


class IncidentSeverity(str, Enum):
    P0_CRITICAL = "P0"
    P1_HIGH = "P1"
    P2_MEDIUM = "P2"


class IncidentState(str, Enum):
    # Primary lifecycle states
    UNASSIGNED = "UNASSIGNED"
    CALLING_PRIMARY = "CALLING_PRIMARY"
    PRIMARY_PENDING = "PRIMARY_PENDING"
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
    runbook_url: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


class CallResultSchema(BaseModel):
    incident_id: str
    callee_name: str
    callee_verified: bool
    pin_matched: bool
    verdict: IncidentAction
    spoken_eta_minutes: int = 0
    dtmf_key_pressed: Optional[str] = None
    call_duration_seconds: float = 0.0
    transcript_summary: str = ""
    outcome: str = "ownership_established"
    reason: str = ""
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

    @property
    def phone_dialed_masked(self) -> str:
        return mask_phone(self.phone_dialed)


# ==============================================================================
# Multi-Tenant & Open-Source CRM (Twenty CRM / n8n) Integration Schemas
# ==============================================================================

class TenantConfig(BaseModel):
    """Configuration for individual clients sharing a single OpsCall deployment."""
    tenant_id: str
    client_name: str
    vertical: str = "ecommerce"  # "ecommerce", "clinic", "sre", "leadgen", "custom"
    voice_agent_prompt: str = ""
    webhook_callback_url: Optional[str] = None  # e.g., n8n webhook URL
    crm_type: str = "twenty"  # "twenty", "hubspot", "webhook", "mock"
    crm_endpoint: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


class DispatchLeadRequest(BaseModel):
    """Incoming dispatch request from n8n or external CRM."""
    tenant_id: str = "default"
    lead_id: str = Field(default_factory=lambda: f"LEAD-{int(time.time() * 1000) % 1000000:06d}")
    customer_name: str
    customer_phone: str
    context: Dict[str, Any] = Field(default_factory=dict)
    callback_url: Optional[str] = None  # Overrides tenant webhook if specified


class DispatchLeadResponse(BaseModel):
    """Response returned immediately to n8n upon queuing or starting call."""
    success: bool
    task_id: str
    lead_id: str
    status: str
    callee: str
    phone: str
    message: str


class CRMCallbackPayload(BaseModel):
    """Structured callback payload delivered to n8n or Twenty CRM upon call completion."""
    tenant_id: str
    lead_id: str
    task_id: str
    status: str  # "COMPLETED", "FAILED", "NO_ANSWER"
    duration_seconds: float
    callee_name: str
    callee_phone: str
    verified: bool
    dtmf_key_pressed: Optional[str] = None
    spoken_intent: str = ""
    transcript_summary: str = ""
    audit_hash: str
    timestamp: float = Field(default_factory=time.time)
