"""Explicit request and response DTOs for the local Web API."""

from datetime import datetime
from enum import StrEnum
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from shift_safety_call_agent.domain.enums import (
    IncidentLevel,
    InterviewStatus,
    ReviewDisposition,
)


_CONTROL_CHARACTER_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
_PHONE_LIKE_PATTERN = re.compile(r"(?<!\d)\+?[1-9]\d{7,14}(?!\d)")
_SEPARATED_PHONE_LIKE_PATTERN = re.compile(
    r"(?<!\d)(?:\+?\d[- ]?){7,14}\d(?!\d)"
)
_EMAIL_LIKE_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_FICTIONAL_ALIAS_PATTERN = re.compile(r"^(?:demo|fictional)-[A-Za-z0-9_-]+$")


class ApiModel(BaseModel):
    """Forbid accidental fields on every public API model."""

    model_config = ConfigDict(extra="forbid")


class FakeScenario(StrEnum):
    NO_INCIDENT = "no-incident"
    MINOR_NEAR_MISS = "minor-near-miss"
    EQUIPMENT_FOLLOW_UP = "equipment-follow-up"
    INCOMPLETE_ANSWERS = "incomplete-answers"


class ServiceInfoResponse(ApiModel):
    service: str
    version: str
    api_prefix: str
    provider: str
    real_calls_enabled: bool


class HealthResponse(ApiModel):
    status: str
    version: str
    storage: str
    provider: str
    real_calls_enabled: bool


class ScenarioResponse(ApiModel):
    id: FakeScenario
    display_name: str
    description: str


class FakeInterviewRequest(ApiModel):
    scenario: FakeScenario
    recipient_alias: str = Field(default="demo-worker", min_length=5, max_length=64)

    @field_validator("recipient_alias")
    @classmethod
    def validate_fictional_alias(cls, value: str) -> str:
        if _CONTROL_CHARACTER_PATTERN.search(value):
            raise ValueError("recipient_alias contains a control character")
        if _PHONE_LIKE_PATTERN.search(value) or _SEPARATED_PHONE_LIKE_PATTERN.search(
            value
        ):
            raise ValueError("recipient_alias must not resemble a phone number")
        if _EMAIL_LIKE_PATTERN.fullmatch(value):
            raise ValueError("recipient_alias must not resemble an email address")
        if not _FICTIONAL_ALIAS_PATTERN.fullmatch(value):
            raise ValueError("recipient_alias must be a fictional alias")
        return value


class InterviewSummaryResponse(ApiModel):
    interview_id: str
    created_at: datetime
    scenario_name: str
    recipient_alias: str
    status: InterviewStatus
    incident_level: IncidentLevel | None
    requires_follow_up: bool | None
    provider: str
    review_disposition: ReviewDisposition


class InterviewDetailResponse(ApiModel):
    interview_id: str
    created_at: datetime
    scenario_name: str
    recipient_alias: str
    status: InterviewStatus
    provider: str
    provider_run_id: str | None
    started_at: datetime | None
    completed_at: datetime | None
    failure_reason: str | None
    work_summary: str | None
    incident_level: IncidentLevel | None
    near_miss_occurred: bool | None
    equipment_issue_occurred: bool | None
    injury_or_health_issue: bool | None
    handover_notes: str | None
    requires_follow_up: bool | None
    confidence: float | None
    summary: str | None
    evidence_count: int = Field(ge=0)
    review_disposition: ReviewDisposition
    review_basis: tuple[str, ...]
    suggested_human_actions: tuple[str, ...]


class ReviewCountsResponse(ApiModel):
    action_required: int = Field(ge=0)
    needs_clarification: int = Field(ge=0)
    no_immediate_action: int = Field(ge=0)
    not_assessed: int = Field(ge=0)


class InterviewListResponse(ApiModel):
    items: tuple[InterviewSummaryResponse, ...]
    count: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    review_counts: ReviewCountsResponse


class ErrorBody(ApiModel):
    code: str
    message: str


class ErrorResponse(ApiModel):
    error: ErrorBody
