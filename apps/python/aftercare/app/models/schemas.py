from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Literal

from app.core.datetimes import to_naive_utc
from app.core.redact import mask_phone
from app.utils.validators import E164_PATTERN, is_supported_e164
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

RiskLevelLiteral = Literal["low", "medium", "high", "critical"]
FollowUpStatusLiteral = Literal[
    "pending", "in_progress", "completed", "failed", "cancelled"
]
E164_RE = re.compile(E164_PATTERN)


def _normalize_optional_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return to_naive_utc(value)


def _patient_read_payload(value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, dict):
        data = dict(value)
        phone = data.pop("phone", None)
        doctor = data.pop("doctor_contact", None)
        data.pop("discharge_diagnosis", None)
        if phone:
            data["phone_masked"] = mask_phone(phone)
        elif not data.get("phone_masked"):
            data["phone_masked"] = "[redacted]"
        if doctor:
            data["doctor_contact_masked"] = mask_phone(doctor)
        elif "doctor_contact_masked" not in data:
            data["doctor_contact_masked"] = None
        return data
    phone = getattr(value, "phone", None)
    doctor = getattr(value, "doctor_contact", None)
    return {
        "id": getattr(value, "id", None),
        "name": getattr(value, "name", None),
        "phone_masked": mask_phone(phone) if phone else "[redacted]",
        "age": getattr(value, "age", None),
        "gender": getattr(value, "gender", None),
        "doctor_name": getattr(value, "doctor_name", None),
        "doctor_contact_masked": mask_phone(doctor) if doctor else None,
        "discharge_date": getattr(value, "discharge_date", None),
        "current_risk_level": getattr(value, "current_risk_level", None) or "low",
        "consent_on_file": getattr(value, "consent_on_file", False),
        "protocol_id": getattr(value, "protocol_id", None),
        "needs_followup": bool(getattr(value, "needs_followup", False)),
    }


# --- Auth schemas ---

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    is_active: bool
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthRegisterResponse(BaseModel):
    user: UserRead
    tokens: TokenPair


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


# --- Protocol schemas ---

class ProtocolQuestionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_text: str
    sort_order: int
    is_required: bool
    is_active: bool


class ProtocolEmergencyKeywordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    keyword: str
    is_active: bool


class ProtocolResultFieldEnumRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    value: str
    sort_order: int


class ProtocolResultFieldRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    field_key: str
    field_type: str
    description: str | None = None
    is_required: bool
    sort_order: int
    minimum: int | None = None
    maximum: int | None = None
    is_active: bool
    enums: list[ProtocolResultFieldEnumRead] = []


class DiseaseProtocolListItem(BaseModel):
    """Dropdown item for frontend."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None = None
    needs_followup_default: bool


class DiseaseProtocolDetail(BaseModel):
    """Full protocol preview + generated CALL-E schema."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: str | None = None
    needs_followup_default: bool
    is_active: bool
    questions: list[ProtocolQuestionRead] = []
    emergency_keywords: list[ProtocolEmergencyKeywordRead] = []
    result_fields: list[ProtocolResultFieldRead] = []
    result_schema_preview: dict[str, Any] | None = None


class ProtocolQuestionCreate(BaseModel):
    question_text: str = Field(..., min_length=1, max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=1000)
    is_required: bool = True


class ProtocolEmergencyKeywordCreate(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=255)


class ProtocolResultFieldEnumCreate(BaseModel):
    value: str = Field(..., min_length=1, max_length=128)
    sort_order: int = Field(default=0, ge=0, le=1000)


class ProtocolResultFieldCreate(BaseModel):
    field_key: str = Field(..., min_length=1, max_length=128)
    field_type: Literal["string", "integer", "boolean", "number"] = Field(
        ...,
        description="string | integer | boolean | number",
    )
    description: str | None = Field(default=None, max_length=2000)
    is_required: bool = True
    sort_order: int = Field(default=0, ge=0, le=1000)
    minimum: int | None = None
    maximum: int | None = None
    enums: list[ProtocolResultFieldEnumCreate] = Field(
        default_factory=list, max_length=50
    )


class DiseaseProtocolCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    needs_followup_default: bool = True
    is_active: bool = True
    questions: list[ProtocolQuestionCreate] = Field(..., min_length=1, max_length=50)
    emergency_keywords: list[ProtocolEmergencyKeywordCreate] = Field(
        default_factory=list, max_length=100
    )
    result_fields: list[ProtocolResultFieldCreate] = Field(
        ..., min_length=1, max_length=50
    )


class DiseaseProtocolUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    needs_followup_default: bool = True
    is_active: bool = True
    questions: list[ProtocolQuestionCreate] = Field(..., min_length=1, max_length=50)
    emergency_keywords: list[ProtocolEmergencyKeywordCreate] = Field(
        default_factory=list, max_length=100
    )
    result_fields: list[ProtocolResultFieldCreate] = Field(
        ..., min_length=1, max_length=50
    )


# --- Patient schemas ---

class PatientCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str = Field(
        ...,
        description="ASCII E.164 phone, eg: +15555550100",
        pattern=E164_PATTERN,
        max_length=32,
    )
    age: int | None = Field(default=None, ge=0, le=130)
    gender: str | None = Field(default=None, max_length=50)
    doctor_name: str | None = Field(default=None, max_length=255)
    doctor_contact: str | None = Field(default=None, max_length=32)
    discharge_date: date | None = None
    discharge_diagnosis: str | None = Field(default=None, max_length=4000)
    consent_on_file: bool = False
    protocol_id: int = Field(..., gt=0)
    needs_followup: bool = False
    followup_scheduled_time: datetime | None = None

    @field_validator("phone")
    @classmethod
    def validate_patient_phone(cls, value: str) -> str:
        if not is_supported_e164(value):
            raise ValueError(
                "phone must be a supported ASCII E.164 number, eg: +15555550100"
            )
        return value

    @field_validator("doctor_contact")
    @classmethod
    def validate_doctor_contact(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not is_supported_e164(value):
            raise ValueError(
                "doctor_contact must be a supported ASCII E.164 number, eg: +15555550101"
            )
        return value

    @field_validator("followup_scheduled_time")
    @classmethod
    def normalize_followup_time(cls, value: datetime | None) -> datetime | None:
        return _normalize_optional_utc(value)


class PatientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone_masked: str
    age: int | None = None
    gender: str | None = None
    doctor_name: str | None = None
    doctor_contact_masked: str | None = None
    discharge_date: date | None = None
    current_risk_level: RiskLevelLiteral | str
    consent_on_file: bool
    protocol_id: int | None = None
    needs_followup: bool = False

    @model_validator(mode="before")
    @classmethod
    def mask_contact_fields(cls, value: Any) -> Any:
        return _patient_read_payload(value)


# --- Follow-up / call / webhook schemas ---

class FollowUpCreate(BaseModel):
    patient_id: int = Field(..., gt=0)
    scheduled_time: datetime
    max_attempts: int = Field(default=3, ge=1, le=10)

    @field_validator("scheduled_time")
    @classmethod
    def normalize_scheduled_time(cls, value: datetime) -> datetime:
        return to_naive_utc(value)


class FollowUpRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    scheduled_time: datetime
    status: FollowUpStatusLiteral | str
    attempt_count: int
    max_attempts: int


class CallTriggerRequest(BaseModel):
    patient_id: int = Field(..., gt=0)
    followup_id: int | None = Field(default=None, gt=0)
    dry_run: bool = True
    authorized_destination: str | None = Field(default=None, max_length=32)

    @field_validator("authorized_destination")
    @classmethod
    def validate_authorized_destination(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not is_supported_e164(value):
            raise ValueError(
                "authorized_destination must be a supported ASCII E.164 number, "
                "eg: +15555550100"
            )
        return value


class DoctorAlertRequest(BaseModel):
    dry_run: bool = True
    authorized_destination: str | None = Field(default=None, max_length=32)

    @field_validator("authorized_destination")
    @classmethod
    def validate_authorized_destination(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not is_supported_e164(value):
            raise ValueError(
                "authorized_destination must be a supported ASCII E.164 number, "
                "eg: +15555550100"
            )
        return value


class DoctorAlertChannelRead(BaseModel):
    channel: str
    status: str
    attempt_count: int


class DoctorAlertRead(BaseModel):
    call_id: int
    channels: list[DoctorAlertChannelRead]


class CallRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    followup_id: int | None = None
    calle_call_id: str | None = None
    status: str
    dry_run: bool
    call_start: datetime | None = None
    call_end: datetime | None = None


class TranscriptTurn(BaseModel):
    model_config = ConfigDict(extra="allow")

    offset_seconds: int | None = None
    speaker: str | None = Field(default=None, max_length=64)
    text: str | None = Field(default=None, max_length=8000)


class CalleWebhookData(BaseModel):
    """Terminal call task object under event.data."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(..., min_length=1, max_length=255)
    object: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, max_length=64)
    task: str | None = Field(default=None, max_length=20000)
    recipients: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    structured_result: dict[str, Any] | None = None
    summary: str | None = Field(default=None, max_length=8000)
    task_completed: bool | None = None
    metadata: dict[str, Any] | None = None
    failure_code: str | None = Field(default=None, max_length=128)
    failure_message: str | None = Field(default=None, max_length=2000)
    created_at: str | None = Field(default=None, max_length=64)
    completed_at: str | None = Field(default=None, max_length=64)


class CalleWebhookEvent(BaseModel):
    """Top-level CALL-E webhook event envelope."""
    model_config = ConfigDict(extra="allow")

    id: str = Field(..., min_length=1, max_length=255)
    type: str = Field(..., min_length=1, max_length=100)
    created_at: str | None = Field(default=None, max_length=64)
    data: CalleWebhookData

# --- Dashboard schemas ---

class RiskCountMap(BaseModel):
    low: int = 0
    medium: int = 0
    high: int = 0
    critical: int = 0


class DashboardSummary(BaseModel):
    patients_total: int
    patients_needing_followup: int
    patients_missing_consent: int
    patients_by_risk: RiskCountMap
    protocols_active: int
    protocols_total: int
    followups_pending: int
    followups_overdue: int
    calls_in_range: int
    emergencies_in_range: int
    live_calls_in_range: int
    dry_run_calls_in_range: int


class TimeSeriesPoint(BaseModel):
    date: str
    count: int


class NamedCount(BaseModel):
    key: str
    label: str | None = None
    count: int


class DashboardCharts(BaseModel):
    calls_per_day: list[TimeSeriesPoint]
    emergencies_per_day: list[TimeSeriesPoint]
    patients_by_risk: list[NamedCount]
    patients_by_protocol: list[NamedCount]
    calls_by_status: list[NamedCount]
    calls_by_risk: list[NamedCount]
    followups_by_status: list[NamedCount]


class AttentionPatientItem(BaseModel):
    id: int
    name: str
    risk_level: RiskLevelLiteral | str
    protocol_name: str | None = None
    needs_followup: bool = False


class AttentionFollowUpItem(BaseModel):
    id: int
    patient_id: int
    patient_name: str
    scheduled_time: datetime
    attempt_count: int


class AttentionEmergencyItem(BaseModel):
    id: int
    patient_id: int
    patient_name: str
    risk_level: str | None = None
    call_start: datetime | None = None


class DashboardAttention(BaseModel):
    high_risk_patients: list[AttentionPatientItem]
    overdue_followups: list[AttentionFollowUpItem]
    recent_emergencies: list[AttentionEmergencyItem]


class DashboardActivityItem(BaseModel):
    id: str
    type: str
    title: str
    subtitle: str | None = None
    occurred_at: datetime
    patient_id: int | None = None
    call_id: int | None = None
    followup_id: int | None = None
    severity: str | None = None


class DashboardOverview(BaseModel):
    generated_at: datetime
    range_days: int
    summary: DashboardSummary
    charts: DashboardCharts
    attention: DashboardAttention
    recent_activity: list[DashboardActivityItem]


# --- Agent schemas ---

class AgentMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=8000)


class AgentChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[AgentMessage] = Field(default_factory=list, max_length=40)


class AgentKpiItem(BaseModel):
    key: str
    label: str
    value: int | str


class AgentKpiGridBlock(BaseModel):
    type: Literal["kpi_grid"] = "kpi_grid"
    title: str
    items: list[AgentKpiItem]


class AgentPatientListItem(BaseModel):
    patient_id: int
    name: str | None = None
    risk_level: str | None = None
    protocol: str | None = None
    doctor_name: str | None = None
    discharge_date: date | None = None
    needs_followup: bool | None = None


class AgentPatientTableBlock(BaseModel):
    type: Literal["patient_table"] = "patient_table"
    title: str
    count: int
    description: str | None = None
    items: list[AgentPatientListItem]


class AgentSymptomItem(BaseModel):
    name: str
    severity: str | None = None


class AgentCallItem(BaseModel):
    call_id: int
    patient_id: int | None = None
    patient_name: str | None = None
    status: str | None = None
    risk_level: str | None = None
    is_emergency: bool | None = None
    call_start: datetime | None = None
    symptoms: list[AgentSymptomItem] = Field(default_factory=list)


class AgentEmergencyListBlock(BaseModel):
    type: Literal["emergency_list"] = "emergency_list"
    title: str
    count: int
    items: list[AgentCallItem]


class AgentPatientDetailItem(BaseModel):
    patient_id: int
    name: str
    phone_masked: str | None = None
    age: int | None = None
    gender: str | None = None
    doctor_name: str | None = None
    discharge_date: date | None = None
    risk_level: str | None = None
    needs_followup: bool | None = None
    consent_on_file: bool | None = None
    protocol: str | None = None


class AgentPatientDetailBlock(BaseModel):
    type: Literal["patient_detail"] = "patient_detail"
    title: str
    patient: AgentPatientDetailItem
    recent_calls: list[AgentCallItem] = Field(default_factory=list)


class AgentAmbiguousPatientsBlock(BaseModel):
    type: Literal["ambiguous_patients"] = "ambiguous_patients"
    title: str
    query: str
    count: int
    message: str
    candidates: list[AgentPatientListItem]


class AgentPatientSearchItem(AgentPatientListItem):
    context_text: str
    distance: float


class AgentPatientSearchBlock(BaseModel):
    type: Literal["patient_search_results"] = "patient_search_results"
    title: str
    query: str
    unavailable: bool = False
    reason: str | None = None
    items: list[AgentPatientSearchItem] = Field(default_factory=list)


class AgentCallSearchItem(AgentCallItem):
    context_text: str
    distance: float


class AgentCallSearchBlock(BaseModel):
    type: Literal["call_search_results"] = "call_search_results"
    title: str
    query: str
    unavailable: bool = False
    reason: str | None = None
    items: list[AgentCallSearchItem] = Field(default_factory=list)


class AgentNoticeBlock(BaseModel):
    type: Literal["notice"] = "notice"
    title: str
    message: str
    tone: Literal["info", "warning"] = "info"


AgentBlock = Annotated[
    AgentKpiGridBlock
    | AgentPatientTableBlock
    | AgentEmergencyListBlock
    | AgentPatientDetailBlock
    | AgentAmbiguousPatientsBlock
    | AgentPatientSearchBlock
    | AgentCallSearchBlock
    | AgentNoticeBlock,
    Field(discriminator="type"),
]


class AgentChatResponse(BaseModel):
    reply: str
    tool_calls_used: list[str] = Field(default_factory=list)
    blocks: list[AgentBlock] = Field(default_factory=list)
