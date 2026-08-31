"""Offline CALL-E boundary with no SDK import, network access, or call path."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from math import isfinite

from shift_safety_call_agent.application.calle_planning import create_calle_plan
from shift_safety_call_agent.application.services import utc_now
from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterview, SafetyInterviewResult

_KNOWN_STATUSES = frozenset({"queued", "in_progress", "completed", "failed", "canceled"})
_TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})
_TRI_STATES = frozenset({"yes", "no", "unknown"})
_INCIDENT_LEVELS = frozenset(level.value for level in IncidentLevel)
_STRUCTURED_FIELDS = frozenset(
    {
        "work_summary",
        "incident_level",
        "near_miss_status",
        "equipment_issue_status",
        "injury_or_health_status",
        "handover_notes",
        "requires_follow_up_status",
        "evidence",
        "summary",
    }
)


class CalleAdapterError(ValueError):
    """Base error for safe offline CALL-E boundary failures."""


class InvalidProviderResponseError(CalleAdapterError):
    """Raised when required confirmed response fields have invalid types."""


class UnknownProviderStatusError(CalleAdapterError):
    """Raised when CALL-E returns a status not in the confirmed contract."""


class InvalidStructuredResultError(CalleAdapterError):
    """Raised when a non-null structured result violates the local contract."""


class RealCallDisabledError(RuntimeError):
    """Raised whenever code attempts to cross the real-call boundary."""


class CalleSdkNotConnectedError(RuntimeError):
    """Raised when an operation requires the deliberately absent CALL-E SDK."""


@dataclass(frozen=True, slots=True)
class CompletionConfidenceSnapshot:
    """Structurally confirmed SDK 0.6.0 confidence fields, without interpretation."""

    score: float
    label: str


@dataclass(frozen=True, slots=True)
class CalleRecipientSnapshot:
    """Selected recipient facts with phone and transcript fields deliberately omitted."""

    provider_id: str | None
    raw_status: str | None
    structured_result: Mapping[str, object] | None
    summary: str | None


@dataclass(frozen=True, slots=True)
class CalleResponseSnapshot:
    """Minimal validated CALL-E response used only inside the adapter."""

    raw_status: str
    task_completed: bool | None
    completion_confidence: CompletionConfidenceSnapshot | None
    structured_result: Mapping[str, object] | None
    evidence: tuple[str, ...]
    provider_id: str | None = None
    summary: str | None = None
    recipient_result: CalleRecipientSnapshot | None = None


def _parse_completion_confidence(value: object) -> CompletionConfidenceSnapshot | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise InvalidProviderResponseError("Completion confidence has an invalid type")
    score = value.get("score")
    label = value.get("label")
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        raise InvalidProviderResponseError("Completion confidence score has an invalid type")
    numeric_score = float(score)
    if not isfinite(numeric_score) or not 0.0 <= numeric_score <= 1.0:
        raise InvalidProviderResponseError("Completion confidence score is out of range")
    if not isinstance(label, str):
        raise InvalidProviderResponseError("Completion confidence label has an invalid type")
    return CompletionConfidenceSnapshot(score=numeric_score, label=label)


def parse_calle_response(payload: object) -> CalleResponseSnapshot:
    """Validate confirmed CALL-E fields while ignoring unrelated fields."""

    if not isinstance(payload, Mapping):
        raise InvalidProviderResponseError("Provider response must be an object")

    status = payload.get("status")
    task_completed = payload.get("task_completed")
    structured_result = payload.get("structured_result")
    evidence = payload.get("evidence")
    provider_id = payload.get("id")
    summary = payload.get("summary")
    recipients = payload.get("recipients")

    if not isinstance(status, str) or not status:
        raise InvalidProviderResponseError("Provider status has an invalid type")
    if task_completed is not None and not isinstance(task_completed, bool):
        raise InvalidProviderResponseError("Task completion has an invalid type")
    if structured_result is not None and not isinstance(structured_result, Mapping):
        raise InvalidStructuredResultError("Structured result must be an object or null")
    if not isinstance(evidence, list) or not all(isinstance(item, str) for item in evidence):
        raise InvalidProviderResponseError("Provider evidence has an invalid type")
    if provider_id is not None and not isinstance(provider_id, str):
        raise InvalidProviderResponseError("Provider identifier has an invalid type")
    if summary is not None and not isinstance(summary, str):
        raise InvalidProviderResponseError("Provider summary has an invalid type")

    recipient_result = _parse_recipient_result(recipients)

    copied_result = dict(structured_result) if structured_result is not None else None
    return CalleResponseSnapshot(
        raw_status=status,
        task_completed=task_completed,
        completion_confidence=_parse_completion_confidence(payload.get("completion_confidence")),
        structured_result=copied_result,
        evidence=tuple(evidence),
        provider_id=provider_id,
        summary=summary,
        recipient_result=recipient_result,
    )


def _parse_recipient_result(value: object) -> CalleRecipientSnapshot | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise InvalidProviderResponseError("Provider recipients have an invalid type")
    if not value:
        return None
    recipient = value[0]
    if not isinstance(recipient, Mapping):
        raise InvalidProviderResponseError("Provider recipient has an invalid type")

    provider_id = recipient.get("id")
    status = recipient.get("status")
    structured_result = recipient.get("structured_result")
    summary = recipient.get("summary")
    if provider_id is not None and not isinstance(provider_id, str):
        raise InvalidProviderResponseError("Recipient identifier has an invalid type")
    if status is not None and not isinstance(status, str):
        raise InvalidProviderResponseError("Recipient status has an invalid type")
    if structured_result is not None and not isinstance(structured_result, Mapping):
        raise InvalidStructuredResultError("Recipient structured result must be an object or null")
    if summary is not None and not isinstance(summary, str):
        raise InvalidProviderResponseError("Recipient summary has an invalid type")
    return CalleRecipientSnapshot(
        provider_id=provider_id,
        raw_status=status,
        structured_result=dict(structured_result) if structured_result is not None else None,
        summary=summary,
    )


def _require_string(values: Mapping[str, object], field_name: str) -> str:
    value = values[field_name]
    if not isinstance(value, str):
        raise InvalidStructuredResultError("Structured result contains an invalid field type")
    return value


def _status_to_bool(value: str) -> bool | None:
    if value == "yes":
        return True
    if value == "no":
        return False
    return None


def _nullable_text(value: str) -> str | None:
    stripped = value.strip()
    return None if not stripped or stripped.lower() == "unknown" else stripped


def _validate_structured_result(values: Mapping[str, object]) -> None:
    if set(values) != _STRUCTURED_FIELDS:
        raise InvalidStructuredResultError("Structured result is missing required fields")
    for field_name in (
        "work_summary",
        "incident_level",
        "near_miss_status",
        "equipment_issue_status",
        "injury_or_health_status",
        "handover_notes",
        "requires_follow_up_status",
        "summary",
    ):
        _require_string(values, field_name)
    if values["incident_level"] not in _INCIDENT_LEVELS:
        raise InvalidStructuredResultError("Structured result contains an invalid incident level")
    for field_name in (
        "near_miss_status",
        "equipment_issue_status",
        "injury_or_health_status",
        "requires_follow_up_status",
    ):
        if values[field_name] not in _TRI_STATES:
            raise InvalidStructuredResultError("Structured result contains an invalid status value")
    evidence = values["evidence"]
    if not isinstance(evidence, list) or not all(isinstance(item, str) for item in evidence):
        raise InvalidStructuredResultError("Structured result evidence has an invalid type")


def _unknown_result(snapshot: CalleResponseSnapshot, summary: str) -> SafetyInterviewResult:
    return SafetyInterviewResult(
        work_summary=None,
        incident_level=IncidentLevel.UNKNOWN,
        near_miss_occurred=None,
        equipment_issue_occurred=None,
        injury_or_health_issue=None,
        handover_notes=None,
        requires_follow_up=None,
        confidence=None,
        evidence=snapshot.evidence,
        summary=summary,
    )


def map_calle_response(snapshot: CalleResponseSnapshot) -> SafetyInterviewResult:
    """Map a validated snapshot without converting absence into a safe result."""

    if snapshot.raw_status not in _KNOWN_STATUSES:
        raise UnknownProviderStatusError("Provider returned an unknown status")
    if snapshot.raw_status not in _TERMINAL_STATUSES:
        raise InvalidProviderResponseError("Provider response is not terminal")
    if snapshot.raw_status != "completed":
        return _unknown_result(snapshot, "The provider did not complete the safety interview.")
    if snapshot.task_completed is not True:
        return _unknown_result(snapshot, "The call ended without completing the safety interview task.")
    if snapshot.structured_result is None:
        return _unknown_result(snapshot, "No schema-valid structured result was provided.")
    if not snapshot.evidence:
        return _unknown_result(snapshot, "The result did not include supporting evidence.")

    values = snapshot.structured_result
    _validate_structured_result(values)
    structured_evidence = values["evidence"]
    assert isinstance(structured_evidence, list)
    combined_evidence = tuple(dict.fromkeys((*snapshot.evidence, *structured_evidence)))
    return SafetyInterviewResult(
        work_summary=_nullable_text(_require_string(values, "work_summary")),
        incident_level=IncidentLevel(_require_string(values, "incident_level")),
        near_miss_occurred=_status_to_bool(_require_string(values, "near_miss_status")),
        equipment_issue_occurred=_status_to_bool(_require_string(values, "equipment_issue_status")),
        injury_or_health_issue=_status_to_bool(_require_string(values, "injury_or_health_status")),
        handover_notes=_nullable_text(_require_string(values, "handover_notes")),
        requires_follow_up=_status_to_bool(_require_string(values, "requires_follow_up_status")),
        # Phase 1C-2 confirms the structure only; it adds no safety meaning.
        confidence=None,
        evidence=combined_evidence,
        summary=_require_string(values, "summary"),
    )


def convert_calle_response(payload: object) -> SafetyInterviewResult:
    """Parse and map one CALL-E-shaped response without retaining raw data."""

    return map_calle_response(parse_calle_response(payload))


class OfflineCalleAdapter:
    """CallProvider-shaped adapter core that cannot contact CALL-E."""

    name = "calle-offline"

    def __init__(
        self,
        id_generator: Callable[[], str],
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._id_generator = id_generator
        self._clock = clock

    def create_plan(self, interview: SafetyInterview) -> CallPlan:
        """Create a local plan without importing or contacting CALL-E."""

        return create_calle_plan(
            interview.scenario_name,
            interview.recipient_alias,
            interview_id=interview.interview_id,
            id_generator=self._id_generator,
            clock=self._clock,
        )

    def start_call(self, plan: CallPlan) -> str:
        """Refuse the unavailable real-call operation."""

        raise RealCallDisabledError("Real calls are disabled in Phase 1C-1")

    def get_status(self, run_id: str) -> InterviewStatus:
        """Refuse provider status access while the SDK is absent."""

        raise CalleSdkNotConnectedError("CALL-E SDK is not connected in Phase 1C-1")

    def get_result(self, run_id: str) -> SafetyInterviewResult | None:
        """Refuse provider result access while the SDK is absent."""

        raise CalleSdkNotConnectedError("CALL-E SDK is not connected in Phase 1C-1")

    def cancel_call(self, run_id: str) -> None:
        """Refuse cancellation because no SDK operation is connected."""

        raise CalleSdkNotConnectedError("CALL-E SDK is not connected in Phase 1C-1")

    @staticmethod
    def map_response(payload: object) -> SafetyInterviewResult:
        """Convert a CALL-E-shaped offline fixture to a domain result."""

        return convert_calle_response(payload)
