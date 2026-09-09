"""The CALL-E result schema.

Every field here is an observation about the call. None of them is a verdict.
There is deliberately no `alive` field and no `grade` field: those are computed
by `grading.py` from what this schema captures.

Enum values follow CALL-E's guidance for business decisions -- string enums
with an explicit `unknown`, never booleans, because the call may not contain
enough evidence and `unknown` must survive as an answer.
"""

from __future__ import annotations

from .models import KnowledgePrompt


def result_schema(prompts: tuple[KnowledgePrompt, ...]) -> dict:
    """Build the strict JSON Schema CALL-E validates the call result against."""
    properties: dict[str, dict] = {
        "answered_by": {
            "type": "string",
            "enum": ["subject", "third_party", "voicemail", "ivr", "no_answer", "unknown"],
            "description": (
                "Classify who or what finally answered. Use subject only when the "
                "person who answered states they are the person being called. Use "
                "third_party when somebody else answered, including a relative, "
                "carer or receptionist. If an IVR transfers to a person, classify "
                "the person. Use unknown if the evidence is unclear."
            ),
        },
        "claimed_to_be_subject": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "After the caller explained the purpose of the call, did the person "
                "on the line state that they are the person being called? Use no "
                "when they said they are somebody else. Use unknown if they never "
                "answered the question."
            ),
        },
        "nonce_words_heard": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "The words the person repeated back, in the order they said them, "
                "one per array element. Transcribe what was actually said even if "
                "it is wrong or incomplete. Empty array if they said nothing back."
            ),
        },
        "nonce_words_reversed_heard": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "The words the person said when asked to repeat them in reverse "
                "order, in the order they said them, one per array element. "
                "Transcribe what was actually said even if it is wrong or "
                "incomplete. Empty array if they said nothing back."
            ),
        },
        "weekday_heard": {
            "type": "string",
            "description": (
                "The day of the week the person said it was, exactly as spoken, or "
                "an empty string if they did not say one."
            ),
        },
        "another_person_present": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Was another person audible on the line besides the person "
                "answering? Use unknown if you cannot tell."
            ),
        },
        "subject_reported_dead": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did anybody on the call state that the person being called has "
                "died? Report only what was said. Use unknown if it was not "
                "discussed."
            ),
        },
        "wrong_number": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the person indicate this number does not belong to the person "
                "being called, or that they have never heard of them?"
            ),
        },
        "distress_or_confusion": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did the person appear distressed, frightened, or unable to follow "
                "the questions? Use yes if they repeatedly did not understand."
            ),
        },
        "evidence_quotes": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Short direct quotes from the call that support the fields above. "
                "Quote the person's own words."
            ),
        },
    }

    for prompt in prompts:
        properties[f"answer_{prompt.prompt_id}"] = {
            "type": "string",
            "description": (
                f"The person's spoken answer to: {prompt.question} "
                "Transcribe what they said. Empty string if they did not answer. "
                "Do not judge whether it is correct."
            ),
        }

    return {
        "type": "object",
        "required": [
            "answered_by",
            "claimed_to_be_subject",
            "nonce_words_heard",
            "nonce_words_reversed_heard",
            "weekday_heard",
            "subject_reported_dead",
            "evidence_quotes",
        ],
        "properties": properties,
        "additionalProperties": False,
    }
