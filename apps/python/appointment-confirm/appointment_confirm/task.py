"""Build the CALL-E task text and a stable idempotency key."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from . import WORKFLOW_TYPE


def _friendly_when(iso_value: str, timezone_name: str) -> str:
    parsed = datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
    return f"{parsed.strftime('%A %d %B %Y at %H:%M')} ({timezone_name})"


def build_task(intake: dict[str, Any]) -> str:
    apt = intake["appointment"]
    when = _friendly_when(apt["starts_at"], intake["timezone"])
    windows = intake["reschedule_windows"]
    if windows:
        window_lines = "\n".join(f"- {_friendly_when(item, intake['timezone'])}" for item in windows)
        window_block = (
            "If they cannot attend the booked slot, offer ONLY these alternative times "
            "and capture the one they choose:\n"
            f"{window_lines}\n"
            "Do not invent other times. Do not book, move, or cancel anything in a calendar."
        )
    else:
        window_block = (
            "If they cannot attend, capture any time they request as requested_time text, "
            "but do not promise a new booking. Leave rescheduling to a human."
        )

    return f"""You are an AI phone assistant calling on behalf of {intake['business_display_name']}.
Disclose immediately that you are AI, that this is one appointment-confirmation call, and that
{intake['caller_role']} authorized it because: {intake['authorized_reason']}

Speak with {intake['recipient_first_name']}. If you have the wrong person, apologise, end the call,
and set disposition to wrong_number.

Purpose: confirm one existing appointment. Do not sell, collect payment, give medical/legal/financial
advice, or discuss anything outside this booking.

Appointment:
- Service: {apt['service']}
- When: {when}
- Duration: {apt['duration_minutes']} minutes
- Location: {apt['location']}

Ask:
1. Is this {intake['recipient_first_name']}?
2. Can they attend this appointment? Capture can_attend as yes, no, or unknown.
3. If yes, read the time back and capture confirmed_time as the booked start time.
4. If no, ask whether they want to cancel or move.
{window_block}

If voicemail answers, leave a short message asking them to call the studio back. Do not include
any other personal details. Set disposition to voicemail and can_attend to unknown.
If they decline, set can_attend to no and disposition to declined.
If they ask to move to one of the allowed windows, set can_attend to no, disposition to
reschedule_requested, and requested_time to that window.
Do not infer yes from silence. Ambiguity must be unknown / needs_human.

Return the structured result. Do not update any calendar yourself.
"""


def idempotency_key(intake: dict[str, Any]) -> str:
    starts = intake["appointment"]["starts_at"]
    return f"{WORKFLOW_TYPE}:{intake['request_id']}:{starts}"
