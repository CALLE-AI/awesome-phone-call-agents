import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class DepartmentEnum(str, Enum):
    ROADS_INFRASTRUCTURE = "Roads & Infrastructure"
    WATER_WASTEWATER = "Water & Wastewater"
    TRAFFIC_SIGNALS = "Traffic Signals & Lighting"
    FORESTRY_PARKS = "Urban Forestry & Parks"
    EMERGENCY_UTILITY_DISPATCH = "Emergency Utility & Multi-Agency Dispatch"


class TicketStatus(str, Enum):
    PENDING_OUTREACH = "PENDING_OUTREACH"
    CALL_IN_PROGRESS = "CALL_IN_PROGRESS"
    ESCALATED = "ESCALATED"
    RESOLVED = "RESOLVED"
    FIELD_DISPATCHED = "FIELD_DISPATCHED"
    FAILED_CONTACT = "FAILED_CONTACT"


class TicketSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL_EMERGENCY = "CRITICAL_EMERGENCY"


class CallOutcome(str, Enum):
    CONFIRMED_HAZARD = "CONFIRMED_HAZARD"
    RESOLVED_ON_CALL = "RESOLVED_ON_CALL"
    ESCALATED_TO_DEPARTMENT = "ESCALATED_TO_DEPARTMENT"
    NEEDS_ONSITE_SURVEY = "NEEDS_ONSITE_SURVEY"
    UNREACHABLE = "UNREACHABLE"


class CitizenContact(BaseModel):
    name: str = Field(..., description="Full name of the reporting citizen or onsite superintendent")
    phone_e164: str = Field(..., description="E.164 formatted phone number e.g. +14155552671")
    role: str = Field(default="Resident", description="Citizen, Field Tech, Property Manager, Police Liaison")
    language: str = Field(default="en-US", description="Preferred language code")


class EscalationDetail(BaseModel):
    source_department: DepartmentEnum
    target_department: DepartmentEnum
    reason: str
    urgency_level: TicketSeverity
    triggered_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)
    secondary_call_id: Optional[str] = None
    secondary_agent_summary: Optional[str] = None


class CallAuditLog(BaseModel):
    call_id: str
    agent_name: str
    agent_department: DepartmentEnum
    started_at: datetime.datetime
    completed_at: Optional[datetime.datetime] = None
    duration_seconds: Optional[int] = None
    status: str = "COMPLETED"
    transcript: Optional[str] = None
    structured_result: Optional[Dict[str, Any]] = None
    mid_call_tools_invoked: List[str] = Field(default_factory=list)


class CivicTicket(BaseModel):
    id: str = Field(..., description="Unique 311 municipal ticket ID e.g. TKT-2026-9041")
    title: str = Field(..., description="Short summary of issue e.g. 'Burst Water Pipe Near Substation'")
    description: str = Field(..., description="Detailed description filed initially")
    department: DepartmentEnum = Field(..., description="Responsible municipal department")
    location_address: str = Field(..., description="Street address or landmark")
    cross_streets: Optional[str] = None
    gps_coordinates: Optional[Dict[str, float]] = None
    severity: TicketSeverity = Field(default=TicketSeverity.MEDIUM)
    status: TicketStatus = Field(default=TicketStatus.PENDING_OUTREACH)
    reporter: CitizenContact
    authorization_code: Optional[str] = Field(default=None, description="Municipal permit or job auth code")
    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)
    updated_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)
    call_attempts: int = Field(default=0)
    audit_logs: List[CallAuditLog] = Field(default_factory=list)
    escalation_trail: List[EscalationDetail] = Field(default_factory=list)
    field_dispatch_notes: Optional[str] = None


# Structured Result Schema returned by CALL-E agent at the end of a voice call
class StructuredCallResult(BaseModel):
    incident_confirmed: bool = Field(..., description="Did the caller verify the incident is still active?")
    updated_severity: TicketSeverity = Field(..., description="Assessed severity after voice triage")
    identified_hazards: List[str] = Field(default_factory=list, description="List of immediate safety hazards")
    verified_cross_street: Optional[str] = Field(default=None, description="Verified intersection or cross street")
    access_code_or_gate: Optional[str] = Field(default=None, description="Gate code or access instructions for crew")
    department_escalation_needed: bool = Field(default=False, description="True if ticket requires inter-dept transfer")
    target_escalation_department: Optional[DepartmentEnum] = Field(default=None, description="Target department if escalated")
    escalation_reason: Optional[str] = Field(default=None, description="Why primary department cannot handle alone")
    call_summary: str = Field(..., description="Executive concise synopsis of conversation")
    action_items: List[str] = Field(default_factory=list, description="Immediate next steps for field dispatch")
    outcome: CallOutcome = Field(default=CallOutcome.CONFIRMED_HAZARD)


# Models for FastMCP Tool Calls
class AuthorizationQueryRequest(BaseModel):
    ticket_id: str
    auth_code: str


class AuthorizationQueryResponse(BaseModel):
    valid: bool
    issuer: str
    expiry_date: str
    permissions: List[str]
    message: str


class MidCallStatusUpdateRequest(BaseModel):
    ticket_id: str
    status: TicketStatus
    notes: str
    severity: Optional[TicketSeverity] = None


class MidCallStatusUpdateResponse(BaseModel):
    success: bool
    ticket_id: str
    applied_status: TicketStatus
    timestamp: str


class EscalationTriggerRequest(BaseModel):
    ticket_id: str
    source_department: DepartmentEnum
    target_department: DepartmentEnum
    reason: str
    urgency_level: TicketSeverity


class EscalationTriggerResponse(BaseModel):
    escalation_initiated: bool
    ticket_id: str
    secondary_agent_id: str
    message: str


# Webhook Payload received from CALL-E upon call lifecycle changes
class CalleWebhookPayload(BaseModel):
    event_type: str = Field(default="call.completed", description="call.started, call.completed, call.failed")
    call_id: str
    task: Optional[str] = None
    phone_number: str
    duration_seconds: int = 0
    transcript: Optional[str] = None
    structured_result: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
