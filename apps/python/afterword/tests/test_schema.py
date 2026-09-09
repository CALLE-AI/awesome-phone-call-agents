"""The CALL-E result schema.

Two things are being defended. First, CALL-E's documented constraints on a
result schema -- flat, closed, no composition keywords -- because a schema it
cannot compile fails at call time, on a real line, in front of a bereavement
adviser.

Second, and more important: the schema captures observations only. The moment a
`grade` field or a `matches_policy` field appears, the verdict has moved out of
`capture.py` and into a language model, and the whole design is gone.
"""

from __future__ import annotations

from typing import Any, Iterator

import pytest

from afterword.models import DirectDebits, Reached
from afterword.schema import result_schema

#: CALL-E compiles a flat subset of JSON Schema. Anything else is unsupported.
ALLOWED_TYPES = {"object", "string", "number", "integer", "boolean", "array"}

#: Composition keywords CALL-E does not resolve.
FORBIDDEN_KEYWORDS = ("$ref", "oneOf", "anyOf", "allOf", "not", "$defs", "definitions")

#: Names that would turn an observation schema into a verdict schema, plus the
#: ones CALL-E reserves for itself on the result envelope.
FORBIDDEN_PROPERTY_NAMES = (
    "grade",
    "status",
    "summary",
    "transcript",
    "call_id",
    "alive",
    "disputed",
    "conflict",
    "verdict",
    "account_closed",
)

#: The three categories the disclosure budget forbids the agent from saying.
#: Asking the model for them would collect them just as surely.
FORBIDDEN_SUBJECTS = ("cause_of_death", "date_of_birth", "balance")


@pytest.fixture
def schema() -> dict[str, Any]:
    return result_schema()


def walk(node: Any) -> Iterator[dict[str, Any]]:
    """Yield every mapping in the schema, however deeply nested."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk(item)


# --------------------------------------------------------------------------
# Shape
# --------------------------------------------------------------------------


def test_the_root_is_a_closed_object(schema: dict[str, Any]) -> None:
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False


def test_no_nested_object_reopens_itself(schema: dict[str, Any]) -> None:
    """An open sub-object would let the model smuggle a verdict in beside the
    observations."""
    for node in walk(schema):
        if node.get("type") == "object":
            assert node.get("additionalProperties") is False


def test_every_property_declares_a_supported_type(schema: dict[str, Any]) -> None:
    for name, spec in schema["properties"].items():
        assert "type" in spec, f"{name} has no type"
        assert spec["type"] in ALLOWED_TYPES, f"{name} has type {spec['type']}"


def test_every_array_declares_its_items(schema: dict[str, Any]) -> None:
    for node in walk(schema):
        if node.get("type") == "array":
            assert "items" in node
            assert node["items"].get("type") in ALLOWED_TYPES


def test_no_composition_keywords_anywhere(schema: dict[str, Any]) -> None:
    """CALL-E resolves none of these; a schema using them will not compile."""
    for node in walk(schema):
        for keyword in FORBIDDEN_KEYWORDS:
            assert keyword not in node, f"{keyword} present in {sorted(node)}"


def test_required_is_a_subset_of_properties(schema: dict[str, Any]) -> None:
    assert set(schema["required"]) <= set(schema["properties"])


def test_required_covers_the_fields_grading_cannot_do_without(
    schema: dict[str, Any],
) -> None:
    """Each of these decides a branch in `capture.py`; a missing one would be
    read as a default rather than as an absence."""
    assert {
        "reached",
        "department_named",
        "documents_named",
        "certified_copy_accepted",
        "direct_debits_action",
        "executor_only",
    } <= set(schema["required"])


def test_the_reference_is_not_required(schema: dict[str, Any]) -> None:
    """Most institutions open a case only when the paperwork arrives. Requiring
    a reference would push the model into inventing one."""
    assert "reference_opened" not in schema["required"]


def test_every_property_carries_a_description(schema: dict[str, Any]) -> None:
    """The description is the instruction to the model; an undescribed field is
    guessed at."""
    for name, spec in schema["properties"].items():
        assert spec.get("description", "").strip(), f"{name} has no description"


# --------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------


def test_every_enum_offers_unknown(schema: dict[str, Any]) -> None:
    """Every enumerated field here is a business decision, and the call may end
    before the question is answered. `unknown` must survive as an answer rather
    than collapsing into a silent no."""
    enumerated = {
        name: spec for name, spec in schema["properties"].items() if "enum" in spec
    }
    assert enumerated, "the schema has stopped using enums"
    for name, spec in enumerated.items():
        assert "unknown" in spec["enum"], f"{name} cannot answer unknown"


def test_every_enum_is_strings_and_free_of_duplicates(schema: dict[str, Any]) -> None:
    for name, spec in schema["properties"].items():
        if "enum" not in spec:
            continue
        assert spec["type"] == "string", f"{name} enumerates a non-string"
        assert len(spec["enum"]) == len(set(spec["enum"])), f"{name} repeats a value"


def test_no_enumerated_field_is_a_boolean(schema: dict[str, Any]) -> None:
    """CALL-E's own guidance: a boolean cannot say that nobody answered."""
    for name, spec in schema["properties"].items():
        assert spec["type"] != "boolean", f"{name} is a boolean"


