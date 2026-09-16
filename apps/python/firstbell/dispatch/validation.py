"""A deliberately small JSON Schema check.

Why re-validate at all, when CALL-E validates `result_schema` server side and returns a
null `structured_result` when it cannot fill it?

Because the result can reach us over a channel we cannot authenticate. CALL-E webhooks are
currently unsigned, and the SDK says so itself: `unwrap`'s docstring reads "current CALL-E
webhooks are unsigned ... must not be used to parse current deliveries"
(`calle/webhooks.py:23-24`), and `verify`, deprecated alongside it, says CALL-E "no longer
sends timestamp or signature headers" (`calle/webhooks.py:13-15`). One quotation, two
methods, and the attribution matters: only one of them forbids the use, and the other offers
itself to anyone running their own signing layer. So anything arriving by webhook is an
untrusted hint. We re-fetch over the
authenticated API, and we still check the shape before acting on it, because a result that
drives a real-world decision should not be trusted on the strength of one hop.

This supports only the subset of JSON Schema we actually put in `result_schema`: object
type, `required`, `properties`, scalar `type`, and `enum`. It deliberately does not
implement the rest of the spec. If a schema uses something outside the subset,
`validate` raises rather than passing it silently, because a validator that quietly
ignores the rule it does not understand is worse than no validator.
"""

from __future__ import annotations

from typing import Any

_SUPPORTED_KEYWORDS = {"type", "required", "properties", "enum", "description",
                       "additionalProperties"}

_TYPES: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "object": dict,
    "array": list,
    "null": type(None),
}


class UnsupportedSchema(Exception):
    """The schema uses a keyword this checker does not implement."""


def assert_supported(schema: dict[str, Any]) -> None:
    """Fail loudly at construction time rather than silently at validation time."""
    unknown = set(schema) - _SUPPORTED_KEYWORDS
    if unknown:
        raise UnsupportedSchema(
            f"result_schema uses {sorted(unknown)}, which this checker does not implement. "
            "Either extend validation.py or simplify the schema."
        )
    if schema.get("type") not in (None, "object"):
        raise UnsupportedSchema("Top-level result_schema must be an object schema.")
    # `false` only, and the platform is the reason for both halves.
    #
    # `CreateCallRequest.result_schema` lists `additionalProperties: false` among its
    # supported features and `additionalProperties: true` among the unsupported ones, and
    # says hard validation comes from `type`, `required`, `enum` and `additionalProperties`.
    # This checker used to refuse the keyword outright, which made the strictest control
    # CALL-E offers unreachable from here: the shipped schema could not ask the platform to
    # reject an answer carrying a field nobody declared. A platform engineer reading this
    # file found it and quoted their own documentation back.
    if "additionalProperties" in schema and schema["additionalProperties"] is not False:
        raise UnsupportedSchema(
            "additionalProperties is supported here only as false, which is the only value "
            "CALL-E supports; true is on their unsupported list and anything else is not a "
            "rule either of us implements.")
    for name, prop in (schema.get("properties") or {}).items():
        unknown = set(prop) - _SUPPORTED_KEYWORDS
        if unknown:
            raise UnsupportedSchema(
                f"property {name!r} uses {sorted(unknown)}, not implemented."
            )
        declared = prop.get("type")
        if declared is not None and declared not in _TYPES:
            raise UnsupportedSchema(f"property {name!r} has unknown type {declared!r}.")

        # Refuse a rule this checker will not descend into.
        #
        # `properties` is in the supported set and `problems()` does not recurse, so a
        # property that was itself an object or an array schema passed construction and
        # then had every rule inside it ignored. A nested enum accepted any string at all
        # and an array accepted objects, integers and None side by side, and `problems()`
        # returned an empty list, which reads exactly like "this answer is valid".
        #
        # The module docstring is the statement of the rule that was being broken: "If a
        # schema uses something outside the subset, `validate` raises rather than passing
        # it silently, because a validator that quietly ignores the rule it does not
        # understand is worse than no validator." A nested block sat inside the keyword set
        # and outside the implementation, which is the gap between the two.
        #
        # `firstbell/domain.RESULT_SCHEMA` is flat, so nothing shipped was affected. This
        # refuses at construction, which is what `assert_supported` is for, and it is the
        # next caller who nests a field who needed it.
        if declared == "object" or "properties" in prop:
            raise UnsupportedSchema(
                f"property {name!r} is a nested object schema. This checker validates one "
                "level, so every rule inside it would be ignored and the answer would come "
                "back reported as valid. Flatten the field, or teach problems() to recurse "
                "before you declare it here."
            )
        if declared == "array":
            raise UnsupportedSchema(
                f"property {name!r} is an array schema. This checker does not look at "
                "elements, so a list of anything at all would be reported as valid. There "
                "is no `items` support and pretending otherwise is worse than refusing."
            )


def problems(value: Any, schema: dict[str, Any]) -> list[str]:
    """Return every reason `value` does not satisfy `schema`. Empty means valid."""
    if not isinstance(value, dict):
        return [f"expected an object, got {type(value).__name__}"]

    found: list[str] = []
    # The same rule locally that the schema asks CALL-E to apply. Passing a keyword upstream
    # and ignoring it here is the exact failure this module was written against: a validator
    # that walks past the rule it does not implement is worse than no validator. CALL-E
    # documents object schemas as strict by default and returns null rather than an
    # off-schema answer, so this fires on a result that reached us some other way, which is
    # the case the module exists for.
    if schema.get("additionalProperties") is False:
        declared = set(schema.get("properties") or {})
        for key in sorted(set(value) - declared):
            found.append(f"field {key!r} is not declared in the schema")

    for key in schema.get("required") or []:
        if key not in value:
            found.append(f"missing required field {key!r}")
        elif value[key] is None:
            found.append(f"required field {key!r} is null")

    for name, prop in (schema.get("properties") or {}).items():
        if name not in value or value[name] is None:
            continue
        actual = value[name]
        declared = prop.get("type")
        if declared is not None:
            expected = _TYPES[declared]
            # bool is a subclass of int in Python; do not let True satisfy "integer".
            if declared in ("integer", "number") and isinstance(actual, bool):
                found.append(f"{name!r} should be {declared}, got boolean")
                continue
            if not isinstance(actual, expected):
                found.append(
                    f"{name!r} should be {declared}, got {type(actual).__name__}"
                )
                continue
        allowed = prop.get("enum")
        if allowed is not None and actual not in allowed:
            found.append(f"{name!r} is {actual!r}, not one of {allowed}")

    return found


def is_valid(value: Any, schema: dict[str, Any]) -> bool:
    return not problems(value, schema)
