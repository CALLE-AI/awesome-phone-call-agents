"""Map domain aggregates to an explicitly limited public representation."""

from shift_safety_call_agent.adapters.web.schemas import (
    InterviewDetailResponse,
    InterviewSummaryResponse,
)
from shift_safety_call_agent.application.review_triage import (
    build_review_basis,
    build_suggested_human_actions,
    derive_interview_review_disposition,
)
from shift_safety_call_agent.domain.models import SafetyInterview


def to_interview_summary(interview: SafetyInterview) -> InterviewSummaryResponse:
    result = interview.result
    disposition = derive_interview_review_disposition(interview)
    return InterviewSummaryResponse(
        interview_id=interview.interview_id,
        created_at=interview.created_at,
        scenario_name=interview.scenario_name,
        recipient_alias=interview.recipient_alias,
        status=interview.status,
        incident_level=result.incident_level if result is not None else None,
        requires_follow_up=result.requires_follow_up if result is not None else None,
        provider=interview.call_provider,
        review_disposition=disposition,
    )


def to_interview_detail(interview: SafetyInterview) -> InterviewDetailResponse:
    result = interview.result
    disposition = derive_interview_review_disposition(interview)
    return InterviewDetailResponse(
        interview_id=interview.interview_id,
        created_at=interview.created_at,
        scenario_name=interview.scenario_name,
        recipient_alias=interview.recipient_alias,
        status=interview.status,
        provider=interview.call_provider,
        provider_run_id=interview.call_provider_run_id,
        started_at=interview.started_at,
        completed_at=interview.completed_at,
        failure_reason=interview.failure_reason,
        work_summary=result.work_summary if result is not None else None,
        incident_level=result.incident_level if result is not None else None,
        near_miss_occurred=result.near_miss_occurred if result is not None else None,
        equipment_issue_occurred=(
            result.equipment_issue_occurred if result is not None else None
        ),
        injury_or_health_issue=(
            result.injury_or_health_issue if result is not None else None
        ),
        handover_notes=result.handover_notes if result is not None else None,
        requires_follow_up=result.requires_follow_up if result is not None else None,
        confidence=result.confidence if result is not None else None,
        summary=result.summary if result is not None else None,
        evidence_count=len(result.evidence) if result is not None else 0,
        review_disposition=disposition,
        review_basis=build_review_basis(disposition, result),
        suggested_human_actions=build_suggested_human_actions(disposition, result),
    )
