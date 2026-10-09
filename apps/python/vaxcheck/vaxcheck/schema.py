"""CALL-E result schema.

One schema is sent with every task: ``RECIPIENT_RESULT_SCHEMA``, describing what
a single guardian call must establish.

VaxCheck places one CALL-E task per student rather than one task with many
recipients. A task reports a single ``task_completed`` and
``completion_confidence``, so batching students into one task would force every
child to share one confidence score - one voicemail at the end of a roster would
drag a clean consent at the start below threshold. Per-student tasks keep each
clinical decision backed by the confidence of that child's own call, and make the
per-student idempotency key meaningful.

Roster totals are counted locally from the triaged records rather than asked of
the model, so the numbers a nurse reads are arithmetic, not a generated field.

Every field is a small closed enum. Enums are what turn a conversation into a row
a nurse can act on; free text is only used for detail the nurse will read anyway,
never for a decision.

``unsure``/``unknown`` are first-class values, not failures. A guardian who does
not remember is the single most common real outcome, and it must be representable
so triage can route it to a human instead of guessing.
"""

from __future__ import annotations

from typing import Any

YES_NO_UNSURE = ["yes", "no", "unsure"]

RECIPIENT_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["reached_guardian", "identity_confirmed", "consent", "route"],
    "properties": {
        "reached_guardian": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": "Did a person answer and stay on the call.",
        },
        "identity_confirmed": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the person confirm they are the parent or legal guardian of "
                "the named student."
            ),
        },
        "consent": {
            "type": "string",
            "enum": ["granted", "declined", "unknown"],
            "description": "Consent for the school immunisation session.",
        },
        "route": {
            "type": "string",
            "enum": ["school_session", "private_provider", "decline", "undecided"],
            "description": (
                "Where the guardian wants the immunisation done: the free school "
                "session, their own doctor, declined entirely, or not yet decided."
            ),
        },
        "prior_dose_reported": {
            "type": "string",
            "enum": YES_NO_UNSURE,
            "description": "Has the student already had this vaccine.",
        },
        "prior_dose_detail": {
            "type": "string",
            "description": "Guardian's own words about prior doses. May be empty.",
        },
        "allergy_reported": {
            "type": "string",
            "enum": ["none", "mild", "severe", "unsure"],
            "description": (
                "Allergy history as reported by the guardian. Record what they say; "
                "do not interpret or assess it."
            ),
        },
        "allergy_detail": {
            "type": "string",
            "description": "Guardian's own words about allergies. May be empty.",
        },
        "unwell_today": {
            "type": "string",
            "enum": YES_NO_UNSURE,
            "description": "Is the student unwell or feverish right now.",
        },
        "guardian_questions": {
            "type": "string",
            "description": (
                "Any question the guardian asked that was not answered on the call. "
                "Empty when there were none."
            ),
        },
        "callback_requested": {
            "type": "string",
            "enum": ["yes", "no"],
            "description": "Did the guardian ask for a human to call them back.",
        },
    },
}


def recipient_fields() -> list[str]:
    return list(RECIPIENT_RESULT_SCHEMA["properties"].keys())


def enum_for(field: str) -> list[str] | None:
    prop = RECIPIENT_RESULT_SCHEMA["properties"].get(field, {})
    return prop.get("enum")
