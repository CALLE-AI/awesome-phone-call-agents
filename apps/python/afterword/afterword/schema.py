"""The CALL-E result schema.

Every field here is an observation about what somebody said on the phone. None
of them is a verdict. There is deliberately no `grade` field, no field asking
whether the answer matches the institution's published policy, and no field
asking whether the account can now be closed: those are computed by
`capture.py` and `conflict.py` from what this schema captures.

Enum values follow CALL-E's guidance for business decisions -- string enums
with an explicit `unknown`, never booleans, because a call may end before the
question is answered and `unknown` must survive as an answer.
"""

from __future__ import annotations


def result_schema() -> dict:
    """Build the strict JSON Schema CALL-E validates the call result against."""
    properties: dict[str, dict] = {
        "reached": {
            "type": "string",
            "enum": [
                "agent",
                "ivr_dead_end",
                "voicemail",
                "no_answer",
                "queue_abandoned",
                "unknown",
            ],
            "description": (
                "Classify how far the call got. Use agent only when a person "
                "spoke to you. Use ivr_dead_end when an automated menu offered "
                "no route to a person. Use queue_abandoned when you were held "
                "in a queue and the call ended before a person answered. Use "
                "unknown if the evidence is unclear."
            ),
        },
        "department_named": {
            "type": "string",
            "description": (
                "The name of the team the person said handles a reported death, "
                "exactly as they said it, for example a bereavement team or an "
                "estates department. Empty string if they did not name one."
            ),
        },
        "documents_named": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Each document the person said is needed, one per array "
                "element, in the words they used. Empty array if they named "
                "none. Do not add documents you expect them to want."
            ),
        },
        "certified_copy_accepted": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the person say a certified or photocopied death "
                "certificate is acceptable? Use no when they said an original "
                "is required. Use unknown if it was not discussed or the "
                "answer was hedged."
            ),
        },
        "direct_debits_action": {
            "type": "string",
            "enum": [
                "continue",
                "cancelled_on_notification",
                "frozen",
                "executor_must_instruct",
                "unknown",
            ],
            "description": (
                "What the person said happens to direct debits and standing "
                "orders between now and the paperwork arriving. Use continue "
                "when they said payments carry on unchanged, frozen when the "
                "account is held, executor_must_instruct when they said the "
                "executor has to tell them what to do. Use unknown if it was "
                "not discussed."
            ),
        },
        "reference_opened": {
            "type": "string",
            "description": (
                "Any case, notification or bereavement reference the person "
                "read out for the family to quote later, exactly as spoken. "
                "Empty string if they gave none."
            ),
        },
        "executor_only": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the person say they can only discuss this with the named "
                "executor directly, and not with somebody calling on their "
                "behalf? Use yes even if they were helpful about it."
            ),
        },
        "notification_accepted_by_phone": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the person say a death can be reported over the phone, or "
                "that documents must be sent before anything is recorded? Use "
                "unknown if it was not discussed."
            ),
        },
        "evidence_quotes": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Short direct quotes from the call that support the fields "
                "above. Quote the person's own words. These are the only part "
                "of the call that is kept."
            ),
        },
    }

    return {
        "type": "object",
        "required": [
            "reached",
            "department_named",
            "documents_named",
            "certified_copy_accepted",
            "direct_debits_action",
            "executor_only",
            "evidence_quotes",
        ],
        "properties": properties,
        "additionalProperties": False,
    }
