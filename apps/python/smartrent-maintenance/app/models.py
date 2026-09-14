"""Pydantic models for SmartRent Maintenance Coordinator."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ─── Enums ────────────────────────────────────────────────────────────────────

class IssueType(str, Enum):
    PLUMBING = "plumbing"
    ELECTRICAL = "electrical"
    HVAC = "hvac"
    APPLIANCE = "appliance"
    STRUCTURAL = "structural"
    PEST = "pest"
    OTHER = "other"


class Urgency(str, Enum):
    EMERGENCY = "emergency"
    URGENT = "urgent"
    ROUTINE = "routine"


class WorkflowState(str, Enum):
    CREATED = "created"
    TENANT_CALLING = "tenant_calling"
    TENANT_CALLED = "tenant_called"
    VENDOR_SEARCHING = "vendor_searching"
    VENDOR_FOUND = "vendor_found"
    TENANT_CONFIRMING = "tenant_confirming"
    TENANT_CONFIRMED = "tenant_confirmed"
    COMPLETED = "completed"
    FAILED = "failed"


class CallStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ─── Vendor ───────────────────────────────────────────────────────────────────

class Vendor(BaseModel):
    """A maintenance vendor in the roster."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str
    phone: str  # E.164 format
    specialties: list[str] = []
    region: str = "US"
    locale: str = "en-US"


# ─── Call Records ─────────────────────────────────────────────────────────────

class CallRecord(BaseModel):
    """A record of a CALL-E call."""
    call_id: Optional[str] = None
    call_type: str  # "tenant_intake", "vendor_dispatch", "tenant_confirm"
    phone: str
    status: CallStatus = CallStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    structured_result: Optional[dict[str, Any]] = None
    evidence: list[str] = []
    transcript: list[dict[str, Any]] = []
    task_completed: Optional[bool] = None
    confidence_score: Optional[float] = None
    confidence_label: Optional[str] = None
    recording_url: Optional[str] = None
    error: Optional[str] = None


# ─── Maintenance Request ─────────────────────────────────────────────────────

class MaintenanceRequest(BaseModel):
    """A maintenance request with full workflow state."""
    id: str = Field(default_factory=lambda: f"MR-{str(uuid.uuid4())[:6].upper()}")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Tenant info
    tenant_name: str
    tenant_phone: str  # E.164
    unit_number: str
    property_name: str = "SmartRent Demo Property"

    # Initial description (from form/web)
    initial_description: str = ""

    # Workflow state
    state: WorkflowState = WorkflowState.CREATED

    # Extracted details from tenant call
    issue_type: Optional[IssueType] = None
    urgency: Optional[Urgency] = None
    location_in_unit: Optional[str] = None
    access_instructions: Optional[str] = None
    additional_details: Optional[str] = None

    # Vendor assignment
    assigned_vendor: Optional[Vendor] = None
    vendor_eta: Optional[str] = None
    vendor_cost_estimate: Optional[str] = None

    # Confirmation
    tenant_confirmed: Optional[bool] = None
    simulate_cascade: bool = False

    # Call history
    calls: list[CallRecord] = []

    # Timeline events
    timeline: list[dict[str, Any]] = []

    def add_timeline_event(self, event: str, details: str = ""):
        self.timeline.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "details": details,
        })
        self.updated_at = datetime.now(timezone.utc)


# ─── API Request/Response Models ─────────────────────────────────────────────

class CreateRequestPayload(BaseModel):
    """API payload to create a new maintenance request."""
    tenant_name: str
    tenant_phone: str
    unit_number: str
    property_name: str = "SmartRent Demo Property"
    initial_description: str = ""
    simulate_cascade: bool = False


class RequestSummary(BaseModel):
    """Compact summary for dashboard listing."""
    id: str
    tenant_name: str
    unit_number: str
    state: WorkflowState
    issue_type: Optional[IssueType] = None
    urgency: Optional[Urgency] = None
    assigned_vendor: Optional[str] = None
    vendor_eta: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    call_count: int = 0


class DashboardData(BaseModel):
    """Aggregated dashboard data."""
    total_requests: int = 0
    active_requests: int = 0
    completed_requests: int = 0
    failed_requests: int = 0
    total_calls: int = 0
    requests: list[RequestSummary] = []


# ─── CALL-E Result Schemas ────────────────────────────────────────────────────

TENANT_INTAKE_RESULT_SCHEMA = {
    "type": "object",
    "required": ["issue_type", "urgency", "location_in_unit"],
    "properties": {
        "issue_type": {
            "type": "string",
            "enum": ["plumbing", "electrical", "hvac", "appliance", "structural", "pest", "other"],
            "description": "The category of the maintenance issue"
        },
        "urgency": {
            "type": "string",
            "enum": ["emergency", "urgent", "routine"],
            "description": "How urgently the issue needs to be addressed"
        },
        "location_in_unit": {
            "type": "string",
            "description": "Where in the unit the issue is located (e.g., kitchen, bathroom, bedroom)"
        },
        "access_instructions": {
            "type": "string",
            "description": "How the maintenance person can access the unit"
        },
        "additional_details": {
            "type": "string",
            "description": "Any additional details about the issue"
        }
    }
}

VENDOR_DISPATCH_RESULT_SCHEMA = {
    "type": "object",
    "required": ["available", "eta"],
    "properties": {
        "available": {
            "type": "string",
            "enum": ["yes", "no", "maybe"],
            "description": "Whether the vendor is available for this job"
        },
        "eta": {
            "type": "string",
            "description": "Estimated time of arrival (e.g., '2 hours', 'tomorrow morning', 'Thursday 3pm')"
        },
        "cost_estimate": {
            "type": "string",
            "description": "Estimated cost for the work"
        },
        "notes": {
            "type": "string",
            "description": "Any notes from the vendor"
        }
    }
}

TENANT_CONFIRM_RESULT_SCHEMA = {
    "type": "object",
    "required": ["confirmed"],
    "properties": {
        "confirmed": {
            "type": "string",
            "enum": ["yes", "no", "reschedule"],
            "description": "Whether the tenant confirms the vendor visit"
        },
        "preferred_time": {
            "type": "string",
            "description": "If rescheduling, the tenant's preferred time"
        },
        "notes": {
            "type": "string",
            "description": "Any additional notes from the tenant"
        }
    }
}
