"""The extraction schema is the contract with CALL-E, so it is asserted, not assumed."""

from __future__ import annotations

from warrantyops.contract import (
    EXTRACTION_FIELDS,
    REQUIRED_EXTRACTION_FIELDS,
    STATED_TEXT_FIELDS,
    ClaimStatus,
    ConfirmedReference,
    ReferenceKind,
    build_extraction_schema,
)
from warrantyops.validation import documented_schema_violations


def test_schema_is_closed_and_complete():
    schema = build_extraction_schema()
    assert schema["additionalProperties"] is False
    assert tuple(schema["properties"]) == EXTRACTION_FIELDS
    assert tuple(schema["required"]) == REQUIRED_EXTRACTION_FIELDS


def test_schema_depends_on_nothing_call_e_leaves_undocumented():
    """No type arrays, no $ref/oneOf/anyOf/allOf, no additionalProperties true."""

    assert documented_schema_violations(build_extraction_schema()) == []


def test_not_established_is_always_reachable():
    schema = build_extraction_schema()
    assert "UNKNOWN" in schema["properties"]["claim_status"]["enum"]
    assert "UNKNOWN" in schema["properties"]["reference_kind"]["enum"]
    assert ClaimStatus.UNKNOWN.value in ClaimStatus._value2member_map_
    assert ReferenceKind.UNKNOWN.value in ReferenceKind._value2member_map_


def test_the_contract_covers_the_locked_question_set():
    schema = build_extraction_schema()
    for field_name in (
        "claim_status",
        "stated_reason",
        "required_correction",
        "required_documents",
        "stated_deadline",
        "escalation_path",
        "reference_kind",
        "reference_confirmed",
    ):
        assert field_name in schema["properties"], field_name


def test_every_field_this_workflow_asserts_has_a_grounding_route():
    """Enums get an evidence quote field; free text binds by transcript containment."""

    schema = build_extraction_schema()
    assert "claim_status_evidence_quote" in schema["properties"]
    assert "reference_confirmation_quote" in schema["properties"]
    for field_name in STATED_TEXT_FIELDS:
        assert field_name in schema["properties"], field_name


def test_enum_selection_rules_live_in_descriptions():
    schema = build_extraction_schema()
    status = schema["properties"]["claim_status"]["description"]
    assert "UNKNOWN for anything hedged" in status
    reference = schema["properties"]["reference_confirmed"]["description"]
    assert "corrected value" in reference


def test_a_confirmed_reference_records_its_kind_and_whether_it_was_corrected():
    reference = ConfirmedReference(
        value="CASE48178", kind=ReferenceKind.CASE, corrected=True
    )
    assert reference.to_dict() == {
        "value": "CASE48178",
        "kind": "CASE",
        "corrected": True,
    }
