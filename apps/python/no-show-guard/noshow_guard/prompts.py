"""Configurable agent call script and structured result schema.

Keeping the prompt and the ``result_schema`` in one dedicated module makes it
trivial to demo how changing the agent's behaviour affects the app: tweak the
``TASK_TEMPLATE`` below and the confirmation call changes without touching any
other code.

The ``TASK_TEMPLATE`` is sent to CALL-E as the ``task`` field of the call
request. It instructs the AI agent on the phone to confirm identity, read the
appointment details and ask for Confirm / Reschedule / Cancel.

The ``RESULT_SCHEMA`` tells CALL-E exactly what structured JSON to return for
each call, which the app then parses and stores.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# The agent's spoken-task prompt. ``{date}``, ``{time}`` and ``{service}`` are
# formatted with the real appointment details before the call is placed.
# ---------------------------------------------------------------------------
TASK_TEMPLATE = (
    "You are a helpful appointment-confirmation assistant calling a customer "
    "for a small business. Greet them politely and confirm you are speaking "
    "with the correct person. Then read out their appointment clearly: it is "
    "on {date} at {time} for {service}. "
    "Ask the customer whether they would like to Confirm, Reschedule, or "
    "Cancel the appointment. "
    "If they choose Reschedule, ask for their preferred new date and time. "
    "If they choose Cancel, briefly ask (optional) for a reason. "
    "Thank them and end the call politely. "
    "You must produce a structured result matching the provided result_schema."
)

# ---------------------------------------------------------------------------
# The structured JSON result CALL-E must return for every completed call.
# The app parses this to update the local appointments database.
# ---------------------------------------------------------------------------
RESULT_SCHEMA: dict = {
    "type": "object",
    "required": ["outcome"],
    "properties": {
        "outcome": {
            "type": "string",
            "enum": ["confirmed", "rescheduled", "cancelled", "no_answer", "unknown"],
        },
        "new_datetime": {"type": "string"},
        "cancel_reason": {"type": "string"},
    },
    "additionalProperties": False,
}


def build_task(date: str, time: str, service: str) -> str:
    """Render the agent task prompt with the given appointment details.

    Args:
        date: Appointment date, e.g. ``"2025-12-20"``.
        time: Appointment time, e.g. ``"10:30"``.
        service: Service name, e.g. ``"General Consultation"``.

    Returns:
        A fully rendered prompt string ready to send to CALL-E.
    """
    return TASK_TEMPLATE.format(date=date, time=time, service=service)
