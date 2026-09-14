import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.calle.client import client
from app.calle.tasks import (
    WALK_ME_HOME_TASK,
    WALK_ME_HOME_RESULT_SCHEMA,
)
from app.session.service import (
    create_session,
)


router = APIRouter()


WEBHOOK_URL = (
    "https://subdivide-stout-squatted.ngrok-free.dev"
    "/api/webhook/calle"
)


class StartSessionRequest(BaseModel):
    phone_number: str


@router.post("/start")
def start_session(
    request: StartSessionRequest,
):

    session_id = (
        f"walk_{uuid.uuid4().hex[:8]}"
    )

    call = client.calls.create(
        task=f"""
{WALK_ME_HOME_TASK}

Call this phone number:

{request.phone_number}
""",
        result_schema=WALK_ME_HOME_RESULT_SCHEMA,
        metadata={
            "session_id": session_id,
        },
        webhook_url=WEBHOOK_URL,
    )

    create_session(
        session_id=session_id,
        call_id=call["id"],
        phone_number=request.phone_number,
    )

    return {
        "session_id": session_id,
        "call_id": call["id"],
        "calle_status": call["status"],
        "session_status": "starting",
    }