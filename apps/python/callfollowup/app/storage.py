"""
storage.py
==========
Persists follow-up records to data/calls.json.

Phone numbers are ALWAYS stored masked (never raw E.164) so that the
history file does not become a source of sensitive data.
"""

import json
from pathlib import Path

CALLS_FILE = Path("data/calls.json")


# ---------------------------------------------------------------------------
# Phone masking
# ---------------------------------------------------------------------------
def _mask_phone(phone: str) -> str:
    """
    Mask a phone number for storage: keep only the last 4 digits visible.
    e.g. +14155552671 -> +*******2671
    """
    phone = str(phone).strip()
    if not phone.startswith("+"):
        return "**masked**"
    digits = phone[1:]
    if len(digits) <= 4:
        return "+****"
    return "+" + ("*" * (len(digits) - 4)) + digits[-4:]


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------
def save_follow_up(follow_up) -> None:
    CALLS_FILE.parent.mkdir(exist_ok=True)

    try:
        calls = json.loads(CALLS_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        calls = []

    calls.append({
        "contact_name": follow_up.contact_name,
        # Store masked phone - never the raw number.
        "phone_number": _mask_phone(follow_up.phone_number),
        "call_goal": follow_up.call_goal,
        "status": follow_up.status,
        "outcome": follow_up.outcome,
        "notes": follow_up.notes,
        "next_action": follow_up.next_action,
        "callback_at": follow_up.callback_at,
        # call_id is stored only when available; it is not displayed in the UI.
        "call_id": follow_up.call_id,
    })

    CALLS_FILE.write_text(json.dumps(calls, indent=2))


def update_follow_up(call_id: str, result: dict) -> bool:
    """
    Update the stored record for *call_id* with the result of a completed call.

    Uses the actual terminal status from *result* rather than hardcoding
    "completed", so UNKNOWN, FAILED, etc. are preserved correctly.
    """
    if not CALLS_FILE.exists():
        return False

    try:
        calls = json.loads(CALLS_FILE.read_text())
    except json.JSONDecodeError:
        return False

    for call in calls:
        if call.get("call_id") == call_id:
            # Preserve the real terminal status (Req 4 / Req 5).
            terminal_status = result.get("status", "unknown").lower()
            call["status"] = terminal_status
            call["outcome"] = result.get("outcome") or ""
            call["notes"] = result.get("notes") or ""
            call["next_action"] = result.get("next_action") or ""
            call["callback_at"] = result.get("callback_at") or ""
            CALLS_FILE.write_text(json.dumps(calls, indent=2))
            return True

    return False


def load_follow_ups() -> list:
    if not CALLS_FILE.exists():
        return []

    try:
        return json.loads(CALLS_FILE.read_text())
    except json.JSONDecodeError:
        return []
