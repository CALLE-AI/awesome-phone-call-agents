"""Pure builders for offline CALL-E safety interview plans."""

from collections.abc import Callable
from datetime import datetime
from uuid import uuid4

from shift_safety_call_agent.application.services import utc_now
from shift_safety_call_agent.domain.models import CallPlan

CALLE_PREVIEW_SCENARIOS = (
    "no-incident",
    "minor-near-miss",
    "equipment-issue",
    "incomplete",
)

ENGLISH_SAFETY_TASK_VERSION = "en-safety-v2"
SAFETY_RESULT_SCHEMA_VERSION = "safety-result-v1"

_RESULT_FIELDS = (
    "work_summary",
    "incident_level",
    "near_miss_status",
    "equipment_issue_status",
    "injury_or_health_status",
    "handover_notes",
    "requires_follow_up_status",
    "evidence",
    "summary",
)


def _new_id() -> str:
    return str(uuid4())


def build_english_safety_task() -> str:
    """Build the fictional English reference safety interview task without a target."""

    return "\n".join(
        (
            "This is an AI phone call and a fictional safety-check demo.",
            "First ask whether the person agrees to continue the call. If consent is refused, end the call immediately.",
            "Ask the following six checks one at a time, never multiple checks at once. Wait for the person's answer and confirm its content before moving to the next check.",
            "1. Ask for an overview of today's fictional work.",
            "2. Ask whether anything about today's fictional work raised a safety concern.",
            "3. Ask whether there was a near miss.",
            "4. Ask whether there was an equipment or tool abnormality.",
            "5. Ask whether there was an injury or anyone felt unwell.",
            "6. Ask about handover notes for the next shift and whether additional follow-up is needed.",
            "If the person interrupts a question, do not infer a definite answer from that short utterance alone. If needed, briefly rephrase the question, then confirm the answer before continuing.",
            "Do not interpret ambiguous short replies such as 'It's fine', 'I'm okay', or 'No thanks' as either no abnormality or a request to end the call when they could mean acceptance, refusal, or termination.",
            "Briefly clarify the meaning, for example: 'Do you mean there is no problem, or that you want to end the call?' There is no need to repeat this exact wording every time.",
            "During the safety check, end early only for explicit termination intent, such as 'I want to end the call', 'Please hang up', or 'I will not answer any more'. Do not end merely because the person says 'It's fine'.",
            "After all six checks, say that the check is complete and briefly ask whether there are any additional handover notes before ending.",
            "Do not infer unknown information; treat ambiguous answers as unknown, not as No.",
            "Do not ask about real companies, equipment, coworkers, incidents, or personal information; ask the person not to disclose such information.",
            "Do not make emergency calls, medical judgments, or legal judgments.",
        )
    )


def build_safety_result_schema() -> dict[str, object]:
    """Return the provider-neutral JSON Schema for safety interview results."""

    tri_state = ["yes", "no", "unknown"]
    incident_levels = ["none", "minor", "moderate", "critical", "unknown"]
    return {
        "type": "object",
        "required": list(_RESULT_FIELDS),
        "properties": {
            "work_summary": {
                "type": "string",
                "description": "Overview of fictional work. Use unknown if not known.",
            },
            "incident_level": {"type": "string", "enum": incident_levels},
            "near_miss_status": {"type": "string", "enum": tri_state},
            "equipment_issue_status": {"type": "string", "enum": tri_state},
            "injury_or_health_status": {"type": "string", "enum": tri_state},
            "handover_notes": {
                "type": "string",
                "description": "Handover notes for the next shift. Use unknown if not known.",
            },
            "requires_follow_up_status": {"type": "string", "enum": tri_state},
            "evidence": {"type": "array", "items": {"type": "string"}},
            "summary": {"type": "string"},
        },
        "additionalProperties": False,
    }


def create_calle_plan(
    scenario_name: str,
    recipient_alias: str,
    *,
    interview_id: str | None = None,
    id_generator: Callable[[], str] = _new_id,
    clock: Callable[[], datetime] = utc_now,
) -> CallPlan:
    """Create an offline CALL-E-shaped plan without a phone number or I/O."""

    if not scenario_name.strip():
        raise ValueError("scenario_name must not be empty")
    return CallPlan(
        plan_id=id_generator(),
        scenario_name=scenario_name,
        recipient_alias=recipient_alias,
        region="JP",
        language="English",
        task=build_english_safety_task(),
        result_schema=build_safety_result_schema(),
        created_at=clock(),
        requires_human_confirmation=True,
        contains_real_phone_number=False,
        interview_id=interview_id,
    )


def create_calle_preview_plan(
    scenario_name: str,
    *,
    id_generator: Callable[[], str] = _new_id,
    clock: Callable[[], datetime] = utc_now,
) -> CallPlan:
    """Create a deterministic-injectable plan for a supported dry-run scenario."""

    if scenario_name not in CALLE_PREVIEW_SCENARIOS:
        raise ValueError("Unknown CALL-E preview scenario")
    return create_calle_plan(
        scenario_name,
        "demo-worker",
        id_generator=id_generator,
        clock=clock,
    )
