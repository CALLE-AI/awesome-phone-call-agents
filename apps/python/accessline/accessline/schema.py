"""Structured output schema for AccessLine."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Literal

AccessibilityAnswer = Literal["yes", "no", "unknown"]
CompletionStatus = Literal["complete", "partial", "failed"]
SOURCE_TYPE = "phone_call"

QUESTION_FLOW_NOT_EXECUTED_MARKERS = (
    "not asked or answered",
    "questions were not asked",
    "accessibility questions were not",
    "question flow did not",
    "before the intended questions",
    "were not asked",
)

REQUIRED_RESULT_FIELDS = (
    "venue_name",
    "called_at",
    "step_free_entrance",
    "accessible_restroom",
    "access_instructions",
    "uncertainty_notes",
    "source_type",
    "completion_status",
)

VALID_ACCESSIBILITY_ANSWERS = frozenset({"yes", "no", "unknown"})
VALID_COMPLETION_STATUSES = frozenset({"complete", "partial", "failed"})


@dataclass(frozen=True)
class AccessLineInput:
    venue_name: str
    phone_number: str
    visit_date: str | None
    consent_confirmed: bool
    # Fresh live-call intent fields (required for live provider path; ignored by mock).
    live_run_id: str | None = None
    live_authorized_destination_e164: str | None = None
    live_action: str | None = None


@dataclass(frozen=True)
class AccessLineResult:
    venue_name: str
    called_at: str
    step_free_entrance: AccessibilityAnswer
    accessible_restroom: AccessibilityAnswer
    access_instructions: str | None
    uncertainty_notes: str
    source_type: Literal["phone_call"]
    completion_status: CompletionStatus

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def accessline_question_flow_executed(
    uncertainty_notes: str,
    call_task: dict[str, Any] | None = None,
) -> bool:
    lowered = uncertainty_notes.lower()
    if any(marker in lowered for marker in QUESTION_FLOW_NOT_EXECUTED_MARKERS):
        return False
    if call_task is not None and call_task.get("task_completed") is False:
        return False
    return True


def derive_accessline_completion_status(
    *,
    provider_status: str,
    structured: dict[str, Any] | None,
    uncertainty_notes: str,
    call_task: dict[str, Any] | None = None,
) -> CompletionStatus:
    if provider_status == "failed":
        return "failed"
    if provider_status == "canceled":
        return "failed"
    if not structured:
        return "partial" if provider_status == "completed" else "failed"
    if not accessline_question_flow_executed(uncertainty_notes, call_task):
        return "partial"
    if provider_status == "completed":
        return "complete"
    return "partial"


def is_valid_accessline_verification(result: AccessLineResult) -> bool:
    return result.completion_status == "complete"


def validate_result(payload: dict[str, Any]) -> AccessLineResult:
    if not isinstance(payload, dict):
        raise ValueError("result must be an object")
    missing = [field for field in REQUIRED_RESULT_FIELDS if field not in payload]
    if missing:
        raise ValueError(f"result missing fields: {missing}")
    if payload.get("source_type") != SOURCE_TYPE:
        raise ValueError("source_type must be phone_call")
    for field in ("step_free_entrance", "accessible_restroom"):
        value = payload.get(field)
        if value not in VALID_ACCESSIBILITY_ANSWERS:
            raise ValueError(f"{field} must be yes, no, or unknown")
    completion = payload.get("completion_status")
    if completion not in VALID_COMPLETION_STATUSES:
        raise ValueError("completion_status must be complete, partial, or failed")
    venue_name = str(payload.get("venue_name") or "").strip()
    if not venue_name:
        raise ValueError("venue_name is required")
    called_at = str(payload.get("called_at") or "").strip()
    if not called_at:
        raise ValueError("called_at is required")
    instructions = payload.get("access_instructions")
    if instructions is not None and not isinstance(instructions, str):
        raise ValueError("access_instructions must be a string or null")
    uncertainty = str(payload.get("uncertainty_notes") or "")
    return AccessLineResult(
        venue_name=venue_name,
        called_at=called_at,
        step_free_entrance=payload["step_free_entrance"],
        accessible_restroom=payload["accessible_restroom"],
        access_instructions=instructions,
        uncertainty_notes=uncertainty,
        source_type=SOURCE_TYPE,
        completion_status=completion,
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
