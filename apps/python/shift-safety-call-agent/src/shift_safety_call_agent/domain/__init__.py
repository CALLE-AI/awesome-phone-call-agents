"""Domain types for safety interviews."""

from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterview, SafetyInterviewResult

__all__ = [
    "CallPlan",
    "IncidentLevel",
    "InterviewStatus",
    "SafetyInterview",
    "SafetyInterviewResult",
]
