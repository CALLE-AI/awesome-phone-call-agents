from app.database.database import get_connection
from app.location.service import get_location


def create_incident(
    session_id: str,
    call_id: str,
    decision: dict,
):
    location = get_location(session_id)

    connection = get_connection()

    cursor = connection.execute(
        """
        INSERT INTO incidents (
            session_id,
            call_id,
            status,
            reason,
            distress_detected,
            user_confirmed_danger
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            call_id,
            decision["status"],
            decision["reason"],
            int(decision["distress_detected"]),
            int(decision["user_confirmed_danger"]),
        ),
    )

    connection.commit()

    incident_id = cursor.lastrowid

    connection.close()

    return {
        "incident_id": incident_id,
        "location": location,
    }