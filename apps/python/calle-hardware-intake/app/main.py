"""FastAPI backend for the CALL-E hardware & tech-support intake agent.

Endpoints
---------
GET  /health            -> server + CALL-E auth status
POST /api/intake        -> Gemini parses a transcript; creates/logs a ticket
GET  /api/tickets       -> list tickets
GET  /api/tickets/{id}  -> one ticket
POST /api/calls         -> plan + run a real CALL-E call (background)
GET  /api/calls/{id}    -> call session + live status

Run:  uvicorn app.main:app --reload
"""
import asyncio
import json

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from . import netfix  # noqa: F401  (force IPv4 for Python networking)
from . import calle_client, gemini_engine
from .config import settings
from .database import CallSession, SessionLocal, Ticket, get_db, init_db
from .models import CallCreate, CallOut, IntakeRequest, IntakeResponse, TicketOut

app = FastAPI(
    title="CALL-E Hardware Support Intake Agent",
    description="Voice AI agent for repair-shop tech support: takes calls, "
    "logs tickets, schedules diagnostics via CALL-E + Gemini.",
    version="0.1.0",
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


# --- Helpers ----------------------------------------------------------------

TERMINAL = {"completed", "done", "finished", "failed", "error", "cancelled", "canceled", "ended", "no_answer", "voicemail"}

# Keep references to background call tasks so the event loop doesn't GC them.
_background_tasks: set[asyncio.Task] = set()


def _is_terminal(status: str | None) -> bool:
    if not status:
        return False
    s = status.lower()
    return s in TERMINAL or "fail" in s or "error" in s or "complete" in s


async def _execute_call(session_id: int) -> None:
    """Run a planned call to completion in the background and log a ticket."""
    db = SessionLocal()
    try:
        session = db.get(CallSession, session_id)
        if session is None:
            return
        session.status = "running"
        db.commit()

        run_info = await asyncio.to_thread(
            calle_client.run_call, session.plan_id, session.confirm_token
        )
        run = calle_client.extract_run(run_info)
        run_id = run["run_id"]
        if run_id:
            session.run_id = run_id
            db.commit()

        # Poll until the call reaches a terminal state.
        elapsed = 0
        while elapsed < settings.call_poll_timeout:
            await asyncio.sleep(5)
            elapsed += 5
            try:
                status_data = await asyncio.to_thread(
                    calle_client.get_call_status, run_id
                )
                current = calle_client.extract_run(status_data)
            except Exception:
                continue
            if current["status"]:
                session.status = current["status"]
            if current["summary"]:
                session.summary = current["summary"]
            if current["transcript"]:
                session.transcript = current["transcript"]
            if current["result"]:
                session.structured_result = json.dumps(current["result"])
            db.commit()
            if _is_terminal(current["status"]):
                break

        # Feed whatever CALL-E returned into Gemini to log a ticket.
        text = session.summary or session.transcript
        if text:
            try:
                result = await asyncio.to_thread(gemini_engine.analyze_call, text)
                if result.get("ticket") is not None:
                    session.ticket_id = result["ticket"].id
                db.commit()
            except Exception:
                # Logging the ticket must not break call tracking.
                pass
    except Exception as exc:
        db.rollback()
        session = db.get(CallSession, session_id)
        if session is not None:
            session.status = "failed"
            session.error = str(exc)[:1000]
            db.commit()
    finally:
        db.close()


# --- Health -----------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    try:
        import subprocess

        auth = await asyncio.to_thread(
            lambda: subprocess.run(
                calle_client.cli_command(["auth", "status"]),
                capture_output=True,
                text=True,
                timeout=15,
            )
        )
        usable = '"usable": true' in auth.stdout or '"status": "logged_in"' in auth.stdout
        return {
            "status": "ok",
            "gemini_model": settings.gemini_model,
            "calle_cli": usable,
            "calle_raw": auth.stdout[:200],
        }
    except Exception as exc:
        return {"status": "ok", "calle_cli": False, "calle_error": str(exc)}


# --- Intake (Gemini tool calling) --------------------------------------------

@app.post("/api/intake", response_model=IntakeResponse)
async def intake(body: IntakeRequest, db: Session = Depends(get_db)) -> IntakeResponse:
    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="transcript is required")
    result = await asyncio.to_thread(gemini_engine.analyze_call, body.transcript)
    ticket = result.get("ticket")
    return IntakeResponse(
        ticket=TicketOut.model_validate(ticket) if ticket is not None else None,
        actions=result.get("actions", []),
        notes=result.get("notes", ""),
    )


# --- Tickets ------------------------------------------------------------------

@app.get("/api/tickets", response_model=list[TicketOut])
async def list_tickets(db: Session = Depends(get_db)) -> list[Ticket]:
    return db.query(Ticket).order_by(Ticket.id.desc()).all()


@app.get("/api/tickets/{ticket_id}", response_model=TicketOut)
async def get_ticket(ticket_id: int, db: Session = Depends(get_db)) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")
    return ticket


# --- Calls --------------------------------------------------------------------

@app.post("/api/calls", response_model=CallOut, status_code=201)
async def create_call(body: CallCreate, db: Session = Depends(get_db)) -> CallSession:
    session = CallSession(phone=body.phone, goal=body.goal, status="created")
    db.add(session)
    db.commit()
    db.refresh(session)

    try:
        plan_data = await asyncio.to_thread(calle_client.plan_call, body.phone, body.goal)
    except calle_client.CalleError as exc:
        session.status = "failed"
        session.error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc))

    plan = calle_client.extract_plan(plan_data)
    session.plan_id = plan["plan_id"]
    session.confirm_token = plan["confirm_token"] or ""

    if not plan["ready_to_run"]:
        session.status = "plan_not_ready"
        db.commit()
        return session  # CALL-E needs clarification; check plan card / ask user

    session.status = "planned"
    db.commit()

    # Fire the call in the background so the request returns immediately.
    task = asyncio.create_task(_execute_call(session.id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return session
