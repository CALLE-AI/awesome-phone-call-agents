"""Malformed results are rejected and UNKNOWN is never rewritten into something else."""

from __future__ import annotations

import pytest

from warrantyops.contract import build_extraction_schema
from warrantyops.validation import SchemaError, validate_structured_result

SCHEMA = build_extraction_schema()


def base_payload() -> dict:
    payload = {
        "claim_status": "UNKNOWN",
        "claim_status_evidence_quote": None,
        "stated_reason": None,
        "required_correction": None,
        "required_documents": [],
        "stated_deadline": None,
        "escalation_path": None,
        "stated_next_action": None,
        "reference_kind": "UNKNOWN",
        "reference_heard": None,
        "reference_readback_performed": False,
        "reference_confirmed": None,
        "reference_confirmation_quote": None,
    }
    return payload


def test_accepts_a_result_that_matches_the_contract():
    result = validate_structured_result(base_payload(), SCHEMA)
    assert result.ok
    assert result.errors == ()


def test_null_structured_result_is_a_named_state_not_an_exception():
    result = validate_structured_result(None, SCHEMA)
    assert result.ok is False
    assert result.value is None
    assert "null" in result.errors[0]


def test_rejects_a_non_object_result():
    assert validate_structured_result(["STATED_RETURNED"], SCHEMA).ok is False


def test_rejects_an_unexpected_field():
    payload = base_payload()
    payload["recovery_estimate"] = "high"
    result = validate_structured_result(payload, SCHEMA)
    assert result.ok is False
    assert any("unexpected field" in error for error in result.errors)


def test_rejects_a_missing_required_field():
    payload = base_payload()
    del payload["claim_status"]
    result = validate_structured_result(payload, SCHEMA)
    assert result.ok is False
    assert any("required field is missing" in error for error in result.errors)


def test_rejects_a_value_outside_the_enum():
    payload = base_payload()
    payload["claim_status"] = "PROBABLY_RETURNED"
    result = validate_structured_result(payload, SCHEMA)
    assert result.ok is False
    assert any("is not one of" in error for error in result.errors)


def test_rejects_a_wrongly_typed_field():
    payload = base_payload()
    payload["reference_readback_performed"] = "yes"
    assert validate_structured_result(payload, SCHEMA).ok is False


def test_rejects_a_wrongly_typed_array_item():
    payload = base_payload()
    payload["required_documents"] = [{"name": "installation invoice"}]
    assert validate_structured_result(payload, SCHEMA).ok is False


def test_unknown_is_preserved_exactly():
    payload = base_payload()
    result = validate_structured_result(payload, SCHEMA)
    assert result.value is not None
    assert result.value["claim_status"] == "UNKNOWN"
    assert result.value["stated_deadline"] is None
    assert result.value["required_documents"] == []


def test_unsupported_schema_type_is_rejected_loudly():
    with pytest.raises(SchemaError):
        validate_structured_result(
            {"a": 1}, {"type": "object", "properties": {"a": {"type": "date"}}}
        )


# --- the remaining validation surfaces ----------------------------------------


def test_the_result_renders_as_a_dict():
    result = validate_structured_result(base_payload(), SCHEMA)
    assert result.to_dict() == {
        "ok": True,
        "errors": [],
        "value": result.value,
    }


def test_a_boolean_is_never_a_number():
    result = validate_structured_result(
        {"a": True},
        {"type": "object", "properties": {"a": {"type": "integer"}}},
    )
    assert result.ok is False
    assert any("got bool" in error for error in result.errors)


def test_a_typeless_node_with_no_value_stops_its_own_walk():
    """A schema without a ``type`` key and a value of ``None`` contributes no
    findings — the walk for that node ends there, before enum or keyword
    checks could misfire on an absent value."""

    from warrantyops.validation import _validate_node

    assert _validate_node(None, {}, "$.a") == []


def test_the_schema_guard_names_every_kind_of_drift():
    from warrantyops.validation import documented_schema_violations

    problems = "\n".join(
        documented_schema_violations(
            {
                "type": ["string", "null"],
                "additionalProperties": True,
                "$ref": "#/definitions/x",
                "surprise": 1,
            }
        )
    )
    assert "type must be a single documented value" in problems
    assert "only additionalProperties false is supported" in problems
    assert "$ref is documented as unsupported" in problems
    assert "surprise is not a documented keyword" in problems

    unknown_type = documented_schema_violations({"type": "date"})
    assert "'date' is not a documented type" in "\n".join(unknown_type)
