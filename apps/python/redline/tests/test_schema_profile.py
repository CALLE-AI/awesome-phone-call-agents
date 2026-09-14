"""Tests for the CALL-E ``result_schema`` profile validator.

Two questions are being answered here, and they are different:

* would CALL-E *accept* this schema (errors), and
* is this schema *shaped* so that the extraction model can answer honestly
  (warnings)?

A schema that passes the first and fails the second is exactly how "I'll see"
ends up stored as ``confirmed: true``.
"""

from __future__ import annotations

from typing import Any

import pytest

from redline.calle.schema_profile import (
    IssueLevel,
    validate_result_schema,
)


def messages(schema: Any, **kwargs: Any) -> list[str]:
    report = validate_result_schema(schema, **kwargs)
    return [f"{i.level}:{i.path}:{i.message}" for i in report.issues]


def paths_with(schema: Any, level: IssueLevel, **kwargs: Any) -> set[str]:
    report = validate_result_schema(schema, **kwargs)
    return {i.path for i in report.issues if i.level is level}


WELL_FORMED: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["attendance"],
    "properties": {
        "attendance": {
            "type": "string",
            "enum": ["confirmed", "declined", "unknown"],
            "description": (
                "Use confirmed only when the recipient clearly agreed. "
                "Use unknown when the call gave no clear answer."
            ),
        }
    },
}


class TestAcceptance:
    def test_a_well_formed_schema_is_clean(self) -> None:
        report = validate_result_schema(WELL_FORMED)
        assert report.is_clean, messages(WELL_FORMED)
        assert report.is_submittable

    def test_no_schema_is_not_a_problem(self) -> None:
        assert validate_result_schema(None).is_clean

    def test_a_non_object_schema_is_rejected(self) -> None:
        report = validate_result_schema(["not", "a", "schema"])
        assert not report.is_submittable

    def test_the_root_must_be_an_object(self) -> None:
        report = validate_result_schema({"type": "string"})
        assert not report.is_submittable
        assert any("not 'object'" in i.message for i in report.errors)


class TestRejectedKeywords:
    @pytest.mark.parametrize(
        "keyword",
        [
            "$ref",
            "oneOf",
            "anyOf",
            "allOf",
            "not",
            "if",
            "patternProperties",
            "format",
            "pattern",
            "$defs",
            "definitions",
        ],
    )
    def test_unsupported_keywords_are_errors(self, keyword: str) -> None:
        schema = {**WELL_FORMED, keyword: "whatever"}
        report = validate_result_schema(schema)
        assert not report.is_submittable
        assert keyword in paths_with(schema, IssueLevel.ERROR)

    def test_a_rejected_keyword_nested_in_a_property_is_found(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "window": {
                    "type": "string",
                    "description": "Delivery window.",
                    "format": "date-time",
                }
            },
        }
        assert "window.format" in paths_with(schema, IssueLevel.ERROR)

    def test_an_undocumented_keyword_is_only_a_warning(self) -> None:
        # It will most likely be ignored rather than rejected, so it must not
        # block a fix from being submitted.
        schema = {**WELL_FORMED, "minProperties": 1}
        report = validate_result_schema(schema)
        assert report.is_submittable
        assert "minProperties" in paths_with(schema, IssueLevel.WARNING)


class TestTypes:
    def test_a_union_type_is_rejected(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "note": {"type": ["string", "null"], "description": "A note."}
            },
        }
        assert "note.type" in paths_with(schema, IssueLevel.ERROR)

    def test_null_is_not_a_supported_type(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"note": {"type": "null", "description": "A note."}},
        }
        assert "note.type" in paths_with(schema, IssueLevel.ERROR)

    def test_an_untyped_leaf_is_a_warning(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"note": {"description": "A note."}},
        }
        assert "note" in paths_with(schema, IssueLevel.WARNING)


