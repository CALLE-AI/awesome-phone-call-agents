"""The structured result contract CALL-E must return, and its field vocabulary.

CALL-E supports a deliberately narrow slice of JSON Schema: `type`, `properties`,
`required`, `enum`, nested objects, simple `array.items`, `description` and
`additionalProperties: false`. Nullable union types are not among them, so
"not stated" is carried by the sentinel below rather than by `null`.

That constraint pushes the schema somewhere better anyway. Every field is
required, closed, and has an explicit place to put uncertainty, so the
extraction never has to invent a value to satisfy the shape — which is what
turns a vague call into a false promise.
"""

from __future__ import annotations

from typing import Any

NOT_STATED = "unknown"

OUTCOMES = [
    "promise_to_pay",
    "already_paid",
    "dispute",
    "refused",
    "wrong_number",
    "voicemail",
    "no_answer",
    "callback_requested",
    "unclear",
]

TERNARY = ["yes", "no", NOT_STATED]

PAYMENT_METHODS = ["bank_transfer", "card", "cheque", "upi", "other", NOT_STATED]

_SUPPORTED_KEYWORDS = {
    "type",
    "properties",
    "required",
    "enum",
    "items",
    "description",
    "additionalProperties",
}
_SUPPORTED_TYPES = {"object", "array", "string", "integer", "number", "boolean"}


class UnsupportedSchemaError(ValueError):
    """Raised when a result schema uses a feature CALL-E will reject."""


def promise_result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "outcome",
            "right_party_reached",
            "promise_made",
            "promised_amount",
            "promised_date",
            "payment_method",
            "dispute_raised",
            "dispute_reason",
            "evidence_quote",
        ],
        "properties": {
            "outcome": {
                "type": "string",
                "enum": OUTCOMES,
                "description": (
                    "Use promise_to_pay only when the person committed to a specific amount "
                    "and a specific date. Use already_paid when they state the invoice is "
                    "settled. Use dispute when they contest the invoice. Use unclear when the "
                    "call happened but no outcome above is supported by what was said."
                ),
            },
            "right_party_reached": {
                "type": "string",
                "enum": TERNARY,
                "description": (
                    "Use yes only when the person confirmed they are responsible for paying "
                    "this account. A colleague taking a message is no. Use unknown when it "
                    "was never established."
                ),
            },
            "promise_made": {
                "type": "string",
                "enum": TERNARY,
                "description": (
                    "Use yes only when both an amount and a date were stated and read back "
                    "without correction. 'Soon', 'next week sometime' and 'I'll look at it' "
                    "are no."
                ),
            },
            "promised_amount": {
                "type": "string",
                "description": (
                    "Exact amount as spoken, digits only with an optional decimal part, for "
                    f"example 1250.00. Use the exact string {NOT_STATED} when no amount was "
                    "stated. Never estimate or round."
                ),
            },
            "promised_date": {
                "type": "string",
                "description": (
                    "Calendar date of payment as YYYY-MM-DD. Resolve relative phrases such as "
                    "'next Friday' against the date stated at the start of the call. Use the "
                    f"exact string {NOT_STATED} when no date was agreed."
                ),
            },
            "payment_method": {
                "type": "string",
                "enum": PAYMENT_METHODS,
                "description": (
                    f"How they said they will pay. Use {NOT_STATED} when it was not discussed."
                ),
            },
            "dispute_raised": {
                "type": "string",
                "enum": TERNARY,
                "description": (
                    "Use yes when they contest the amount, the goods, the service, or say they "
                    "were already billed for this."
                ),
            },
            "dispute_reason": {
                "type": "string",
                "description": (
                    "One sentence in their own words explaining the dispute. Use the exact "
                    f"string {NOT_STATED} when dispute_raised is not yes."
                ),
            },
            "evidence_quote": {
                "type": "string",
                "description": (
                    "The single sentence the person actually said that best supports the "
                    "outcome. Quote them; do not summarise. Use the exact string "
                    f"{NOT_STATED} when nobody spoke."
                ),
            },
        },
    }


def assert_supported(schema: dict[str, Any], path: str = "result_schema") -> None:
    """Fail before the request rather than after CALL-E rejects it.

    A schema mistake is otherwise only discovered by a round trip that returns
    `result_schema_invalid`, which is a slow and confusing way to learn that a
    union type is unsupported.
    """
    _reject_unknown_keywords(schema, path)
    _reject_union_type(schema, path)
    _reject_open_objects(schema, path)
    for name, child in (schema.get("properties") or {}).items():
        assert_supported(child, f"{path}.{name}")
    items = schema.get("items")
    if isinstance(items, dict):
        assert_supported(items, f"{path}.items")


def _reject_unknown_keywords(schema: dict[str, Any], path: str) -> None:
    unsupported = sorted(set(schema) - _SUPPORTED_KEYWORDS)
    if unsupported:
        raise UnsupportedSchemaError(
            f"{path} uses schema features CALL-E does not support: {', '.join(unsupported)}."
        )


def _reject_union_type(schema: dict[str, Any], path: str) -> None:
    declared = schema.get("type")
    if isinstance(declared, list):
        raise UnsupportedSchemaError(
            f"{path} uses a union type {declared}. CALL-E accepts one type per field; "
            f"carry 'not stated' with an enum value such as {NOT_STATED!r} instead."
        )
    if declared is not None and declared not in _SUPPORTED_TYPES:
        raise UnsupportedSchemaError(f"{path} declares an unsupported type {declared!r}.")


def _reject_open_objects(schema: dict[str, Any], path: str) -> None:
    if schema.get("type") == "object" and schema.get("additionalProperties") is not False:
        raise UnsupportedSchemaError(
            f"{path} must set additionalProperties to false; CALL-E rejects open objects."
        )
