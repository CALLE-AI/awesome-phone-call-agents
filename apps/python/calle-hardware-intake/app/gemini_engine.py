"""Gemini intent parsing + tool calling for the intake agent.

Takes a phone-call transcript/notes and turns it into structured actions via
Gemini function calling:
  * create_repair_ticket()      -> creates a ticket in the DB
  * schedule_diagnostic_slot()  -> records a repair-appointment slot
  * check_repair_status()       -> looks up an existing ticket

The ``calle`` flow owns the phone call; this engine owns the "understand the
conversation and log a ticket" half.

We talk to Gemini over its REST API with httpx directly (not the google-genai
SDK): the SDK drops the ``thoughtSignature`` that the newer API requires on
echoed function calls, and raw REST also sidesteps the broken-IPv6 quirk.
"""
from datetime import datetime
from typing import Callable, Optional

import httpx

from . import netfix  # noqa: F401  (force IPv4 before any network call)
from .config import settings
from .database import SessionLocal, Ticket

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

SYSTEM_PROMPT = """You are the intake engine for a hardware & tech-support repair desk.
You listen to phone-call transcripts between a support agent and a customer,
then log structured actions using your tools.

Rules:
- ALWAYS use create_repair_ticket when the customer reports a device problem.
  Infer device_type (laptop, phone, motherboard, OS, printer, etc.), write a
  concise issue_description, and pick priority: low|normal|high|urgent.
  Use customer_name if the caller identifies themselves.
- Use schedule_diagnostic_slot when an appointment date/time is agreed.
- Use check_repair_status when the caller asks about an existing ticket.
- If nothing is actionable, say so in one line and call no tools.
- After calling tools, reply with a one-line summary of what you did.
Never invent phone numbers, ticket ids, dates, or times that are not in the transcript."""

# --- Tool implementations (take a DB session) --------------------------------

def _new_ticket_number() -> str:
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"TKT-{stamp}"


def _make_tools(db_session) -> tuple[dict[str, Callable], list[Ticket]]:
    # Tracks tickets actually created by THIS analysis run, so callers only
    # see fresh tickets, not whatever happened to be the newest row in the DB.
    created_this_run: list[Ticket] = []

    def create_repair_ticket(
        device_type: str,
        issue_description: str,
        priority: str = "normal",
        customer_name: Optional[str] = None,
    ) -> dict:
        ticket = Ticket(
            ticket_number=_new_ticket_number(),
            device_type=device_type,
            issue_description=issue_description,
            priority=priority,
            customer_name=customer_name,
            status="open",
        )
        db_session.add(ticket)
        db_session.commit()
        db_session.refresh(ticket)
        created_this_run.append(ticket)
        return {
            "ticket_id": ticket.id,
            "ticket_number": ticket.ticket_number,
            "device_type": ticket.device_type,
            "priority": ticket.priority,
        }

    def schedule_diagnostic_slot(
        date: str, time_slot: str, user_name: str, ticket_id: Optional[int] = None
    ) -> dict:
        ticket = None
        if ticket_id is not None:
            ticket = db_session.get(Ticket, ticket_id)
        if ticket is not None:
            ticket.scheduled_date = date
            ticket.scheduled_time = time_slot
            db_session.commit()
        return {
            "scheduled": True,
            "date": date,
            "time_slot": time_slot,
            "user_name": user_name,
            "ticket_id": ticket.id if ticket else None,
        }

    def check_repair_status(ticket_id: Optional[int] = None, ticket_number: Optional[str] = None) -> dict:
        ticket = None
        if ticket_id is not None:
            ticket = db_session.get(Ticket, ticket_id)
        elif ticket_number:
            ticket = db_session.query(Ticket).filter_by(ticket_number=ticket_number).first()
        if ticket is None:
            return {"found": False, "message": "No matching ticket found."}
        return {
            "found": True,
            "ticket_number": ticket.ticket_number,
            "device_type": ticket.device_type,
            "status": ticket.status,
            "scheduled_date": ticket.scheduled_date,
            "scheduled_time": ticket.scheduled_time,
        }

    return {
        "create_repair_ticket": create_repair_ticket,
        "schedule_diagnostic_slot": schedule_diagnostic_slot,
        "check_repair_status": check_repair_status,
    }, created_this_run


