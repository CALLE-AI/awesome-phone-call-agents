"""Deterministic, offline fake call provider."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from shift_safety_call_agent.application.calle_planning import (
    build_english_safety_task,
    build_safety_result_schema,
)
from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterview, SafetyInterviewResult


def _new_id() -> str:
    return str(uuid4())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class _FakeRun:
    status: InterviewStatus
    result: SafetyInterviewResult | None


class FakeCallProvider:
    """Return fixed results for four fictional scenarios without I/O."""

    name = "fake"
    _SCENARIOS: dict[str, SafetyInterviewResult] = {
        "no-incident": SafetyInterviewResult(
            work_summary="Completed the fictional shift as planned.",
            incident_level=IncidentLevel.NONE,
            near_miss_occurred=False,
            equipment_issue_occurred=False,
            injury_or_health_issue=False,
            handover_notes="No safety handover was reported.",
            requires_follow_up=False,
            confidence=1.0,
            evidence=("The fictional respondent reported no incident or concern.",),
            summary="No safety issue was reported in the fictional interview.",
        ),
        "minor-near-miss": SafetyInterviewResult(
            work_summary="Completed a fictional handling task.",
            incident_level=IncidentLevel.MINOR,
            near_miss_occurred=True,
            equipment_issue_occurred=False,
            injury_or_health_issue=False,
            handover_notes="Review the fictional handling step before the next shift.",
            requires_follow_up=True,
            confidence=0.95,
            evidence=("The fictional respondent explicitly reported a near miss.",),
            summary="A minor near miss was reported; follow-up is required.",
        ),
        "equipment-follow-up": SafetyInterviewResult(
            work_summary="Used a fictional tool during a routine task.",
            incident_level=IncidentLevel.MODERATE,
            near_miss_occurred=False,
            equipment_issue_occurred=True,
            injury_or_health_issue=False,
            handover_notes="Keep the fictional tool out of service pending inspection.",
            requires_follow_up=True,
            confidence=0.9,
            evidence=("The fictional respondent explicitly reported unusual tool behavior.",),
            summary="A fictional equipment issue was reported and needs follow-up.",
        ),
        "incomplete-answers": SafetyInterviewResult(
            work_summary=None,
            incident_level=IncidentLevel.UNKNOWN,
            near_miss_occurred=None,
            equipment_issue_occurred=None,
            injury_or_health_issue=None,
            handover_notes=None,
            requires_follow_up=None,
            confidence=0.0,
            evidence=("The fictional responses were incomplete.",),
            summary="The available answers are insufficient for an assessment.",
        ),
    }

    def __init__(
        self,
        id_generator: Callable[[], str] = _new_id,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._id_generator = id_generator
        self._clock = clock
        self._plans: dict[str, CallPlan] = {}
        self._runs: dict[str, _FakeRun] = {}

    @classmethod
    def available_scenarios(cls) -> tuple[str, ...]:
        """Return the stable scenario names in display order."""

        return tuple(cls._SCENARIOS)

    def create_plan(self, interview: SafetyInterview) -> CallPlan:
        """Create an offline plan for a known fictional scenario."""

        if interview.scenario_name not in self._SCENARIOS:
            raise ValueError("Unknown fake scenario")
        plan = CallPlan(
            plan_id=self._id_generator(),
            scenario_name=interview.scenario_name,
            recipient_alias=interview.recipient_alias,
            region="JP",
            language="English",
            task=build_english_safety_task(),
            result_schema=build_safety_result_schema(),
            created_at=self._clock(),
            requires_human_confirmation=True,
            contains_real_phone_number=False,
            interview_id=interview.interview_id,
        )
        self._plans[plan.plan_id] = plan
        return plan

    def start_call(self, plan: CallPlan) -> str:
        """Complete a fake run immediately without network or telephony access."""

        if self._plans.get(plan.plan_id) != plan:
            raise ValueError("Fake call plan was not found")
        run_id = self._id_generator()
        self._runs[run_id] = _FakeRun(
            status=InterviewStatus.COMPLETED,
            result=self._SCENARIOS[plan.scenario_name],
        )
        return run_id

    def get_status(self, run_id: str) -> InterviewStatus:
        """Return the status of a fake run."""

        try:
            return self._runs[run_id].status
        except KeyError as error:
            raise KeyError("Fake provider run was not found") from error

    def get_result(self, run_id: str) -> SafetyInterviewResult | None:
        """Return the fixed structured result for a completed fake run."""

        try:
            run = self._runs[run_id]
        except KeyError as error:
            raise KeyError("Fake provider run was not found") from error
        return run.result if run.status is InterviewStatus.COMPLETED else None

    def cancel_call(self, run_id: str) -> None:
        """Mark an existing fake run as cancelled and discard its result."""

        try:
            run = self._runs[run_id]
        except KeyError as error:
            raise KeyError("Fake provider run was not found") from error
        run.status = InterviewStatus.CANCELLED
        run.result = None
