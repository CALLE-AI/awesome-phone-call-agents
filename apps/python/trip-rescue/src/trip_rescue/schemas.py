"""JSON schemas for the structured result CALL-E returns after the
rebooking call. Keeping this as a closed, enum-driven vocabulary (rather
than free text) means the decision layer in orchestrator.py never has to
parse or infer intent from a transcript -- it makes a deterministic choice
from a fixed set of outcomes, the same design KinCall uses elsewhere in this
repo for the same reason: a voice model should describe what happened, not
decide what happens next.
"""

from __future__ import annotations

DECISION_VALUES = [
    "accepted_option_1",
    "accepted_option_2",
    "accepted_option_3",
    "declined_all",
    "requested_human_agent",
]

REBOOKING_CALL_RESULT_SCHEMA: dict = {
    "type": "object",
    "required": ["reachable", "decision"],
    "properties": {
        "reachable": {
            "type": "boolean",
            "description": "True if the traveler answered and the options were read out.",
        },
        "decision": {
            "type": "string",
            "enum": DECISION_VALUES,
            "description": (
                "Which numbered option the traveler chose, or declined_all if none worked "
                "for them, or requested_human_agent if they asked to speak to a person."
            ),
        },
        "traveler_notes": {
            "type": "string",
            "description": "Anything the traveler said worth surfacing to a human (e.g. why they declined).",
        },
    },
}
