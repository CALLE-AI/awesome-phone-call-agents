from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Header, HTTPException

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


def require_live_api_token(token: str | None) -> None:
    expected = settings.incidentops_api_token.strip()

    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Live escalation API is not configured.",
        )

    if token is None or not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing live escalation API token.",
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
            "Safe Demo Mode simulated a CALL-E escalation. "
            "No real phone call was placed."
        ),
        "attempts": 0,
        "retry_available": False,
        "demo_mode": True,
        "acknowledgement": False,
        "plan": {
            "ready_to_run": False,
            "display_goal": display_goal,
            "destination": "Simulated on-call engineer",
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
        "acknowledgement": False,
    }

    if result.priority == "P1":
        if req.demo_mode:
            call_result = create_demo_call_result(
                summary=result.summary,
                priority=result.priority,
                recommendations=result.recommendation,
            )
        else:
            # Analysis never places a real phone call.
            # Live escalation requires the separate authenticated
            # endpoint and explicit approval for that individual run.
            call_result = {
                "success": False,
                "status": "APPROVAL_REQUIRED",
                "message": (
                    "P1 analysis completed. No live call was placed. "
                    "Use the authenticated /incident/escalate endpoint "
                    "with explicit per-run approval."
                ),
                "attempts": 0,
                "retry_available": False,
                "demo_mode": False,
                "acknowledgement": False,
            }

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
    x_incidentops_token: str | None = Header(
        default=None,
        alias="X-IncidentOps-Token",
    ),
) -> dict[str, Any]:
    require_live_api_token(x_incidentops_token)

    if req.approved is not True:
        raise HTTPException(
            status_code=400,
            detail="Explicit per-run approval is required.",
        )

    destination = settings.oncall_phone.strip()

    if not destination:
        raise HTTPException(
            status_code=503,
            detail="No authorized on-call destination is configured.",
        )

    goal = create_call_goal(
        req.incident,
        req.severity,
        ["Please acknowledge immediately."],
    )

    return start_call(
        destination,
        goal,
    )


@router.get("/history")
def history() -> list[dict[str, Any]]:
    return get_history()
