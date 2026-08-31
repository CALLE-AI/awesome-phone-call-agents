"""Deterministic human-review triage over existing structured facts."""

from shift_safety_call_agent.domain.enums import (
    IncidentLevel,
    InterviewStatus,
    ReviewDisposition,
)
from shift_safety_call_agent.domain.models import SafetyInterview, SafetyInterviewResult


def derive_review_disposition(
    *,
    task_completed: bool,
    result: SafetyInterviewResult | None,
) -> ReviewDisposition:
    """Derive a review disposition without AI inference or safe-looking defaults."""

    if task_completed is not True or result is None:
        return ReviewDisposition.NOT_ASSESSED
    if result.requires_follow_up is True:
        return ReviewDisposition.ACTION_REQUIRED
    required_values = (
        result.incident_level,
        result.near_miss_occurred,
        result.equipment_issue_occurred,
        result.injury_or_health_issue,
        result.requires_follow_up,
    )
    if (
        any(value is None for value in required_values)
        or result.incident_level is IncidentLevel.UNKNOWN
        or not isinstance(result.work_summary, str)
        or not result.work_summary.strip()
        or result.work_summary.strip().lower() == "unknown"
        or not isinstance(result.handover_notes, str)
        or not result.handover_notes.strip()
        or result.handover_notes.strip().lower() == "unknown"
    ):
        return ReviewDisposition.NEEDS_CLARIFICATION
    if result.requires_follow_up is False:
        if (
            result.incident_level is not IncidentLevel.NONE
            or result.near_miss_occurred is not False
            or result.equipment_issue_occurred is not False
            or result.injury_or_health_issue is not False
        ):
            return ReviewDisposition.NEEDS_CLARIFICATION
        return ReviewDisposition.NO_IMMEDIATE_ACTION
    return ReviewDisposition.NEEDS_CLARIFICATION


def derive_interview_review_disposition(
    interview: SafetyInterview,
) -> ReviewDisposition:
    """Derive triage for a persisted interview without changing its schema."""

    task_completed = (
        interview.status is InterviewStatus.COMPLETED and interview.result is not None
    )
    return derive_review_disposition(
        task_completed=task_completed,
        result=interview.result,
    )


def build_review_basis(
    disposition: ReviewDisposition,
    result: SafetyInterviewResult | None,
) -> tuple[str, ...]:
    """Describe the fixed structured facts supporting the disposition."""

    if disposition is ReviewDisposition.NOT_ASSESSED:
        return ("Safety assessment could not be completed.",)
    if disposition is ReviewDisposition.NEEDS_CLARIFICATION:
        return (
            "Safety assessment could not be completed.",
            "Required answers are unavailable.",
        )
    assert result is not None
    if disposition is ReviewDisposition.ACTION_REQUIRED:
        basis: list[str] = []
        if result.near_miss_occurred is True:
            basis.append("Near miss reported: Yes.")
        if result.equipment_issue_occurred is True:
            basis.append("Equipment issue reported: Yes.")
        if result.injury_or_health_issue is True:
            basis.append("Injury or health issue reported: Yes.")
        basis.extend(
            (
                "Follow-up required: Yes.",
                f"Incident level: {result.incident_level.value.title()}.",
            )
        )
        return tuple(basis)
    return (
        "No reported near miss.",
        "No reported equipment issue.",
        "No reported injury or health issue.",
        "Follow-up not required.",
    )


def build_suggested_human_actions(
    disposition: ReviewDisposition,
    result: SafetyInterviewResult | None,
) -> tuple[str, ...]:
    """Return conservative actions supported directly by structured fields."""

    if disposition is ReviewDisposition.NEEDS_CLARIFICATION:
        return (
            "Contact the worker for the missing required answers.",
            "Do not treat this record as safety clearance.",
            "Complete human review after clarification.",
        )
    if disposition is not ReviewDisposition.ACTION_REQUIRED:
        return ()
    actions = ["Human review required."]
    if result is not None and result.equipment_issue_occurred is True:
        note = (result.handover_notes or "").lower()
        supports_hold_and_inspection = (
            "out of service" in note and "inspection" in note
        )
        if supports_hold_and_inspection:
            actions.extend(
                (
                    "Keep the fictional tool out of service.",
                    "Arrange human inspection before reuse.",
                )
            )
    return tuple(actions)
