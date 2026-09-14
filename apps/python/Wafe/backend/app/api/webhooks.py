from fastapi import APIRouter, Request

from app.alerts.service import send_trusted_contact_alert
from app.incidents.service import create_incident
from app.safety.engine import safety_engine

from app.session.service import (
    update_session_status,
)


router = APIRouter()


@router.post("/calle")
async def calle_webhook(request: Request):

    payload = await request.json()

    data = payload.get("data", payload)

    metadata = data.get("metadata", {})

    safety_result = safety_engine.process_call_result(
        data
    )

    decision = safety_result["decision"]

    session_id = (
        metadata.get("session_id")
    )

    call_id = data.get("id")

    print()
    print("=" * 70)
    print("CALL-E WEBHOOK")
    print("=" * 70)

    print("Call ID:", call_id)
    print("Session:", session_id)
    print("Status:", data.get("status"))
    print("Metadata:", metadata)

    print()
    print("Safety decision:")
    print(decision)

    if session_id:
        update_session_status(
            session_id=session_id,
            status=data.get("status", "unknown"),
        )

    # Ignore non-terminal or irrelevant webhook events.
    if data.get("status") not in {
        "completed",
        "failed",
        "canceled",
    }:
        return {
            "received": True,
            "processed": False,
        }

    

    # Ignore emergency-call webhooks here.
    if metadata.get("type") == "emergency_escalation":
        print()
        print("Emergency escalation call webhook received.")

        return {
            "received": True,
            "processed": True,
            "type": "emergency_escalation",
        }

    # Only create an incident for danger.
    if decision["status"] != "danger":
        print()
        print("No emergency escalation required.")

        return {
            "received": True,
            "processed": True,
            "safety_status": decision["status"],
        }

    # Create incident.
    incident = create_incident(
        session_id=session_id,
        call_id=call_id,
        decision=decision,
    )

    incident_id = incident["incident_id"]
    location = incident["location"]

    print()
    print("INCIDENT CREATED")
    print("Incident ID:", incident_id)
    print("Location:", location)

    # Escalate to trusted contact.
    alert = send_trusted_contact_alert(
    session_id=session_id,
    incident_id=incident_id,
    reason=decision["reason"],
    location=location,
)

    print()
    print("🚨 TRUSTED CONTACT ALERT SENT")
    print("Channel:", alert["channel"])

    update_session_status(
    session_id=session_id,
    status="danger",
)

    return {
    "received": True,
    "processed": True,
    "safety_status": decision["status"],
    "incident_id": incident_id,
    "alert_status": alert["status"],
    }

    