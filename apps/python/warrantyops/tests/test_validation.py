"""Malformed results are rejected and UNKNOWN is never rewritten into something else."""

from __future__ import annotations

import copy

import pytest

from warrantyops.contract import build_extraction_schema
from warrantyops.validation import SchemaError, validate_structured_result

SCHEMA = build_extraction_schema()

VALID = {
    "coverage_status": "UNKNOWN",
    "coverage_evidence_quote": None,
    "resolution_status": "UNRESOLVED",
    "resolution_evidence_quote": None,
    "authorization_reference_heard": None,
    "authorization_reference_readback_performed": False,
    "authorization_reference_confirmed": None,
    "authorization_reference_confirmation_quote": None,
    "replacement_eta": None,
    "return_deadline": None,
    "required_documents": [],
    "next_action": None,
}


def test_accepts_a_result_that_matches_the_contract():
    result = validate_structured_result(copy.deepcopy(VALID), SCHEMA)
    assert result.ok
    assert result.errors == ()


def test_null_structured_result_is_a_named_state_not_an_exception():
    result = validate_structured_result(None, SCHEMA)
    assert result.ok is False
    assert result.value is None
    assert "null" in result.errors[0]


def test_rejects_a_non_object_result():
    assert validate_structured_result(["COVERED"], SCHEMA).ok is False


def test_rejects_an_unexpected_field():
    payload = copy.deepcopy(VALID)
    payload["rma_number"] = "48171"
    result = validate_structured_result(payload, SCHEMA)
    assert result.ok is False
    assert any("unexpected field" in error for error in result.errors)


def test_rejects_a_missing_required_field():
    payload = copy.deepcopy(VALID)
    del payload["resolution_status"]
    result = validate_structured_result(payload, SCHEMA)
    assert result.ok is False
    assert any("required field is missing" in error for error in result.errors)


def test_rejects_a_value_outside_the_enum():
    payload = copy.deepcopy(VALID)
    payload["coverage_status"] = "PROBABLY_COVERED"
    result = validate_structured_result(payload, SCHEMA)
    assert result.ok is False
    assert any("is not one of" in error for error in result.errors)


def test_rejects_a_wrongly_typed_field():
    payload = copy.deepcopy(VALID)
    payload["authorization_reference_readback_performed"] = "yes"
    assert validate_structured_result(payload, SCHEMA).ok is False


def test_rejects_a_wrongly_typed_array_item():
    payload = copy.deepcopy(VALID)
    payload["required_documents"] = [{"name": "serial plate"}]
    assert validate_structured_result(payload, SCHEMA).ok is False


def test_unknown_is_preserved_exactly():
    payload = copy.deepcopy(VALID)
    result = validate_structured_result(payload, SCHEMA)
    assert result.value is not None
    assert result.value["coverage_status"] == "UNKNOWN"
    assert result.value["replacement_eta"] is None
    assert result.value["required_documents"] == []


def test_unsupported_schema_type_is_rejected_loudly():
    with pytest.raises(SchemaError):
        validate_structured_result({"a": 1}, {"type": "object", "properties": {"a": {"type": "date"}}})
