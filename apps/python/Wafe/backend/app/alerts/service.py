from datetime import datetime

from app.database.database import get_connection


def send_trusted_contact_alert(
    session_id: str,
    incident_id: int,
    reason: str,
    location: dict | None,
):
    timestamp = datetime.now().isoformat()

    if location:
        latitude = location["latitude"]
        longitude = location["longitude"]

        location_text = (
            f"https://www.google.com/maps?q="
            f"{latitude},{longitude}"
        )
    else:
        location_text = "Location unavailable."

    message = f"""
🚨 CALL-E SAFETY ALERT

A Walk Me Home session detected a possible safety incident.

Incident ID:
{incident_id}

Reason:
{reason}

Last known location:
{location_text}

Time:
{timestamp}

Please check on the user.
"""

    connection = get_connection()

    cursor = connection.execute(
        """
        INSERT INTO alerts (
            incident_id,
            session_id,
            status,
            message
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            incident_id,
            session_id,
            "new",
            message.strip(),
        ),
    )

    connection.commit()

    alert_id = cursor.lastrowid

    connection.close()

    print()
    print("=" * 70)
    print("🚨 TRUSTED CONTACT ALERT CREATED")
    print("=" * 70)
    print(message)
    print("=" * 70)

    return {
        "alert_id": alert_id,
        "status": "new",
        "channel": "dashboard",
        "message": message.strip(),
    }