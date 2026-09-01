"""Domain-independent validation of a structured call result.

CALL-E validates the structured result against ``result_schema`` before it
returns a terminal call, and returns ``null`` when it cannot produce a
schema-valid one. That is a server-side guarantee about a server-side schema.
This module re-checks the same payload on this side, for three reasons:

* a fake provider and a replayed fixture never went through CALL-E at all;
* a null result has to become a named state rather than an exception;
* the workflow needs to distinguish "the model returned UNKNOWN" from "the
  field is missing", and only one of those is a malformed result.

It implements the subset of JSON Schema the CALL-E documentation lists as
supported, and nothing else, so a schema this module accepts is a schema the
platform can be asked to enforce.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_TYPE_MAP: dict[str, tuple[type, ...] | None] = {
    "object": (dict,),
    "string": (str,),
    "number": (int, float),
    "integer": (int,),
    "boolean": (bool,),
    "array": (list,),
    "null": None,
}


class SchemaError(ValueError):
    """The schema itself is not one CALL-E is documented to support."""


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    errors: tuple[str, ...]
    value: dict[str, Any] | None

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "errors": list(self.errors), "value": self.value}


def _matches_type(value: Any, declared: Any, path: str) -> list[str]:
    names = declared if isinstance(declared, list) else [declared]
    for name in names:
        if name not in _TYPE_MAP:
            raise SchemaError(f"unsupported JSON Schema type at {path}: {name!r}")
    for name in names:
        expected = _TYPE_MAP[name]
        if expected is None:
            if value is None:
                return []
            continue
        if name in ("number", "integer") and isinstance(value, bool):
            continue
        if isinstance(value, expected):
            return []
    return [f"{path}: expected type {names}, got {type(value).__name__}"]


def _validate_node(value: Any, schema: dict[str, Any], path: str) -> list[str]:
    errors: list[str] = []
    if "type" in schema:
        errors.extend(_matches_type(value, schema["type"], path))
        if errors:
            return errors
    if value is None:
        return errors
    if "enum" in schema:
        if value not in schema["enum"]:
            errors.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                errors.append(f"{path}.{name}: required field is missing")
        if schema.get("additionalProperties") is False:
            for name in value:
                if name not in properties:
                    errors.append(f"{path}.{name}: unexpected field")
        for name, child in properties.items():
            if name in value:
                errors.extend(_validate_node(value[name], child, f"{path}.{name}"))
    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            errors.extend(_validate_node(item, schema["items"], f"{path}[{index}]"))
    return errors


def validate_structured_result(
    structured_result: Any, schema: dict[str, Any]
) -> ValidationResult:
    """Validate a structured result without repairing or defaulting anything.

    A ``None`` result is not an error here. It is reported as ``ok=False`` with
    a named reason so the caller can turn it into a terminal state rather than
    a crash, which is the documented shape of a call that completed without a
    schema-valid result.
    """

    if structured_result is None:
        return ValidationResult(
            ok=False, errors=("structured_result is null",), value=None
        )
    if not isinstance(structured_result, dict):
        return ValidationResult(
            ok=False,
            errors=(
                f"structured_result must be an object, got "
                f"{type(structured_result).__name__}",
            ),
            value=None,
        )
    errors = _validate_node(structured_result, schema, "structured_result")
    if errors:
        return ValidationResult(ok=False, errors=tuple(errors), value=None)
    return ValidationResult(ok=True, errors=(), value=structured_result)
