"""The extraction contract CALL-E validates each reference call against.

The schema is built from the chosen question template, so a sales template
produces sales fields and an engineering template produces engineering ones.
Only JSON Schema features CALL-E supports are used: object/string/array,
properties, required, enum, nested objects, description, and
additionalProperties: false. $ref / oneOf / anyOf / allOf are rejected.
"""
from __future__ import annotations

from typing import Any

RATING_VALUES = ["1", "2", "3", "4", "5", "not_answered"]


def build_result_schema(questions: list[dict]) -> dict[str, Any]:
    """JSON Schema for one reference call, derived from the chosen template.

    Only features CALL-E supports are used: object/string/array, properties,
    required, enum, nested objects, description, additionalProperties: false.
    No $ref / oneOf / anyOf / allOf — those are rejected.
    """
    answer_props: dict[str, Any] = {}
    for q in questions:
        answer_props[q["id"]] = {
            "type": "object",
            "required": ["response", "rating"],
            "properties": {
                "response": {
                    "type": "string",
                    "description": (
                        "What the referee actually said in answer to: "
                        f"\"{q['text']}\". Summarise faithfully in one or two "
                        "sentences, keeping their own words where they matter. "
                        "Empty string if the question was never answered."
                    ),
                },
                "rating": {
                    "type": "string",
                    "enum": RATING_VALUES,
                    "description": (
                        "How positive the answer was, 1 (strongly negative) to "
                        "5 (strongly positive). Use 3 only for a genuinely "
                        "neutral answer. Use not_answered if the question was "
                        "skipped, deflected, or the referee declined to answer "
                        "— do not guess a middle rating in that case."
                    ),
                },
            },
            "additionalProperties": False,
        }

    return {
        "type": "object",
        "required": [
            "spoke_with_referee",
            "call_outcome",
            "referee_enthusiasm",
            "would_rehire",
            "answers",
            "strengths",
            "red_flags",
            "notable_quotes",
            "summary",
        ],
        "properties": {
            "spoke_with_referee": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": (
                    "Whether the person reached was the intended referee. Use no "
                    "for a wrong number, a colleague taking a message, or "
                    "voicemail. Use unknown if identity was never established."
                ),
            },
            "call_outcome": {
                "type": "string",
                "enum": [
                    "completed",
                    "only_confirmed_employment",
                    "declined",
                    "no_usable_answer",
                    "wrong_person",
                    "unknown",
                ],
                "description": (
                    "How the call ended. completed = the referee answered the "
                    "substantive questions. only_confirmed_employment = they "
                    "would confirm dates/title but nothing more, usually citing "
                    "company policy. declined = they refused to give a reference "
                    "at all. no_usable_answer = the call connected but produced "
                    "nothing usable. wrong_person = not the intended referee. "
                    "Use unknown only if none of these fit."
                ),
            },
            "referee_enthusiasm": {
                "type": "string",
                "enum": [
                    "very_enthusiastic",
                    "positive",
                    "neutral",
                    "hesitant",
                    "negative",
                    "unknown",
                ],
                "description": (
                    "Overall warmth of the referee toward the candidate, judged "
                    "on tone and willingness as much as words. Use hesitant when "
                    "they hedge, pause noticeably, or heavily qualify praise "
                    "(\"I think\", \"mostly\", \"generally\"). Use unknown if "
                    "there was not enough conversation to judge."
                ),
            },
            "would_rehire": {
                "type": "string",
                "enum": ["yes", "no", "qualified", "unknown"],
                "description": (
                    "Whether the referee would hire or work with the candidate "
                    "again. Use qualified when the yes carries a real condition "
                    "(\"in the right role\", \"with more support\"). Use unknown "
                    "if they were not asked or did not answer."
                ),
            },
            "answers": {
                "type": "object",
                "required": [q["id"] for q in questions],
                "properties": answer_props,
                "additionalProperties": False,
            },
            "strengths": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Specific strengths the referee named, one per item, in their "
                    "framing. Empty array if none were given."
                ),
            },
            "red_flags": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Concerns a hiring manager should see: reservations, "
                    "criticism, notable hesitation, or anything the referee "
                    "avoided answering. Empty array if none. Do not invent "
                    "concerns from a merely lukewarm tone."
                ),
            },
            "notable_quotes": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Up to three verbatim quotes that best capture the referee's "
                    "view, positive or negative. Empty array if none stand out."
                ),
            },
            "summary": {
                "type": "string",
                "description": (
                    "Three or four sentences a recruiter could paste into a "
                    "hiring debrief: what this referee said, how strongly, and "
                    "anything that needs following up."
                ),
            },
        },
        "additionalProperties": False,
    }
