"""Reading a terminal CALL-E call task.

`GET /v1/calls/{call_id}` and the terminal webhook `data` object are the same
shape, so everything here works against either.
"""
from __future__ import annotations

from datetime import datetime

def _recipient(call: dict) -> dict:
    recipients = call.get("recipients") or []
    return recipients[0] if recipients else {}


def extract_transcript(call: dict) -> str | None:
    """Flatten `recipients[].attempts[].transcript_turns` into readable text."""
    lines: list[str] = []
    for attempt in _recipient(call).get("attempts") or []:
        for turn in attempt.get("transcript_turns") or []:
            speaker = {"bot": "Agent", "user": "Referee"}.get(
                turn.get("speaker", ""), "Unknown"
            )
            text = (turn.get("text") or "").strip()
            if text:
                lines.append(f"{speaker}: {text}")
    return "\n".join(lines) or None


def extract_duration_seconds(call: dict) -> int | None:
    """Longest attempt duration, from the attempt timestamps."""
    best: int | None = None
    for attempt in _recipient(call).get("attempts") or []:
        started, completed = attempt.get("started_at"), attempt.get("completed_at")
        if not (started and completed):
            continue
        try:
            delta = datetime.fromisoformat(
                completed.replace("Z", "+00:00")
            ) - datetime.fromisoformat(started.replace("Z", "+00:00"))
        except ValueError:
            continue
        seconds = int(delta.total_seconds())
        if seconds >= 0 and (best is None or seconds > best):
            best = seconds
    return best


def extract_provider_call_id(call: dict) -> str | None:
    """Dashboard-visible Call Record ID (may be null)."""
    for attempt in _recipient(call).get("attempts") or []:
        if attempt.get("provider_call_id"):
            return str(attempt["provider_call_id"])
    return None

# Business outcome -> call status. Note what is NOT here: the Calls API does
# not publish no-answer or decline codes, so those are only ever set from the
# structured result, never inferred from `failure_code`.
OUTCOME_TO_STATUS: dict[str, str] = {
    "completed": "completed",
    "only_confirmed_employment": "completed",
    "declined": "declined",
    "no_usable_answer": "failed",
    "wrong_person": "failed",
    "unknown": "failed",
}

_TRISTATE = {"yes": True, "no": False}


def rehire_to_bool(value: str | None) -> bool | None:
    """`qualified` and `unknown` stay None rather than collapsing to a boolean."""
    return _TRISTATE.get(value or "")


def enthusiasm_for_db(value: str | None) -> str | None:
    """Callers storing this in a strict enum column usually have no `unknown` member."""
    return None if value in (None, "unknown") else value
