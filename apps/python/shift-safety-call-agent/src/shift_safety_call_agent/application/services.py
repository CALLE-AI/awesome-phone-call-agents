"""Application orchestration and shared safety policy helpers."""

from collections.abc import Callable, Mapping
from datetime import datetime, timezone

from shift_safety_call_agent.application.ports import CallProvider, InterviewRepository
from shift_safety_call_agent.domain.enums import InterviewStatus
from shift_safety_call_agent.domain.models import SafetyInterview

DEFAULT_CALL_PROVIDER = "fake"
DEFAULT_ALLOW_REAL_CALLS = False
_REDACTED_KEYS = frozenset(
    {
        "api_key",
        "calle_api_key",
        "oauth_token",
        "access_token",
        "transcript",
        "recording",
        "personal_name",
        "recipient_name",
    }
)


def utc_now() -> datetime:
    """Return an aware UTC timestamp."""

    return datetime.now(timezone.utc)


def real_call_configuration_requested(settings: Mapping[str, str]) -> bool:
    """Detect a real-provider request; this does not authorize a call."""

    allow_flag = settings.get("ALLOW_REAL_CALLS", "false").strip().lower() == "true"
    provider_selected = settings.get("CALL_PROVIDER", DEFAULT_CALL_PROVIDER).strip().lower() == "calle"
    return allow_flag and provider_selected


def mask_phone_number(value: str) -> str:
    """Mask every digit except the final four digits."""

    digit_positions = [index for index, character in enumerate(value) if character.isdigit()]
    visible = set(digit_positions[-4:])
    return "".join(
        character if not character.isdigit() or index in visible else "*"
        for index, character in enumerate(value)
    )


def safe_log_context(values: Mapping[str, object]) -> dict[str, object]:
    """Return a shallow logging context with sensitive values removed."""

    result: dict[str, object] = {}
    for key, value in values.items():
        normalized = key.lower()
        if normalized in _REDACTED_KEYS:
            result[key] = "[REDACTED]"
        elif "phone" in normalized and isinstance(value, str):
            result[key] = mask_phone_number(value)
        else:
            result[key] = value
    return result


class InterviewService:
    """Execute one provider-neutral interview and store its final state."""

    def __init__(
        self,
        provider: CallProvider,
        repository: InterviewRepository,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._provider = provider
        self._repository = repository
        self._clock = clock

    def execute(self, interview: SafetyInterview) -> SafetyInterview:
        """Run an interview through the configured provider and save it once."""

        if self._provider.name != "fake":
            raise RuntimeError("Phase 1C-1 permits execution only through the fake call provider")
        if interview.status is not InterviewStatus.DRAFT:
            raise ValueError("Only a draft interview can be executed")

        interview.call_provider = self._provider.name
        interview.status = InterviewStatus.PLANNED
        plan = self._provider.create_plan(interview)
        interview.status = InterviewStatus.CALLING
        interview.started_at = self._clock()
        interview.call_provider_run_id = self._provider.start_call(plan)
        provider_status = self._provider.get_status(interview.call_provider_run_id)
        result = self._provider.get_result(interview.call_provider_run_id)

        if provider_status is InterviewStatus.COMPLETED and result is not None:
            interview.status = InterviewStatus.COMPLETED
            interview.result = result
        else:
            interview.status = InterviewStatus.FAILED
            interview.failure_reason = "The fake provider did not return a complete result"
        interview.completed_at = self._clock()
        self._repository.save(interview)
        return interview
