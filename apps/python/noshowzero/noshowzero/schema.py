"""CALL-E ``result_schema`` contracts for the two NoShowZero calls.

These are extraction contracts, not prompts. CALL-E validates the extracted JSON against them
server-side: ``description`` steers the extraction, while ``type``, ``enum``, ``required`` and
``additionalProperties: false`` enforce it. Every decision is a string enum with an ``unknown``
value, so missing evidence is explicit instead of guessed.
"""
from __future__ import annotations

from typing import Any

SUPPORTED_KEYWORDS = {"type", "properties", "required", "enum", "description", "additionalProperties"}

REMINDER_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["reached_patient", "outcome", "reschedule_preference", "notes"],
    "properties": {
        "reached_patient": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "yes only if the patient themself was reached live and took part in the "
            "conversation. no for voicemail, no answer, a wrong number, or someone else answering. "
            "unknown if identity was never established.",
        },
        "outcome": {
            "type": "string",
            "enum": ["confirmed", "cancelled", "wants_reschedule", "voicemail", "no_answer", "unknown"],
            "description": "confirmed when the patient says they will attend. wants_reschedule when they "
            "cannot make this time but want another one. cancelled when they cancel and do not want a new "
            "time. voicemail when a message was left. no_answer when nobody picked up. unknown otherwise.",
        },
        "reschedule_preference": {
            "type": "string",
            "description": "The days or times the patient said would work better, in their words. Empty "
            "string if none were given.",
        },
        "notes": {
            "type": "string",
            "description": "One or two sentences for the front desk. No medical details. Do not invent facts.",
        },
    },
    "additionalProperties": False,
}

OFFER_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["reached_patient", "accepted", "remove_from_waitlist", "notes"],
    "properties": {
        "reached_patient": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "yes only if the waitlisted patient themself was reached live and took part in "
            "the conversation.",
        },
        "accepted": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "yes only if the patient clearly agreed to take the offered appointment slot. no "
            "if they clearly declined. unknown if they did not decide.",
        },
        "remove_from_waitlist": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "yes only if the patient asked to be taken off the waitlist.",
        },
        "notes": {
            "type": "string",
            "description": "One sentence for the front desk. Do not invent facts.",
        },
    },
    "additionalProperties": False,
}


def unsupported_keywords(node: Any, path: str = "$") -> list[str]:
    """JSON Schema keywords CALL-E does not support, with their paths. Empty means the schema is safe."""
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key not in SUPPORTED_KEYWORDS:
                found.append(f"{path}.{key}")
            if key == "properties" and isinstance(value, dict):
                for prop, sub in value.items():
                    found.extend(unsupported_keywords(sub, f"{path}.properties.{prop}"))
            elif key == "additionalProperties" and value is not False:
                found.append(f"{path}.additionalProperties (only false is supported)")
    return found
