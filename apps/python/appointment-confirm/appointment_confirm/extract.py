"""Deterministic transcript extractor used by the mock/dev path.

Live CALL-E fills the same schema itself. This extractor exists so a fixture
conversation can produce structured JSON without credentials.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

YES_RE = re.compile(
    r"\b(yes|yeah|yep|confirm(?:ed)?|i(?:'ll| will) be there|that works|see you then)\b",
    re.I,
)
NO_RE = re.compile(
    r"\b(no|cannot|can'?t|won'?t make it|cancel(?:ling|ed)?)\b",
    re.I,
)
RESCHEDULE_RE = re.compile(
    r"\b(reschedule|another time|different time|move (?:it|the appointment)|instead)\b",
    re.I,
)
VOICEMAIL_RE = re.compile(
    r"\b(voicemail|leave (?:a |your )?message|after the (?:tone|beep)|not available)\b",
    re.I,
)
WRONG_RE = re.compile(r"\b(wrong number|you have the wrong|no one (?:here )?by that name)\b", re.I)
CLOCK_RE = re.compile(r"\b(\d{1,2}):(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b", re.I)


def _user_text(turns: list[dict[str, Any]]) -> str:
    return " ".join(
        str(turn.get("text") or "")
        for turn in turns
        if str(turn.get("speaker") or "").lower() in {"user", "human", "recipient"}
    )


def _time_needles(iso_value: str) -> set[str]:
    parsed = datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
    hour12 = parsed.strftime("%I").lstrip("0") or "12"
    minute = parsed.strftime("%M")
    ampm = parsed.strftime("%p").lower()
    needles = {
        parsed.strftime("%H:%M"),
        f"{hour12}{ampm}",
        f"{hour12} {ampm}",
        f"{hour12}:{minute} {ampm}",
        f"{hour12}:{minute}{ampm}",
        f"{hour12}:{minute}",
    }
    if minute == "00":
        needles.update({f"{hour12} {ampm}", f"{hour12}{ampm}", f"{int(hour12)} o'clock"})
    return {item.lower() for item in needles}


def parse_mentioned_time(text: str, intake: dict[str, Any]) -> str:
    """Map a spoken time onto a booked slot or an allowed reschedule window."""
    windows = [intake["appointment"]["starts_at"], *intake["reschedule_windows"]]
    lowered = text.lower().replace(".", "")

    for window in windows:
        if any(needle and needle in lowered for needle in _time_needles(window)):
            return window

    match = CLOCK_RE.search(text)
    if not match:
        return ""
    if match.group(1) is not None:
        hour = int(match.group(1))
        minute = int(match.group(2) or 0)
        ampm = (match.group(3) or "").lower()
    else:
        hour = int(match.group(4))
        minute = 0
        ampm = (match.group(5) or "").lower()
    if ampm == "pm" and hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return ""
    for window in windows:
        parsed = datetime.fromisoformat(window.replace("Z", "+00:00"))
        if parsed.hour == hour and parsed.minute == minute:
            return window
    booked = datetime.fromisoformat(intake["appointment"]["starts_at"].replace("Z", "+00:00"))
    return booked.replace(hour=hour, minute=minute, second=0, microsecond=0).isoformat()


def extract_from_turns(turns: list[dict[str, Any]], intake: dict[str, Any]) -> dict[str, str]:
    user = _user_text(turns)
    booked = intake["appointment"]["starts_at"]
    mentioned = parse_mentioned_time(user, intake)

    if not user.strip():
        return {
            "can_attend": "unknown",
            "confirmed_time": "",
            "requested_time": "",
            "disposition": "no_answer",
        }
    if VOICEMAIL_RE.search(user):
        return {
            "can_attend": "unknown",
            "confirmed_time": "",
            "requested_time": "",
            "disposition": "voicemail",
        }
    if WRONG_RE.search(user):
        return {
            "can_attend": "unknown",
            "confirmed_time": "",
            "requested_time": "",
            "disposition": "wrong_number",
        }

    wants_move = bool(RESCHEDULE_RE.search(user))
    said_yes = bool(YES_RE.search(user))
    said_no = bool(NO_RE.search(user))

    if wants_move or (said_no and mentioned and mentioned != booked):
        return {
            "can_attend": "no",
            "confirmed_time": "",
            "requested_time": mentioned if mentioned != booked else "",
            "disposition": "reschedule_requested",
        }
    if said_yes and not said_no:
        return {
            "can_attend": "yes",
            "confirmed_time": booked,
            "requested_time": "",
            "disposition": "confirmed",
        }
    if said_no:
        return {
            "can_attend": "no",
            "confirmed_time": "",
            "requested_time": "",
            "disposition": "declined",
        }
    return {
        "can_attend": "unknown",
        "confirmed_time": "",
        "requested_time": "",
        "disposition": "needs_human",
    }


def evidence_from_turns(turns: list[dict[str, Any]]) -> list[str]:
    quotes = []
    for turn in turns:
        speaker = str(turn.get("speaker") or "").lower()
        text = str(turn.get("text") or "").strip()
        if speaker in {"user", "human", "recipient"} and text:
            quotes.append(text)
    return quotes[:4]
