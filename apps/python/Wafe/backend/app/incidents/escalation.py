from app.calle.client import client
from app.calle.emergency import (
    EMERGENCY_CALL_TASK,
    EMERGENCY_CALL_RESULT_SCHEMA,
)
from app.config import EMERGENCY_CONTACT


def call_emergency_contact(
    session_id: str,
    incident_id: int,
    reason: str,
    location: dict | None,
):
    if location:
        latitude = location["latitude"]
        longitude = location["longitude"]

        location_text = (
            f"Latitude {latitude}, "
            f"longitude {longitude}."
        )

        maps_link = (
            f"https://www.google.com/maps?q="
            f"{latitude},{longitude}"
        )
    else:
        location_text = "The user's location is unavailable."
        maps_link = "No location available."

    task = f"""
{EMERGENCY_CALL_TASK}

Incident ID:
{incident_id}

Safety reason:
{reason}

Last known location:
{location_text}

Map:
{maps_link}

Notify the trusted contact now.
"""

    call = client.calls.create(
        task=task,
        recipients=[
            {
                "phones": [EMERGENCY_CONTACT]
            }
        ],
        result_schema=EMERGENCY_CALL_RESULT_SCHEMA,
        metadata={
            "type": "emergency_escalation",
            "session_id": session_id,
            "incident_id": str(incident_id),
        },
    )

    return call