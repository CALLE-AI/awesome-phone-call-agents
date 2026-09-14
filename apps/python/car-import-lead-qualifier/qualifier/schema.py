"""The `result_schema` CALL-E must fill in.

Closed enums instead of free text: the answers stay comparable across calls,
feed a dashboard without parsing, and are much easier for the model to get
right. `evidence` is the one free-text field and carries no identifiers.

This is the lean first version. Refine it after reading the first real result,
not before.
"""

from __future__ import annotations

from typing import Any


def build_result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "right_person",
            "continued_after_ai_disclosure",
            "buying_intent",
            "payment_blocker",
            "evidence",
        ],
        "properties": {
            "right_person": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person confirmed they submitted the import inquiry.",
            },
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person agreed to continue after being told the caller is an AI assistant.",
            },
            "buying_intent": {
                "type": "string",
                "enum": [
                    "ready_to_buy",
                    "comparing",
                    "just_browsing",
                    "not_interested",
                    "unknown",
                ],
                "description": "How far the person is from a purchase decision.",
            },
            "vehicle_type": {
                "type": "string",
                "enum": [
                    "sedan",
                    "suv",
                    "pickup",
                    "minibus",
                    "truck",
                    "other",
                    "unknown",
                ],
                "description": "Type of vehicle the person wants to import. Only unknown when the person was asked and did not say; confirming the inquiry vehicle is not by itself a type.",
            },
            "budget_band_usd": {
                "type": "string",
                "enum": ["under_5k", "5k_10k", "10k_20k", "over_20k", "unknown"],
                "description": "Landed budget in US dollars, as a band. Each band includes its lower bound and excludes its upper one, so 10000 is 10k_20k and 20000 is over_20k. Use unknown when the person declines or is unclear.",
            },
            "payment_blocker": {
                "type": "string",
                "enum": [
                    "none",
                    "forex_unavailable",
                    "transfer_limit",
                    "deposit_too_high",
                    "needs_financing",
                    "awaiting_funds",
                    "unknown",
                ],
                "description": "What currently stops the person from paying. Use none when nothing does.",
            },
            "destination_port": {
                "type": "string",
                "enum": ["maputo", "beira", "nacala", "other", "unknown"],
                "description": "Port the person wants the vehicle delivered to.",
            },
            "wants_human_callback": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person consents to a follow-up call from a human import specialist.",
            },
            "evidence": {
                "type": "string",
                "description": "One short paraphrase supporting the fields above; no phone numbers.",
            },
        },
        "additionalProperties": False,
    }


def enum_of(field: str) -> tuple[str, ...]:
    """Answer vocabulary for one field, so the script and the routing agree."""
    return tuple(build_result_schema()["properties"][field]["enum"])


def spoken_options(field: str) -> str:
    """The enum as something the agent can read out, minus the unknown escape."""
    return ", ".join(
        value.replace("_", " ") for value in enum_of(field) if value != "unknown"
    )
