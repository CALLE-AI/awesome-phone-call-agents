"""Intake validation and CALL-E result schemas."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .phone import validate_e164

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{3,80}$")
CAN_ATTEND = ("yes", "no", "unknown")
DISPOSITIONS = (
    "confirmed",
    "declined",
    "reschedule_requested",
    "voicemail",
    "no_answer",
    "wrong_number",
    "needs_human",
)


def recipient_result_schema() -> dict[str, Any]:
    """Per-recipient schema CALL-E fills after the call. Strict object."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["can_attend", "confirmed_time", "requested_time", "disposition"],
        "properties": {
            "can_attend": {
                "type": "string",
                "enum": list(CAN_ATTEND),
                "description": "Did the recipient confirm they will attend the booked slot?",
            },
            "confirmed_time": {
                "type": "string",
                "description": "ISO-8601 start time they confirmed, or empty string if none.",
            },
            "requested_time": {
                "type": "string",
                "description": "ISO-8601 start time they asked to move to, or empty string if none.",
            },
            "disposition": {
                "type": "string",
                "enum": list(DISPOSITIONS),
            },
        },
    }


def task_result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["completed_count"],
        "properties": {
            "completed_count": {"type": "integer"},
        },
    }


def _require_str(data: dict[str, Any], key: str, *, max_len: int = 200) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    value = value.strip()
    if len(value) > max_len:
        raise ValueError(f"{key} is too long (max {max_len})")
    return value


def _parse_iso(value: str, field: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field} must be ISO-8601, got {value!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone offset")
    return parsed.isoformat()


def load_intake(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"intake is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("intake must be a JSON object")
    return validate_intake(data)


def validate_intake(data: dict[str, Any]) -> dict[str, Any]:
    request_id = _require_str(data, "request_id", max_len=80)
    if not REQUEST_ID_RE.fullmatch(request_id):
        raise ValueError("request_id must be 3-80 chars of letters, numbers, . _ : -")

    if data.get("consent") is not True:
        raise ValueError("consent must be boolean true (recipient asked to be called)")
    if data.get("do_not_call") is True:
        raise ValueError("do_not_call is true; refusing to plan or place a call")

    appointment = data.get("appointment")
    if not isinstance(appointment, dict):
        raise ValueError("appointment object is required")
    starts_at = _parse_iso(_require_str(appointment, "starts_at", max_len=40), "appointment.starts_at")
    duration = appointment.get("duration_minutes", 30)
    if not isinstance(duration, int) or duration < 5 or duration > 480:
        raise ValueError("appointment.duration_minutes must be an integer 5-480")

    windows_in = data.get("reschedule_windows") or []
    if not isinstance(windows_in, list) or len(windows_in) > 6:
        raise ValueError("reschedule_windows must be a list of at most 6 ISO-8601 times")
    windows = [_parse_iso(str(item), "reschedule_windows[]") for item in windows_in]

    phone = validate_e164(_require_str(data, "phone", max_len=20))

    forbidden = ("password", "api_key", "secret", "token", "ssn", "card")
    blob = json.dumps(data).lower()
    for word in forbidden:
        if word in blob:
            raise ValueError(f"intake must not contain {word}")

    return {
        "request_id": request_id,
        "business_display_name": _require_str(data, "business_display_name", max_len=80),
        "caller_role": _require_str(data, "caller_role", max_len=80),
        "recipient_first_name": _require_str(data, "recipient_first_name", max_len=40),
        "phone": phone,
        "region": _require_str(data, "region", max_len=8).upper(),
        "locale": _require_str(data, "locale", max_len=16),
        "timezone": _require_str(data, "timezone", max_len=64),
        "appointment": {
            "service": _require_str(appointment, "service", max_len=80),
            "starts_at": starts_at,
            "duration_minutes": duration,
            "location": _require_str(appointment, "location", max_len=120),
        },
        "consent": True,
        "authorized_reason": _require_str(data, "authorized_reason", max_len=240),
        "reschedule_windows": windows,
        "do_not_call": False,
    }
