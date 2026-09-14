from fastapi import APIRouter, HTTPException

from app.session.service import update_session_status
from app.session.service import get_session


router = APIRouter()


@router.post("/{session_id}/end")
def end_session(session_id: str):

    session = get_session(session_id)

    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found",
        )

    update_session_status(
        session_id=session_id,
        status="ended",
    )

    return {
        "success": True,
        "session_id": session_id,
        "status": "ended",
        "call_id": session["call_id"],
    }