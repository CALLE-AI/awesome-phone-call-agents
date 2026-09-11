"""
Python port of lib/validation.ts. Enforces CALL-E's supported JSON Schema subset on
any `result_schema` / `recipient_result_schema` the compiler produces.

CALL-E validates these server side and rejects — or silently nulls out the result of —
anything outside the subset. Running this before a request is ever built surfaces an
unsupported construct at compile time, not at demo time. See TECHNICAL_ARCH.md 4.5.
"""

from __future__ import annotations

from typing import Any

SUPPORTED_TYPES = ("object", "string", "number", "integer", "boolean", "array")

REJECTED_KEYWORDS = ("$ref", "oneOf", "anyOf", "allOf")

# Recipient field names CALL-E reserves on its own recipient objects. Only relevant to
# recipient_result_schema, which Veyra does not currently use.
RESERVED_RECIPIENT_FIELDS = (
    "summary",
    "status",
    "transcript",
    "call_id",
    "started_at",
    "completed_at",
    "duration",
)


class CalleSchemaError(ValueError):
    def __init__(self, message: str, path: str = "") -> None:
        self.path = path
        super().__init__(f"{message} (at {path or 'root'})")


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def assert_calle_schema_subset(schema: Any, path: str = "") -> None:
    """Raises CalleSchemaError if `schema` uses anything CALL-E does not support."""
    if not _is_plain_object(schema):
        raise CalleSchemaError("Schema must be a JSON object", path)

    for keyword in REJECTED_KEYWORDS:
        if keyword in schema:
            raise CalleSchemaError(f'CALL-E does not support "{keyword}"', path)

    if schema.get("additionalProperties") is True:
        raise CalleSchemaError('CALL-E does not support "additionalProperties: true"', path)

    schema_type = schema.get("type")
    if not isinstance(schema_type, str):
        raise CalleSchemaError('Every schema node needs a single string "type"', path)
    if schema_type not in SUPPORTED_TYPES:
        raise CalleSchemaError(
            f'Unsupported type "{schema_type}", expected one of {", ".join(SUPPORTED_TYPES)}',
            path,
        )

    if "enum" in schema and not isinstance(schema["enum"], list):
        raise CalleSchemaError('"enum" must be an array', path)

    if "required" in schema and not isinstance(schema["required"], list):
        raise CalleSchemaError('"required" must be an array of field names', path)

    if schema_type == "object":
        properties = schema.get("properties")
        if not _is_plain_object(properties):
            raise CalleSchemaError('An object schema needs "properties"', path)
        for key, child in properties.items():
            assert_calle_schema_subset(child, f"{path}.properties.{key}" if path else key)

    if schema_type == "array":
        items = schema.get("items")
        if isinstance(items, list):
            raise CalleSchemaError("CALL-E supports simple array.items only, not tuple forms", path)
        if items is None:
            raise CalleSchemaError('An array schema needs "items"', path)
        assert_calle_schema_subset(items, f"{path}.items")


def assert_no_reserved_recipient_fields(schema: Any) -> None:
    """Guards a recipient_result_schema against CALL-E's reserved field names."""
    if not _is_plain_object(schema):
        return
    properties = schema.get("properties")
    if not _is_plain_object(properties):
        return
    for name in properties:
        if name in RESERVED_RECIPIENT_FIELDS:
            raise CalleSchemaError(
                f'"{name}" is reserved by CALL-E on recipient objects',
                f"properties.{name}",
            )
