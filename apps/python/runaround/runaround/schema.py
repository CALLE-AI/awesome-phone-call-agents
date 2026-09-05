"""The result schema sent to CALL-E, and local validation of what comes back.

CALL-E validates the schema it was given. This module validates again on
arrival, because a chain that advances on an unchecked field advances on a
guess. Every field that can move the chain forward must survive both.
"""

from __future__ import annotations

from typing import Any

from runaround import phone

YES_NO_UNKNOWN = ["yes", "no", "unknown"]

#: JSON Schema handed to CALL-E as ``result_schema`` for one hop.
#:
#: Enum descriptions are extraction instructions: CALL-E passes them to the
#: model that reads the terminal call evidence. They say when to choose
#: ``unknown``, because a chain that cannot tell "no" from "not established"
#: will keep dialling on nothing.
HOP_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "owns_request",
        "question_answered",
        "answer_summary",
        "referral_target_name",
        "referral_target_phone",
        "referral_quote",
        "reference_number",
    ],
    "properties": {
        "owns_request": {
            "type": "string",
            "enum": YES_NO_UNKNOWN,
            "description": (
                "Use yes only when the person states that this desk or "
                "organization is responsible for handling the request. Use no "
                "when they state another party is responsible. Use unknown "
                "when responsibility was never established on the call."
            ),
        },
        "question_answered": {
            "type": "string",
            "enum": YES_NO_UNKNOWN,
            "description": (
                "Use yes only when the caller's question was actually "
                "answered on this call. A promise to answer later is no. Use "
                "unknown when the call did not reach a person or the answer "
                "was not intelligible."
            ),
        },
        "answer_summary": {
            "type": ["string", "null"],
            "description": (
                "One sentence stating the answer in the words the person "
                "used. Null when question_answered is not yes."
            ),
        },
        "referral_target_name": {
            "type": ["string", "null"],
            "description": (
                "Name of the organization or desk this person said to "
                "contact next. Null when no referral was given."
            ),
        },
        "referral_target_phone": {
            "type": ["string", "null"],
            "description": (
                "Phone number in E.164 format that this person gave for the "
                "referral, for example +15550100. Null when no number was "
                "spoken. Do not construct, complete, or look up a number that "
                "was not said on the call."
            ),
        },
        "referral_quote": {
            "type": ["string", "null"],
            "description": (
                "The words the person actually used to refer the caller "
                "elsewhere, quoted from the transcript. Null when no referral "
                "was given. Do not paraphrase and do not supply this field "
                "unless the referral was spoken."
            ),
        },
        "reference_number": {
            "type": ["string", "null"],
            "description": (
                "Case, ticket, or claim reference the person read out for "
                "this request. Null when none was given."
            ),
        },
    },
    "additionalProperties": False,
}


class ResultRejected(ValueError):
    """Raised when a returned result cannot be trusted to move the chain."""


def _enum_field(result: dict[str, Any], key: str) -> str:
    value = result.get(key)
    if value not in YES_NO_UNKNOWN:
        raise ResultRejected(
            f"{key} must be one of {YES_NO_UNKNOWN}, got {value!r}"
        )
    return value


def _optional_text(result: dict[str, Any], key: str) -> str | None:
    value = result.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ResultRejected(f"{key} must be a string or null, got {value!r}")
    text = value.strip()
    return text or None


def validate_hop_result(result: Any) -> dict[str, Any]:
    """Return a normalized hop result, or raise :class:`ResultRejected`.

    A missing result is not an empty result. ``None`` arrives when CALL-E
    could not extract a schema-valid object from the call, and it is refused
    here rather than read as "no referral".
    """
    if result is None:
        raise ResultRejected("no structured result was extracted from the call")
    if not isinstance(result, dict):
        raise ResultRejected("structured result must be a JSON object")

    unknown_keys = set(result) - set(HOP_RESULT_SCHEMA["properties"])
    if unknown_keys:
        raise ResultRejected(
            "unexpected result fields: " + ", ".join(sorted(unknown_keys))
        )

    normalized: dict[str, Any] = {
        "owns_request": _enum_field(result, "owns_request"),
        "question_answered": _enum_field(result, "question_answered"),
        "answer_summary": _optional_text(result, "answer_summary"),
        "referral_target_name": _optional_text(result, "referral_target_name"),
        "referral_quote": _optional_text(result, "referral_quote"),
        "reference_number": _optional_text(result, "reference_number"),
        "referral_target_phone": None,
    }

    raw_phone = _optional_text(result, "referral_target_phone")
    if raw_phone is not None:
        if not phone.is_valid(raw_phone):
            # A spoken number that does not normalize is kept out of the
            # chain. It is reported, not dialled.
            normalized["referral_target_phone"] = None
            normalized["referral_phone_rejected"] = raw_phone
        else:
            normalized["referral_target_phone"] = phone.normalize(raw_phone)

    if normalized["question_answered"] == "yes" and not normalized["answer_summary"]:
        raise ResultRejected(
            "question_answered is yes but answer_summary is empty"
        )

    return normalized
