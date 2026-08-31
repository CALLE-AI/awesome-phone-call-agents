"""Ports that isolate the application from providers and persistence."""

from typing import Protocol

from shift_safety_call_agent.domain.enums import InterviewStatus
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterview, SafetyInterviewResult


class CallProvider(Protocol):
    """Provider-neutral operations needed to manage one call."""

    @property
    def name(self) -> str:
        """Return the stable provider name."""

    def create_plan(self, interview: SafetyInterview) -> CallPlan:
        """Create a call plan without starting a call."""

    def start_call(self, plan: CallPlan) -> str:
        """Start a planned call and return a provider run identifier."""

    def get_status(self, run_id: str) -> InterviewStatus:
        """Return the current provider-neutral status."""

    def get_result(self, run_id: str) -> SafetyInterviewResult | None:
        """Return a structured result when one is available."""

    def cancel_call(self, run_id: str) -> None:
        """Cancel a provider run when cancellation is supported."""


class InterviewRepository(Protocol):
    """Persistence operations required by the application service."""

    def save(self, interview: SafetyInterview) -> None:
        """Store a new interview without overwriting an existing identifier."""

    def get(self, interview_id: str) -> SafetyInterview | None:
        """Return an interview by identifier, if present."""

    def list(self) -> tuple[SafetyInterview, ...]:
        """Return newest interviews first and identifier ascending for equal times."""