def test_the_ternary_fields_offer_exactly_yes_no_unknown(schema: dict[str, Any]) -> None:
    for name in (
        "certified_copy_accepted",
        "executor_only",
        "notification_accepted_by_phone",
    ):
        assert schema["properties"][name]["enum"] == ["yes", "no", "unknown"]


def test_reached_lists_every_endpoint_the_grader_handles(
    schema: dict[str, Any],
) -> None:
    assert set(schema["properties"]["reached"]["enum"]) == {m.value for m in Reached}


def test_direct_debits_lists_every_action_the_grader_handles(
    schema: dict[str, Any],
) -> None:
    assert set(schema["properties"]["direct_debits_action"]["enum"]) == {
        m.value for m in DirectDebits
    }


# --------------------------------------------------------------------------
# No verdicts
# --------------------------------------------------------------------------


@pytest.mark.parametrize("banned", FORBIDDEN_PROPERTY_NAMES)
def test_the_schema_asks_for_no_verdict_and_claims_no_reserved_name(
    schema: dict[str, Any], banned: str
) -> None:
    """`grade` and `disputed` would be the model deciding. `transcript` and
    `call_id` belong to CALL-E's own envelope."""
    assert banned not in schema["properties"]
    for node in walk(schema):
        assert banned not in node.get("properties", {})


def test_no_field_asks_whether_the_answer_matches_the_policy(
    schema: dict[str, Any],
) -> None:
    """Comparing what was said with what is on file happens in `conflict.py`,
    against a record the model has never seen."""
    for name in schema["properties"]:
        assert "polic" not in name
        assert "match" not in name
        assert not name.endswith("_ok")
        assert "correct" not in name


@pytest.mark.parametrize("subject", FORBIDDEN_SUBJECTS)
def test_the_schema_never_asks_for_anything_outside_the_disclosure_budget(
    schema: dict[str, Any], subject: str
) -> None:
    """A field asking for a balance would collect one whether or not the agent
    ever said the word."""
    spoken = subject.replace("_", " ")
    for node in walk(schema):
        for key, value in node.items():
            assert subject not in str(key).lower()
            if isinstance(value, str):
                assert spoken not in value.lower()


def test_the_schema_asks_for_the_quotes_that_justify_every_field(
    schema: dict[str, Any],
) -> None:
    """Retaining the quoted span is what makes a later contradiction
    answerable, and it is all that is retained."""
    assert "evidence_quotes" in schema["required"]
    assert schema["properties"]["evidence_quotes"]["items"]["type"] == "string"


def test_the_schema_tells_the_model_not_to_fill_in_documents_nobody_named(
    schema: dict[str, Any],
) -> None:
    description = schema["properties"]["documents_named"]["description"]
    assert "Do not add documents you expect them to want." in description
