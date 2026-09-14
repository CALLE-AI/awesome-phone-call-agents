"""The strict local validator, and the shape of the schema actually sent to CALL-E."""

from __future__ import annotations

import pytest

from positive_contact.script import (
    NOTES_FOR_HUMAN_MAX_LENGTH,
    RECIPIENT_RESULT_SCHEMA,
    RESERVED_RESULT_FIELDS,
    ResultValidationError,
    validate_recipient_result,
)

VALID = {
    "contact_type": "live_person",
    "acknowledged": "yes",
    "spoke_with": "customer",
    "needs_assistance": "none",
    "callback_window": "",
    "preferred_language": "",
    "notify_alternate_contact": "unknown",
    "notes_for_human": "Asked about the resource center.",
}


def test_a_valid_result_passes():
    assert validate_recipient_result(VALID) == VALID


def test_only_the_required_fields_are_needed():
    assert validate_recipient_result(
        {"contact_type": "voicemail", "acknowledged": "unknown", "needs_assistance": "unknown"}
    )


def test_an_unexpected_key_fails():
    with pytest.raises(ResultValidationError, match="unexpected key"):
        validate_recipient_result({**VALID, "medical_condition": "asthma"})


def test_a_missing_required_field_fails():
    payload = dict(VALID)
    del payload["acknowledged"]
    with pytest.raises(ResultValidationError, match="missing required"):
        validate_recipient_result(payload)


@pytest.mark.parametrize(
    "field,value",
    [
        ("contact_type", "answered"),
        ("acknowledged", "true"),
        ("spoke_with", "neighbour"),
        ("needs_assistance", "medical"),
        ("notify_alternate_contact", "maybe"),
    ],
)
def test_a_value_outside_the_enum_fails(field, value):
    with pytest.raises(ResultValidationError, match="not one of"):
        validate_recipient_result({**VALID, field: value})


def test_a_null_result_fails_rather_than_defaulting():
    with pytest.raises(ResultValidationError, match="null"):
        validate_recipient_result(None)


def test_a_non_object_result_fails():
    with pytest.raises(ResultValidationError, match="must be an object"):
        validate_recipient_result(["live_person"])


def test_a_non_string_value_fails():
    with pytest.raises(ResultValidationError, match="must be a string"):
        validate_recipient_result({**VALID, "acknowledged": True})


def test_an_over_long_note_fails_locally():
    """The wire schema cannot carry maxLength, so the local validator enforces it."""
    with pytest.raises(ResultValidationError, match="character limit"):
        validate_recipient_result(
            {**VALID, "notes_for_human": "x" * (NOTES_FOR_HUMAN_MAX_LENGTH + 1)}
        )


def test_a_note_exactly_at_the_limit_passes():
    assert validate_recipient_result(
        {**VALID, "notes_for_human": "x" * NOTES_FOR_HUMAN_MAX_LENGTH}
    )


def test_a_reserved_call_e_field_name_fails():
    # `summary` is a reserved recipient response field in the CALL-E contract.
    with pytest.raises(ResultValidationError):
        validate_recipient_result({**VALID, "summary": "anything"})


# -- the transmitted schema -------------------------------------------------------


def test_the_wire_schema_is_strict():
    assert RECIPIENT_RESULT_SCHEMA["additionalProperties"] is False
    assert RECIPIENT_RESULT_SCHEMA["type"] == "object"


def test_the_wire_schema_carries_no_max_length():
    """`maxLength` is not in the CALL-E supported schema subset; sending it risks
    recipient_result_schema_invalid. See docs/adapter-notes.md."""
    for name, spec in RECIPIENT_RESULT_SCHEMA["properties"].items():
        assert "maxLength" not in spec, name


def test_the_wire_schema_uses_only_supported_features():
    supported_keys = {"type", "enum", "description", "properties", "required",
                      "additionalProperties", "items"}
    assert set(RECIPIENT_RESULT_SCHEMA) <= supported_keys
    for name, spec in RECIPIENT_RESULT_SCHEMA["properties"].items():
        assert set(spec) <= supported_keys, name
        assert spec["type"] == "string", name


def test_the_wire_schema_uses_no_reserved_field_name():
    assert not (set(RECIPIENT_RESULT_SCHEMA["properties"]) & RESERVED_RESULT_FIELDS)


def test_every_enum_field_offers_an_unknown_value():
    """The contract recommends an `unknown` value wherever the call may not settle it."""
    for name in ("contact_type", "acknowledged", "spoke_with", "needs_assistance",
                 "notify_alternate_contact"):
        assert "unknown" in RECIPIENT_RESULT_SCHEMA["properties"][name]["enum"], name


def test_every_field_carries_a_description_for_the_extraction_model():
    for name, spec in RECIPIENT_RESULT_SCHEMA["properties"].items():
        assert spec.get("description"), name


def test_the_required_fields_are_the_three_the_ladder_needs():
    assert RECIPIENT_RESULT_SCHEMA["required"] == [
        "contact_type",
        "acknowledged",
        "needs_assistance",
    ]
