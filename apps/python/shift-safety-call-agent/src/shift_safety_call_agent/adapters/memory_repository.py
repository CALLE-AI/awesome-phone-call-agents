"""In-memory interview repository with the shared persistence contract."""

from copy import deepcopy

from shift_safety_call_agent.application.repository_errors import DuplicateInterviewError
from shift_safety_call_agent.domain.models import SafetyInterview


class MemoryInterviewRepository:
    """Store defensive copies of interviews for the current process only."""

    def __init__(self) -> None:
        self._interviews: dict[str, SafetyInterview] = {}

    def save(self, interview: SafetyInterview) -> None:
        """Store a new interview and reject duplicate identifiers."""

        if interview.interview_id in self._interviews:
            raise DuplicateInterviewError("An interview with this identifier already exists")
        self._interviews[interview.interview_id] = deepcopy(interview)

    def get(self, interview_id: str) -> SafetyInterview | None:
        """Return a defensive copy of a stored interview."""

        interview = self._interviews.get(interview_id)
        return deepcopy(interview) if interview is not None else None

    def list(self) -> tuple[SafetyInterview, ...]:
        """Return newest interviews first and identifier ascending for ties."""

        ordered = sorted(self._interviews.values(), key=lambda item: item.interview_id)
        ordered.sort(key=lambda item: item.created_at, reverse=True)
        return tuple(deepcopy(interview) for interview in ordered)
