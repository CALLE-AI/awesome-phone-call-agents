"""Typed domain models that do not depend on providers or persistence."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from types import MappingProxyType

from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus


def _require_aware(value: datetime | None, field_name: str) -> None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError(f"{field_name} must include a timezone")


_PHONE_LIKE_PATTERN = re.compile(r"(?<!\d)\+?[1-9]\d{7,14}(?!\d)")


def _freeze_json(value: object) -> object:
    """Return an immutable copy of a JSON-compatible value."""

    if isinstance(value, Mapping):
        frozen: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("JSON object keys must be strings")
            frozen[key] = _freeze_json(item)
        return MappingProxyType(frozen)
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item) for item in value)
    if isinstance(value, float) and not isfinite(value):
        raise ValueError("result_schema numbers must be finite")
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    raise TypeError("result_schema must contain only JSON-compatible values")


@dataclass(frozen=True, slots=True)
class SafetyInterviewResult:
    """Structured facts and assessment produced by an interview."""

    work_summary: str | None
    incident_level: IncidentLevel | None
    near_miss_occurred: bool | None
    equipment_issue_occurred: bool | None
    injury_or_health_issue: bool | None
    handover_notes: str | None
    requires_follow_up: bool | None
    confidence: float | None
    evidence: tuple[str, ...]
    summary: str

    def __post_init__(self) -> None:
        if self.incident_level is not None and not isinstance(self.incident_level, IncidentLevel):
            raise TypeError("incident_level must be an IncidentLevel or None")
        for field_name in (
            "near_miss_occurred",
            "equipment_issue_occurred",
            "injury_or_health_issue",
            "requires_follow_up",
        ):
            value = getattr(self, field_name)
            if value is not None and not isinstance(value, bool):
                raise TypeError(f"{field_name} must be a bool or None")
        if self.confidence is not None:
            if isinstance(self.confidence, bool) or not isinstance(self.confidence, (int, float)):
                raise TypeError("confidence must be a number or None")
            if not isfinite(float(self.confidence)) or not 0.0 <= self.confidence <= 1.0:
                raise ValueError("confidence must be between 0.0 and 1.0")
        if not isinstance(self.evidence, tuple) or not all(isinstance(item, str) for item in self.evidence):
            raise TypeError("evidence must be a tuple of strings")


@dataclass(slots=True)
class SafetyInterview:
    """Aggregate containing one planned or completed safety interview."""

    interview_id: str
    created_at: datetime
    scenario_name: str
    recipient_alias: str
    status: InterviewStatus = InterviewStatus.DRAFT
    call_provider: str = "fake"
    call_provider_run_id: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: SafetyInterviewResult | None = None
    failure_reason: str | None = None

    def __post_init__(self) -> None:
        if not self.interview_id.strip():
            raise ValueError("interview_id must not be empty")
        if not self.scenario_name.strip():
            raise ValueError("scenario_name must not be empty")
        if not self.recipient_alias.strip():
            raise ValueError("recipient_alias must not be empty")
        if not isinstance(self.status, InterviewStatus):
            raise TypeError("status must be an InterviewStatus")
        _require_aware(self.created_at, "created_at")
        _require_aware(self.started_at, "started_at")
        _require_aware(self.completed_at, "completed_at")


@dataclass(frozen=True, slots=True)
class CallPlan:
    """Provider-neutral, no-phone plan for one fictional safety interview."""

    plan_id: str
    scenario_name: str
    recipient_alias: str
    region: str
    language: str
    task: str
    result_schema: Mapping[str, object]
    created_at: datetime
    requires_human_confirmation: bool
    contains_real_phone_number: bool
    interview_id: str | None = None

    def __post_init__(self) -> None:
        if not self.plan_id.strip():
            raise ValueError("plan_id must not be empty")
        if not self.scenario_name.strip():
            raise ValueError("scenario_name must not be empty")
        if not self.recipient_alias.startswith(("demo-", "fictional-")):
            raise ValueError("recipient_alias must identify a fictional recipient")
        if self.region != "JP":
            raise ValueError("region must be JP")
        if self.language != "English":
            raise ValueError("language must be English")
        if not self.task.strip():
            raise ValueError("task must not be empty")
        if _PHONE_LIKE_PATTERN.search(self.task):
            raise ValueError("task must not contain a phone number")
        if not isinstance(self.result_schema, Mapping) or not self.result_schema:
            raise TypeError("result_schema must be a non-empty mapping")
        if self.requires_human_confirmation is not True:
            raise ValueError("requires_human_confirmation must be true")
        if self.contains_real_phone_number is not False:
            raise ValueError("contains_real_phone_number must be false")
        if self.interview_id is not None and not self.interview_id.strip():
            raise ValueError("interview_id must not be empty when provided")
        _require_aware(self.created_at, "created_at")
        object.__setattr__(self, "result_schema", _freeze_json(self.result_schema))
