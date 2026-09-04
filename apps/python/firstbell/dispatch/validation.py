"""A deliberately small JSON Schema check.

Why re-validate at all, when CALL-E validates `result_schema` server side and returns a
null `structured_result` when it cannot fill it?

Because the result can reach us over a channel we cannot authenticate. CALL-E webhooks are
currently unsigned: the SDK's `verify` and `unwrap` are both deprecated and their
docstrings say "current CALL-E webhooks are unsigned ... must not be used to parse current
deliveries." So anything arriving by webhook is an untrusted hint. We re-fetch over the
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

_SUPPORTED_KEYWORDS = {"type", "required", "properties", "enum", "description"}

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
    for name, prop in (schema.get("properties") or {}).items():
        unknown = set(prop) - _SUPPORTED_KEYWORDS
        if unknown:
            raise UnsupportedSchema(
                f"property {name!r} uses {sorted(unknown)}, not implemented."
            )
        declared = prop.get("type")
        if declared is not None and declared not in _TYPES:
            raise UnsupportedSchema(f"property {name!r} has unknown type {declared!r}.")


def problems(value: Any, schema: dict[str, Any]) -> list[str]:
    """Return every reason `value` does not satisfy `schema`. Empty means valid."""
    if not isinstance(value, dict):
        return [f"expected an object, got {type(value).__name__}"]

    found: list[str] = []
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
