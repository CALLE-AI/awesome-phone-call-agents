from __future__ import annotations

import re
import time
import hashlib
from enum import Enum
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse
from pydantic import BaseModel, Field, field_validator


def mask_phone(phone: Optional[str]) -> str:
    """Mask phone numbers to protect PII in logs, API responses, and client dashboards."""
    if not phone or not isinstance(phone, str):
        return "••••••••"
    clean = phone.strip()
    digits = re.sub(r"\D", "", clean)
    if len(digits) < 5:
        return "••••••••"
    if clean.startswith("+"):
        prefix = clean[:3]
        suffix = digits[-3:]
        return f"{prefix} •••• •••{suffix}"
    suffix = digits[-3:]
    return f"•••• •••{suffix}"


def sanitize_text(text: Optional[str]) -> str:
    """Mask nested phone numbers within unstructured text, transcripts, notes, errors, and summaries."""
    if not text or not isinstance(text, str):
        return text or ""
    # Pattern matching international and formatted ASCII phone numbers
    pattern = r"(\+[1-9]\d{0,3}[-.\s]?(?:\(\d{1,4}\)|\d{1,4})[-.\s]?\d{2,4}[-.\s]?\d{3,4}|\+[1-9]\d{6,14})"

    def _replacer(m: re.Match) -> str:
        raw_val = m.group(0)
        digits = re.sub(r"\D", "", raw_val)
        if len(digits) >= 7:
            return mask_phone(raw_val)
        return raw_val

    return re.sub(pattern, _replacer, text)


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

    def to_masked_copy(self) -> CallRecord:
        """Return a deep copy with all nested phone numbers and unstructured text sanitized."""
        copy_rec = self.model_copy(deep=True)
        copy_rec.to_phone = mask_phone(copy_rec.to_phone)
        if copy_rec.result:
            copy_rec.result.callee_name = sanitize_text(copy_rec.result.callee_name)
            copy_rec.result.transcript_summary = sanitize_text(copy_rec.result.transcript_summary)
            copy_rec.result.notes = sanitize_text(copy_rec.result.notes)
            copy_rec.result.reason = sanitize_text(copy_rec.result.reason)
            copy_rec.result.outcome = sanitize_text(copy_rec.result.outcome)
        copy_rec.transcript = [
            {
                **turn,
                "text": sanitize_text(str(turn.get("text", "")))
            }
            for turn in copy_rec.transcript
        ]
        return copy_rec

    def to_safe_dict(self) -> Dict[str, Any]:
        """Return serialized call record with all nested phone numbers and notes masked."""
        return self.to_masked_copy().model_dump()


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

    def to_masked_copy(self) -> IncidentRecord:
        """Return deep copy with all nested phones, state logs, errors, and transcripts masked."""
        copy_rec = self.model_copy(deep=True)
        copy_rec.phone_dialed = mask_phone(copy_rec.phone_dialed)
        copy_rec.alert.title = sanitize_text(copy_rec.alert.title)
        copy_rec.alert.description = sanitize_text(copy_rec.alert.description)
        copy_rec.state_history = [
            {
                **entry,
                "detail": sanitize_text(str(entry.get("detail", "")))
            }
            for entry in copy_rec.state_history
        ]
        copy_rec.calls = [c.to_masked_copy() for c in copy_rec.calls]
        return copy_rec

    def to_safe_dict(self) -> Dict[str, Any]:
        """Return serialized incident record with all nested phone numbers masked across transcripts & state logs."""
        return self.to_masked_copy().model_dump()


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

    @field_validator("crm_endpoint")
    @classmethod
    def validate_crm_endpoint_origin(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        parsed = urlparse(v)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower().strip("[]")
        is_loopback = host in ("localhost", "127.0.0.1", "::1")
        if scheme != "https" and not (scheme == "http" and is_loopback):
            raise ValueError(
                f"CRM endpoint '{v}' must use an approved HTTPS origin or local loopback. "
                "Plain remote HTTP is prohibited."
            )
        return v

    @field_validator("webhook_callback_url")
    @classmethod
    def validate_webhook_origin(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        parsed = urlparse(v)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower().strip("[]")
        is_loopback = host in ("localhost", "127.0.0.1", "::1", "n8n.internal")
        if scheme != "https" and not (scheme == "http" and is_loopback):
            raise ValueError(
                f"Webhook callback URL '{v}' must use an approved HTTPS origin or local loopback. "
                "Plain remote HTTP is prohibited."
            )
        return v


class DispatchLeadRequest(BaseModel):
    """Incoming dispatch request from n8n or external CRM."""
    tenant_id: str = "default"
    lead_id: str = Field(default_factory=lambda: f"LEAD-{int(time.time() * 1000) % 1000000:06d}")
    customer_name: str
    customer_phone: str
    context: Dict[str, Any] = Field(default_factory=dict)
    callback_url: Optional[str] = None  # Overrides tenant webhook if specified
    allow_external_callbacks: bool = False  # Disabled by default during simulation to prevent accidental mutation
    is_simulation: bool = True  # Explicit intent required for live mutation


class DispatchLeadResponse(BaseModel):
    """Response returned immediately to n8n upon queuing or starting call."""
    success: bool
    task_id: str
    lead_id: str
    status: str
    callee: str
    phone: str
    message: str
    is_simulated: bool = False


class CRMCallbackPayload(BaseModel):
    """Structured callback payload delivered to n8n or Twenty CRM upon call completion."""
    tenant_id: str
    lead_id: str
    task_id: str
    status: str  # "SIMULATED", "COMPLETED", "FAILED", "NO_ANSWER"
    duration_seconds: float
    callee_name: str
    callee_phone: str
    verified: bool
    dtmf_key_pressed: Optional[str] = None
    spoken_intent: str = ""
    transcript_summary: str = ""
    audit_hash: str
    is_simulated: bool = False
    timestamp: float = Field(default_factory=time.time)
