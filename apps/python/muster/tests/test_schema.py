"""The CALL-E result schema.

Two things are being defended. First, CALL-E's documented constraints on a
result schema — flat, closed, no composition keywords — because a schema it
cannot compile fails at call time, on a real line, to a real pensioner.

Second, and more important: the schema captures observations only. The moment
an `alive` or `grade` field appears, the verdict has moved from `grading.py`
into a language model, and the whole design is gone.
"""

from __future__ import annotations

from typing import Any, Iterator

import pytest

from muster.models import KnowledgePrompt
from muster.schema import result_schema
from tests.builders import PROMPTS

#: CALL-E compiles a flat subset of JSON Schema. Anything else is unsupported.
ALLOWED_TYPES = {"object", "string", "number", "integer", "boolean", "array"}

#: Composition keywords CALL-E does not resolve.
FORBIDDEN_KEYWORDS = ("$ref", "oneOf", "anyOf", "allOf", "not", "$defs", "definitions")

#: Names that would turn an observation schema into a verdict schema, plus the
#: ones CALL-E reserves for itself on the result envelope.
FORBIDDEN_PROPERTY_NAMES = (
    "alive",
    "grade",
    "status",
    "summary",
    "transcript",
    "call_id",
)


@pytest.fixture
def schema() -> dict[str, Any]:
    return result_schema(PROMPTS)


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
    """Each of these decides a branch in `grading.py`; a missing one would be
    read as a default rather than as an absence."""
    assert {
        "answered_by",
        "claimed_to_be_subject",
        "nonce_words_heard",
        "nonce_words_reversed_heard",
        "weekday_heard",
        "subject_reported_dead",
    } <= set(schema["required"])


def test_the_reverse_leg_is_transcribed_into_its_own_required_array(
    schema: dict[str, Any],
) -> None:
    """The reverse echo is what carries a confirmation now that the platform
    refuses to ask security questions, so it cannot be optional and it cannot
    share a field with the forward echo: one slot for both would let a single
    recital satisfy both legs."""
    spec = schema["properties"]["nonce_words_reversed_heard"]
    assert spec["type"] == "array"
    assert spec["items"] == {"type": "string"}
    assert "nonce_words_reversed_heard" in schema["required"]
    assert "nonce_words_reversed_heard" != "nonce_words_heard"
    assert schema["properties"]["nonce_words_heard"] != spec


def test_the_reverse_field_asks_for_a_transcription_and_not_a_verdict(
    schema: dict[str, Any],
) -> None:
    """`check_reversed` decides whether the order was right. The model is only
    ever asked what it heard, in the order it heard it."""
    described = schema["properties"]["nonce_words_reversed_heard"]["description"]
    assert "reverse" in described.lower()
    assert "in the order they said them" in described
    assert "Transcribe what was actually said" in described


def test_the_schema_asks_no_security_question_of_its_own(
    schema: dict[str, Any],
) -> None:
    """Enrolled prompts arrive as `answer_<id>` fields and nothing else. A
    standing security question baked into the schema would make every call
    unplaceable, because the platform refuses to collect that at all."""
    fixed = {
        name for name in schema["properties"] if not name.startswith("answer_")
    }
    assert not any("password" in name or "security" in name for name in fixed)
    assert not any("account" in name or "verification" in name for name in fixed)


def test_every_property_carries_a_description(schema: dict[str, Any]) -> None:
    """The description is the instruction to the model; an undescribed field is
    guessed at."""
    for name, spec in schema["properties"].items():
        assert spec.get("description", "").strip(), f"{name} has no description"


# --------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------


def test_every_enum_offers_unknown(schema: dict[str, Any]) -> None:
    """Every enumerated field here is a business decision, and the call may not
    contain enough evidence. `unknown` must survive as an answer rather than
    collapsing into a silent no."""
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


def test_the_ternary_fields_offer_exactly_yes_no_unknown(schema: dict[str, Any]) -> None:
    for name in (
        "claimed_to_be_subject",
        "another_person_present",
        "subject_reported_dead",
        "wrong_number",
        "distress_or_confusion",
    ):
        assert schema["properties"][name]["enum"] == ["yes", "no", "unknown"]


def test_answered_by_lists_every_endpoint_the_grader_handles(
    schema: dict[str, Any],
) -> None:
    assert set(schema["properties"]["answered_by"]["enum"]) == {
        "subject",
        "third_party",
        "voicemail",
        "ivr",
        "no_answer",
        "unknown",
    }


# --------------------------------------------------------------------------
# Per-prompt answers
# --------------------------------------------------------------------------


def test_each_enrolled_prompt_gets_its_own_answer_field(schema: dict[str, Any]) -> None:
    for prompt in PROMPTS:
        spec = schema["properties"][f"answer_{prompt.prompt_id}"]
        assert spec["type"] == "string"
        assert prompt.question in spec["description"]


def test_a_prompt_answer_field_forbids_judging_the_answer() -> None:
    """The model transcribes; `grading.py` scores. Saying so in the prompt is
    the only place that instruction lives."""
    schema = result_schema(PROMPTS)
    for prompt in PROMPTS:
        description = schema["properties"][f"answer_{prompt.prompt_id}"]["description"]
        assert "Do not judge whether it is correct." in description


def test_no_prompts_enrolled_still_yields_a_usable_schema() -> None:
    schema = result_schema(())
    assert not any(name.startswith("answer_") for name in schema["properties"])
    assert set(schema["required"]) <= set(schema["properties"])


def test_prompt_answer_fields_are_optional() -> None:
    """A subject who says nothing must still produce a valid result."""
    schema = result_schema(PROMPTS)
    assert not any(name.startswith("answer_") for name in schema["required"])


def test_a_new_prompt_adds_exactly_one_field() -> None:
    extra = KnowledgePrompt("ship", "What ship did you sail on?", "Orcades")
    before = set(result_schema(PROMPTS)["properties"])
    after = set(result_schema(PROMPTS + (extra,))["properties"])
    assert after - before == {"answer_ship"}


# --------------------------------------------------------------------------
# No verdicts
# --------------------------------------------------------------------------


@pytest.mark.parametrize("banned", FORBIDDEN_PROPERTY_NAMES)
def test_the_schema_asks_for_no_verdict_and_claims_no_reserved_name(
    schema: dict[str, Any], banned: str
) -> None:
    """`alive`, `grade`, `status` and `summary` would be the model deciding.
    `transcript` and `call_id` belong to CALL-E's own envelope."""
    assert banned not in schema["properties"]
    for node in walk(schema):
        assert banned not in node.get("properties", {})


def test_the_word_alive_appears_nowhere_in_the_schema(schema: dict[str, Any]) -> None:
    """Not in a field name, not in an instruction to the model."""
    for node in walk(schema):
        for key, value in node.items():
            assert "alive" not in str(key).lower()
            if isinstance(value, str):
                assert "alive" not in value.lower()


def test_no_field_asks_the_model_whether_a_challenge_was_correct(
    schema: dict[str, Any],
) -> None:
    """`nonce_ok` and `challenge_ok` are computed in code and never asked."""
    for name in schema["properties"]:
        assert not name.endswith("_ok")
        assert "correct" not in name
