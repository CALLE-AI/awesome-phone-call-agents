"""The result schema must stay inside the slice of JSON Schema CALL-E accepts.

A schema CALL-E rejects fails with `result_schema_invalid` only after a round
trip, so these run locally on every test invocation instead.
"""

from __future__ import annotations

import pytest

from kept.calls.schema import (
    NOT_STATED,
    UnsupportedSchemaError,
    assert_supported,
    promise_result_schema,
)


def test_the_shipped_schema_uses_only_supported_features() -> None:
    assert_supported(promise_result_schema())


def test_every_field_is_required_and_the_object_is_closed() -> None:
    schema = promise_result_schema()

    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])


def test_no_field_declares_a_union_type() -> None:
    """CALL-E accepts one type per field, which is why `unknown` exists."""
    types = [field["type"] for field in promise_result_schema()["properties"].values()]

    assert all(isinstance(declared, str) for declared in types)


def test_every_enum_offers_somewhere_to_put_uncertainty() -> None:
    """`outcome` spends its escape hatch on `unclear`; the rest use `unknown`."""
    escapes = {NOT_STATED, "unclear"}
    enums = [f["enum"] for f in promise_result_schema()["properties"].values() if "enum" in f]

    assert all(escapes & set(choices) for choices in enums)


def test_every_field_carries_a_description_for_the_extraction_model() -> None:
    fields = promise_result_schema()["properties"].values()

    assert all(field.get("description") for field in fields)


def test_a_union_type_is_rejected_with_the_reason_and_the_fix() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"amount": {"type": ["string", "null"]}},
    }

    with pytest.raises(UnsupportedSchemaError, match="union type"):
        assert_supported(schema)


@pytest.mark.parametrize("keyword", ["oneOf", "anyOf", "allOf", "$ref", "format", "pattern"])
def test_unsupported_keywords_are_rejected(keyword: str) -> None:
    schema = {"type": "object", "additionalProperties": False, "properties": {}, keyword: "x"}

    with pytest.raises(UnsupportedSchemaError, match="does not support"):
        assert_supported(schema)


def test_an_open_object_is_rejected() -> None:
    with pytest.raises(UnsupportedSchemaError, match="additionalProperties"):
        assert_supported({"type": "object", "properties": {}})


def test_nested_objects_are_checked_too() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"inner": {"type": "object", "properties": {}}},
    }

    with pytest.raises(UnsupportedSchemaError, match="result_schema.inner"):
        assert_supported(schema)
