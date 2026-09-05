from typing import Any

from fastapi import APIRouter

from app.config import settings
from app.database.crud import get_history, save_incident
from app.models.escalation import EscalationRequest
from app.models.incident import IncidentRequest
from app.services.analyzer import analyze_incident
from app.services.calle_service import start_call
from app.services.llm_service import create_call_goal

router = APIRouter(
    prefix="/incident",
    tags=["Incident"],
)


def create_demo_call_result(
    summary: str,
    priority: str,
    recommendations: list[str],
) -> dict[str, Any]:
    display_goal = (
        f"Call the on-call engineer about {summary}. "
        f"State that the incident priority is {priority}. "
        f"Recommended actions: {', '.join(recommendations)}. "
        "Request immediate acknowledgement and confirm ownership."
    )

    return {
        "success": True,
        "status": "DEMO_ACKNOWLEDGED",
        "message": (
            "Safe Demo Mode simulated a successful CALL-E escalation. "
            "The on-call engineer acknowledged the incident."
        ),
        "attempts": 1,
        "retry_available": False,
        "demo_mode": True,
        "simulation_notice": (
            "This result is simulated for demonstration purposes. "
            "No real phone call was placed."
        ),
        "plan": {
            "plan_id": "demo-incidentops-001",
            "ready_to_run": True,
            "display_goal": display_goal,
            "schedule_mode": "immediate",
            "destination": "Demo on-call engineer",
            "call_outcome": "Engineer acknowledged incident",
            "acknowledgement": True,
        },
    }


@router.post("/analyze")
def analyze(req: IncidentRequest) -> dict[str, Any]:
    result = analyze_incident(
        req.incident,
        req.severity,
    )

    response: dict[str, Any] = {
        "analysis": result,
        "demo_mode": req.demo_mode,
    }

    call_result: dict[str, Any] = {
        "success": False,
        "status": "NOT_REQUIRED",
        "message": (
            "Voice escalation is not required "
            "for this incident priority."
        ),
        "attempts": 0,
        "retry_available": False,
        "demo_mode": req.demo_mode,
    }

    if result.priority == "P1":
        if req.demo_mode:
            call_result = create_demo_call_result(
                summary=result.summary,
                priority=result.priority,
                recommendations=result.recommendation,
            )

        else:
            goal = create_call_goal(
                result.summary,
                result.priority,
                result.recommendation,
            )

            call_result = start_call(
                settings.oncall_phone,
                goal,
            )

            call_result["demo_mode"] = False

        response["call"] = call_result

    saved_incident = save_incident(
        {
            "incident": req.incident,
            "severity": req.severity,
            "priority": result.priority,
            "summary": result.summary,
            "call_status": call_result.get(
                "status",
                "UNKNOWN",
            ),
            "call_success": call_result.get(
                "success",
                False,
            ),
            "call_message": call_result.get(
                "message",
            ),
            "call_attempts": call_result.get(
                "attempts",
                0,
            ),
            "retry_available": call_result.get(
                "retry_available",
                False,
            ),
        }
    )

    response["incident_id"] = saved_incident["id"]
    response["created_at"] = saved_incident["created_at"]

    return response


@router.post("/escalate")
def escalate(
    req: EscalationRequest,
) -> dict[str, Any]:
    goal = create_call_goal(
        req.incident,
        req.severity,
        ["Please acknowledge immediately."],
    )

    return start_call(
        req.phone,
        goal,
    )


@router.get("/history")
def history() -> list[dict[str, Any]]:
    return get_history()
