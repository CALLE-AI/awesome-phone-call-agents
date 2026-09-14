from fastapi import APIRouter, HTTPException

from app.calle.client import client
from app.database.database import get_connection


router = APIRouter()


@router.get("/{session_id}")
def get_session_status(
    session_id: str,
):
    connection = get_connection()

    row = connection.execute(
        """
        SELECT *
        FROM sessions
        WHERE id = ?
        """,
        (session_id,),
    ).fetchone()

    connection.close()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found",
        )

    session = dict(row)

    # Get the latest state from CALL-E
    call = client.calls.get(
        session["call_id"]
    )

    return {
        "session_id": session["id"],
        "call_id": session["call_id"],
        "session_status": session["status"],
        "calle_status": call["status"],
        "created_at": session["created_at"],
    }