class TestObjects:
    def test_additional_properties_true_is_rejected(self) -> None:
        schema = {**WELL_FORMED, "additionalProperties": True}
        assert not validate_result_schema(schema).is_submittable

    def test_an_open_object_is_warned_about(self) -> None:
        schema = {k: v for k, v in WELL_FORMED.items() if k != "additionalProperties"}
        report = validate_result_schema(schema)
        assert report.is_submittable
        assert any("additionalProperties" in i.message for i in report.warnings)

    def test_required_naming_an_undeclared_field_is_rejected(self) -> None:
        schema = {**WELL_FORMED, "required": ["attendance", "ghost"]}
        report = validate_result_schema(schema)
        assert not report.is_submittable
        assert any("'ghost'" in i.message for i in report.errors)

    def test_a_property_without_a_schema_is_rejected(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"note": "just a string"},
        }
        assert not validate_result_schema(schema).is_submittable

    def test_nested_objects_are_walked(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "caller": {
                    "type": "object",
                    "description": "Who answered.",
                    "additionalProperties": False,
                    "properties": {"name": {"type": "string", "$ref": "#/x"}},
                }
            },
        }
        assert "caller.name.$ref" in paths_with(schema, IssueLevel.ERROR)


class TestGuidanceWarnings:
    def test_a_boolean_outcome_is_warned_about(self) -> None:
        # This is the defect behind "I'll see" becoming confirmed: true.
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "confirmed": {"type": "boolean", "description": "Confirmed?"}
            },
        }
        report = validate_result_schema(schema)
        assert report.is_submittable
        assert any("boolean" in i.message for i in report.warnings)

    def test_an_enum_without_an_unknown_member_is_warned_about(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "attendance": {
                    "type": "string",
                    "enum": ["confirmed", "declined"],
                    "description": "Attendance.",
                }
            },
        }
        report = validate_result_schema(schema)
        assert report.is_submittable
        assert any("unknown" in i.message for i in report.warnings)

    @pytest.mark.parametrize(
        "escape", ["unknown", "unclear", "not_stated", "no_answer"]
    )
    def test_any_recognised_escape_hatch_satisfies_the_check(self, escape: str) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "attendance": {
                    "type": "string",
                    "enum": ["confirmed", escape],
                    "description": "Attendance.",
                }
            },
        }
        assert validate_result_schema(schema).is_clean

    def test_a_missing_description_is_warned_about(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "attendance": {"type": "string", "enum": ["yes", "unknown"]}
            },
        }
        assert any(
            "description" in i.message for i in validate_result_schema(schema).warnings
        )

    def test_an_empty_enum_is_rejected(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "attendance": {
                    "type": "string",
                    "enum": [],
                    "description": "Attendance.",
                }
            },
        }
        assert not validate_result_schema(schema).is_submittable


class TestArrays:
    def test_an_array_without_items_is_rejected(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"tags": {"type": "array", "description": "Tags."}},
        }
        assert not validate_result_schema(schema).is_submittable

    def test_tuple_style_items_are_rejected(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "tags": {
                    "type": "array",
                    "description": "Tags.",
                    "items": [{"type": "string"}, {"type": "number"}],
                }
            },
        }
        assert not validate_result_schema(schema).is_submittable

    def test_a_simple_item_schema_is_accepted(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "tags": {
                    "type": "array",
                    "description": "Tags mentioned on the call.",
                    "items": {"type": "string"},
                }
            },
        }
        assert validate_result_schema(schema).is_clean


class TestRecursion:
    def test_a_self_referencing_schema_is_rejected(self) -> None:
        node: dict[str, Any] = {
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        }
        node["properties"]["child"] = node
        report = validate_result_schema(node)
        assert not report.is_submittable
        assert any("recursive" in i.message for i in report.errors)


class TestRecipientReservedFields:
    @pytest.mark.parametrize(
        "name", ["summary", "status", "transcript", "call_id", "attempts"]
    )
    def test_reserved_names_are_rejected_per_recipient(self, name: str) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {name: {"type": "string", "description": "Something."}},
        }
        assert not validate_result_schema(schema, per_recipient=True).is_submittable

    def test_the_same_names_are_fine_at_task_level(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"summary": {"type": "string", "description": "Something."}},
        }
        assert validate_result_schema(schema).is_submittable

    def test_the_suggested_rename_is_actionable(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {"summary": {"type": "string", "description": "Something."}},
        }
        report = validate_result_schema(schema, per_recipient=True)
        assert "customer_summary" in report.errors[0].remedy


class TestIssueRendering:
    def test_the_root_path_reads_as_root(self) -> None:
        report = validate_result_schema({"type": "string"})
        assert "<root>" in report.errors[0].render()

    def test_a_rendered_issue_names_level_path_and_remedy(self) -> None:
        schema = {**WELL_FORMED, "additionalProperties": True}
        rendered = validate_result_schema(schema).errors[0].render()
        assert rendered.startswith("[error]")
        assert "--" in rendered
