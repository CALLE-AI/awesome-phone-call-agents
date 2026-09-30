"""The CALL-E ``result_schema`` for one speed-to-lead qualification call.

This is an extraction contract, not a prompt. CALL-E validates the extracted JSON
against it server-side: ``description`` steers the extraction, while ``type``,
``enum``, ``required`` and ``additionalProperties: false`` enforce it. Every business
decision is a string enum with an ``unknown`` value, so missing evidence is explicit
instead of being guessed.
"""
from __future__ import annotations

from typing import Any

SUPPORTED_KEYWORDS = {"type", "properties", "required", "enum", "description", "additionalProperties"}

RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "reached_lead",
        "interest_level",
        "project_summary",
        "budget_range",
        "budget_clarity",
        "timeline",
        "timeline_urgency",
        "decision_maker",
        "sentiment",
        "wants_booking_link",
        "lead_notes",
    ],
    "properties": {
        "reached_lead": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "yes only if the person who submitted the form was reached live and took part "
            "in the conversation. no for voicemail, a wrong number, or someone else answering. unknown "
            "if identity was never established.",
        },
        "interest_level": {
            "type": "string",
            "enum": ["strong", "moderate", "low", "not_interested", "unknown"],
            "description": "strong when the lead wants a quote, a visit, pricing, or a concrete next step. "
            "moderate for real interest without a next step. low for minimal engagement. not_interested "
            "when they clearly decline. unknown when evidence is insufficient.",
        },
        "project_summary": {
            "type": "string",
            "description": "One sentence describing the project in the lead's own terms. Empty string if "
            "not discussed.",
        },
        "budget_range": {
            "type": "string",
            "description": "The budget exactly as the lead stated it, for example 'around $40-50k'. Empty "
            "string if never mentioned.",
        },
        "budget_clarity": {
            "type": "string",
            "enum": ["specific", "rough", "none_given", "unknown"],
            "description": "specific for a number or tight range, rough for a loose ballpark, none_given "
            "when asked but they would not say, unknown when never asked.",
        },
        "timeline": {
            "type": "string",
            "description": "When the lead wants the work done, in their words. Empty string if never "
            "mentioned.",
        },
        "timeline_urgency": {
            "type": "string",
            "enum": ["within_30_days", "one_to_three_months", "over_three_months", "just_researching", "unknown"],
            "description": "Bucket for the stated start time. just_researching when they have no plan to "
            "start yet.",
        },
        "decision_maker": {
            "type": "string",
            "enum": ["yes", "shared", "no", "unknown"],
            "description": "yes if the lead decides alone, shared if they decide together with a spouse or "
            "partner, no if someone else decides, unknown if not established.",
        },
        "sentiment": {
            "type": "string",
            "enum": ["positive", "neutral", "negative", "unknown"],
            "description": "The lead's overall tone during the call.",
        },
        "wants_booking_link": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "yes only if the lead explicitly agreed to receive a booking link by text message.",
        },
        "lead_notes": {
            "type": "string",
            "description": "Two or three sentences for the sales team: what they want, constraints, and the "
            "best next step. Do not invent facts.",
        },
    },
    "additionalProperties": False,
}


def unsupported_keywords(node: Any, path: str = "$") -> list[str]:
    """Paths of any JSON Schema keyword outside the subset CALL-E supports."""
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key not in SUPPORTED_KEYWORDS:
                found.append(f"{path}.{key}")
            if key == "properties" and isinstance(value, dict):
                for name, child in value.items():
                    found.extend(unsupported_keywords(child, f"{path}.properties.{name}"))
    return found
