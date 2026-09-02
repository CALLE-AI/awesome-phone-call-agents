"""The extraction schema is the contract with CALL-E, so it is asserted, not assumed."""

from __future__ import annotations

from warrantyops.contract import (
    EXTRACTION_FIELDS,
    REQUIRED_EXTRACTION_FIELDS,
    CoverageStatus,
    ResolutionStatus,
    build_extraction_schema,
)
from warrantyops.validation import documented_schema_violations


def test_schema_is_closed_and_complete():
    schema = build_extraction_schema()
    assert schema["additionalProperties"] is False
    assert tuple(schema["properties"]) == EXTRACTION_FIELDS
    assert tuple(schema["required"]) == REQUIRED_EXTRACTION_FIELDS


def test_schema_depends_on_nothing_call_e_leaves_undocumented():
    """No type arrays, no $ref/oneOf/anyOf/allOf, no additionalProperties true.

    CALL-E documents `type` as one of six single values. `["string", "null"]`
    is used by several merged contributions here but is not documented, so
    "not stated" is expressed by omitting the field instead.
    """

    assert documented_schema_violations(build_extraction_schema()) == []


def test_unknown_is_always_reachable():
    schema = build_extraction_schema()
    assert "UNKNOWN" in schema["properties"]["coverage_status"]["enum"]
    assert "UNRESOLVED" in schema["properties"]["resolution_status"]["enum"]
    assert CoverageStatus.UNKNOWN.value in CoverageStatus._value2member_map_
    assert ResolutionStatus.UNRESOLVED.value in ResolutionStatus._value2member_map_


def test_every_actionable_value_has_an_evidence_field():
    schema = build_extraction_schema()
    for value_field in ("coverage_status", "resolution_status"):
        assert f"{value_field.rsplit('_', 1)[0]}_evidence_quote" in schema["properties"]
    assert "authorization_reference_confirmation_quote" in schema["properties"]


def test_enum_selection_rules_live_in_descriptions():
    schema = build_extraction_schema()
    coverage = schema["properties"]["coverage_status"]["description"]
    assert "UNKNOWN for anything hedged" in coverage
