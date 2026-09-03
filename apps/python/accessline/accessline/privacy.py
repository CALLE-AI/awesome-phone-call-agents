"""Phone masking and transcript privacy helpers for AccessLine."""

from __future__ import annotations

import re
from typing import Any

_E164_LIKE = re.compile(r"^\+[1-9]\d{1,14}$")


def mask_phone(number: str | None) -> str | None:
    """Stable user-facing mask: +1******1234 (or equivalent length). Idempotent."""
    if number is None:
        return None
    raw = str(number)
    if not raw:
        return raw
    if "*" in raw:
        # Already masked — do not re-process.
        return raw
    if _E164_LIKE.match(raw) and len(raw) >= 6:
        return f"{raw[:2]}{'*' * max(4, len(raw) - 6)}{raw[-4:]}"
    # Non-E.164 / already partial: mask aggressively without echoing full content.
    digits = re.sub(r"\D", "", raw)
    if len(digits) >= 4:
        return f"+******{digits[-4:]}"
    return "+******"


def public_input_dict(
    *,
    venue_name: str,
    phone_number: str,
    visit_date: str | None,
    consent_confirmed: bool,
) -> dict[str, Any]:
    return {
        "venue_name": venue_name,
        "phone_number": mask_phone(phone_number),
        "visit_date": visit_date,
        "consent_confirmed": consent_confirmed,
    }


def sanitize_artifact_dict(
    payload: dict[str, Any],
    *,
    include_transcript: bool = False,
) -> dict[str, Any]:
    """Default serialization: mask phones, omit transcript body."""
    out = dict(payload)
    input_payload = out.get("input")
    if isinstance(input_payload, dict) and "phone_number" in input_payload:
        masked_input = dict(input_payload)
        masked_input["phone_number"] = mask_phone(str(masked_input.get("phone_number") or ""))
        out["input"] = masked_input

    transcript = out.pop("mock_transcript", None)
    if transcript is None:
        transcript = out.pop("transcript", None)
    else:
        out.pop("transcript", None)

    if include_transcript:
        out["mock_transcript"] = transcript
        out["transcript_retention"] = "OPT_IN_DEBUG"
    else:
        out["transcript_present"] = bool(transcript)
        # Never include transcript body by default.
        out.pop("mock_transcript", None)
        out.pop("transcript", None)
    return out