# --- Gemini tool declarations (REST format) ----------------------------------

TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "create_repair_ticket",
                "description": "Create a repair ticket for a reported hardware/software issue.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "device_type": {"type": "string", "description": "e.g. laptop, phone, motherboard, OS"},
                        "issue_description": {"type": "string"},
                        "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
                        "customer_name": {"type": "string"},
                    },
                    "required": ["device_type", "issue_description"],
                },
            },
            {
                "name": "schedule_diagnostic_slot",
                "description": "Schedule a diagnostic appointment slot for a customer.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string", "description": "YYYY-MM-DD"},
                        "time_slot": {"type": "string", "description": "e.g. 10:30"},
                        "user_name": {"type": "string"},
                        "ticket_id": {"type": "integer"},
                    },
                    "required": ["date", "time_slot", "user_name"],
                },
            },
            {
                "name": "check_repair_status",
                "description": "Look up the status of an existing repair ticket.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ticket_id": {"type": "integer"},
                        "ticket_number": {"type": "string"},
                    },
                },
            },
        ]
    }
]


def _generate(client: httpx.Client, payload: dict) -> dict:
    url = f"{GEMINI_BASE}/models/{settings.gemini_model}:generateContent"
    resp = client.post(
        url,
        headers={"x-goog-api-key": settings.gemini_api_key},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def analyze_call(transcript: str) -> dict:
    """Run Gemini over ``transcript`` and execute any tool calls.

    Returns ``{"ticket": {...}|None, "actions": [...], "notes": str}``.
    """
    db = SessionLocal()
    try:
        tools, created_this_run = _make_tools(db)
        contents: list[dict] = [{"role": "user", "parts": [{"text": transcript}]}]
        actions: list[str] = []
        final_text = ""

        with httpx.Client() as client:
            for _ in range(6):  # bound the tool loop
                payload = {
                    "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                    "contents": contents,
                    "tools": TOOLS,
                    "generationConfig": {"temperature": 0.2},
                }
                data = _generate(client, payload)
                try:
                    parts = data["candidates"][0]["content"]["parts"]
                except (KeyError, IndexError):
                    final_text = str(data)
                    break

                call_parts = [p for p in parts if "functionCall" in p]
                if not call_parts:
                    final_text = "".join(p.get("text", "") for p in parts)
                    break

                # Echo the model turn, preserving thoughtSignature (it sits at
                # the PART level in the response) + the function call id.
                model_parts = []
                for p in call_parts:
                    fc = p["functionCall"]
                    echo = {"name": fc["name"], "args": fc.get("args", {})}
                    if fc.get("id"):
                        echo["id"] = fc["id"]
                    part_echo = {"functionCall": echo}
                    if p.get("thoughtSignature"):
                        part_echo["thoughtSignature"] = p["thoughtSignature"]
                    model_parts.append(part_echo)
                contents.append({"role": "model", "parts": model_parts})

                # Execute each tool and send the function responses back.
                for p in call_parts:
                    fc = p["functionCall"]
                    fn = tools.get(fc["name"])
                    if fn is None:
                        result = {"error": f"unknown tool {fc['name']}"}
                    else:
                        try:
                            result = fn(**fc.get("args", {}))
                        except Exception as exc:  # surface tool errors to the model
                            result = {"error": str(exc)}
                    actions.append(f"{fc['name']}({fc.get('args', {})})")
                    contents.append(
                        {
                            "role": "user",
                            "parts": [
                                {
                                    "functionResponse": {
                                        "name": fc["name"],
                                        "response": result,
                                    }
                                }
                            ],
                        }
                    )

        return {
            "ticket": created_this_run[-1] if created_this_run else None,
            "actions": actions,
            "notes": final_text,
        }
    finally:
        db.close()
