"""Reading a terminal CALL-E call task and turning it into one NoShowZero decision.

Pure: performs no side effects. The caller applies the decision (updates its schedule, and - only
with explicit operator intent - offers a released slot to the next waitlist patient).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

TERMINAL = {"completed", "failed", "canceled"}

# A reminder may only change an appointment when the patient themself said so.
_APPOINTMENT_STATUS = {"confirmed": "confirmed", "wants_reschedule": "rescheduled", "cancelled": "cancelled"}


def _recipient(call: dict[str, Any]) -> dict[str, Any]:
    recipients = call.get("recipients") or []
    return recipients[0] if recipients else {}


def extract_result(call: dict[str, Any]) -> dict[str, Any] | None:
    """The task-level result is authoritative; fall back to the recipient result."""
    return call.get("structured_result") or _recipient(call).get("structured_result") or None


def extract_transcript(call: dict[str, Any], agent: str = "Ava", patient: str = "Patient") -> str | None:
    lines: list[str] = []
    for attempt in _recipient(call).get("attempts") or []:
        for turn in attempt.get("transcript_turns") or []:
            who = {"bot": agent, "user": patient}.get(turn.get("speaker", ""), "Unknown")
            text = (turn.get("text") or "").strip()
            if text:
                lines.append(f"{who}: {text}")
    return "\n".join(lines) or None


def extract_duration_seconds(call: dict[str, Any]) -> int | None:
    best: int | None = None
    for attempt in _recipient(call).get("attempts") or []:
        start, end = attempt.get("started_at"), attempt.get("completed_at")
        if not (start and end):
            continue
        try:
            secs = int(
                (
                    datetime.fromisoformat(end.replace("Z", "+00:00"))
                    - datetime.fromisoformat(start.replace("Z", "+00:00"))
                ).total_seconds()
            )
        except ValueError:
            continue
        if secs >= 0 and (best is None or secs > best):
            best = secs
    return best


def extract_failure(call: dict[str, Any]) -> str | None:
    """Raw failure code and message, preserved for the front desk. Never branched on."""
    attempts = _recipient(call).get("attempts") or []
    last = attempts[-1] if attempts else {}
    code = last.get("failure_code") or call.get("failure_code")
    msg = last.get("failure_message") or call.get("failure_message")
    if not (code or msg):
        return None
    return f"{code or 'failed'}: {msg}" if msg else str(code)


def _base(call: dict[str, Any]) -> dict[str, Any]:
    meta = call.get("metadata") or {}
    return {
        "call_id": call.get("id"),
        "kind": meta.get("kind"),
        "call_status": call.get("status"),
        "summary": call.get("summary"),
        "reason": None,
        "notes": None,
    }


def decide_reminder(call: dict[str, Any]) -> dict[str, Any]:
    """One reminder call -> what happens to the appointment and whether its slot is released.

    ``failure_code`` has no published enum, so a failed call is reported as failed with CALL-E's raw
    reason - never guessed into "no answer". Only a patient who was reached can confirm, cancel or
    reschedule; if someone else answered, the appointment is left unchanged.
    """
    meta = call.get("metadata") or {}
    decision = _base(call) | {
        "appointment_id": meta.get("appointment_id"),
        "reminder_window": meta.get("reminder_window"),
        "outcome": None,
        "appointment_status": None,
        "reminder_status": None,
        "release_slot": False,
        "reschedule_preference": None,
    }
    status = call.get("status")
    if status not in TERMINAL:
        return decision | {"outcome": "in_progress"}
    if status != "completed":
        return decision | {"outcome": "failed", "reminder_status": "failed", "reason": extract_failure(call) or status}

    result = extract_result(call)
    if not result:
        return decision | {"outcome": "result_validation_failed", "reminder_status": "called",
                           "reason": "CALL-E returned no schema-valid result"}

    outcome = result.get("outcome") or "unknown"
    decision["notes"] = result.get("notes") or None
    if outcome in ("voicemail", "no_answer"):
        return decision | {"outcome": outcome, "reminder_status": "voicemail" if outcome == "voicemail" else "no_answer"}
    if outcome not in _APPOINTMENT_STATUS or result.get("reached_patient") != "yes":
        return decision | {"outcome": "unclear", "reminder_status": "called",
                           "reason": f"outcome={outcome}, reached_patient={result.get('reached_patient')}"}

    preference = (result.get("reschedule_preference") or "").strip() or None
    return decision | {
        "outcome": outcome,
        "appointment_status": _APPOINTMENT_STATUS[outcome],
        "reminder_status": "confirmed" if outcome == "confirmed" else "called",
        "release_slot": outcome in ("wants_reschedule", "cancelled"),
        "reschedule_preference": preference if outcome == "wants_reschedule" else None,
    }


def decide_offer(call: dict[str, Any]) -> dict[str, Any]:
    """One waitlist offer call -> book the slot, move on to the next patient, or stop for review.

    An ambiguous result (no schema-valid result, or the patient did not clearly decide) stops the
    cascade: offering the slot to someone else could double-book a patient who actually said yes.
    """
    meta = call.get("metadata") or {}
    decision = _base(call) | {
        "entry_id": meta.get("entry_id"),
        "slot_id": meta.get("slot_id"),
        "outcome": None,
        "book": False,
        "entry_status": None,
        "offer_next": False,
    }
    status = call.get("status")
    if status not in TERMINAL:
        return decision | {"outcome": "in_progress"}
    if status != "completed":
        return decision | {"outcome": "failed", "entry_status": "waiting", "offer_next": True,
                           "reason": extract_failure(call) or status}

    result = extract_result(call)
    if not result:
        return decision | {"outcome": "needs_review", "reason": "CALL-E returned no schema-valid result"}
    decision["notes"] = result.get("notes") or None
    if result.get("reached_patient") != "yes":
        return decision | {"outcome": "no_answer", "entry_status": "waiting", "offer_next": True}
    if result.get("accepted") == "yes":
        return decision | {"outcome": "accepted", "book": True, "entry_status": "booked"}
    if result.get("accepted") == "no":
        removed = result.get("remove_from_waitlist") == "yes"
        return decision | {"outcome": "declined", "entry_status": "removed" if removed else "waiting",
                           "offer_next": True}
    return decision | {"outcome": "needs_review", "reason": "the patient did not clearly accept or decline"}


def decide(call: dict[str, Any]) -> dict[str, Any]:
    """Dispatch on ``metadata.kind``, which NoShowZero sets on every call it creates."""
    kind = (call.get("metadata") or {}).get("kind")
    if kind == "reminder":
        return decide_reminder(call)
    if kind == "waitlist_offer":
        return decide_offer(call)
    raise ValueError(f"not a NoShowZero call (metadata.kind={kind!r})")
