"""Tests for deriving CALL-E's recipient result schema from table columns."""

import unittest

from certa.schema import (
    CONTACT_GATE_KEY,
    RESERVED_KEYS,
    UNKNOWN,
    SchemaError,
    derive_recipient_schema,
    derive_task_schema,
    slug,
)


def select(name: str, choices: list[str], description: str = "") -> dict:
    return {
        "name": name,
        "type": "singleSelect",
        "description": description,
        "options": {"choices": [{"id": f"sel{i}", "name": c} for i, c in enumerate(choices)]},
    }


GATE = select("Reached employer", ["Yes", "No", "Unknown"])


class Derivation(unittest.TestCase):
    def test_single_select_choices_become_the_enum(self):
        derived = derive_recipient_schema(
            [GATE, select("Employment confirmed", ["Yes", "No", "Unknown"])]
        )
        prop = derived.schema["properties"]["employment_confirmed"]
        self.assertEqual(prop["type"], "string")
        self.assertEqual(prop["enum"], ["yes", "no", UNKNOWN])

    def test_unknown_is_appended_last(self):
        """Whatever the other choices are, `unknown` is the final enum value."""
        derived = derive_recipient_schema(
            [GATE, select("Tenure matches", ["Matches", "Does not match", "Unknown"])]
        )
        self.assertEqual(
            derived.schema["properties"]["tenure_matches"]["enum"],
            ["matches", "does_not_match", UNKNOWN],
        )

    def test_unknown_is_not_duplicated_when_the_operator_modelled_it(self):
        derived = derive_recipient_schema(
            [GATE, select("Title matches", ["Yes", "No", "Unknown"])]
        )
        enum = derived.schema["properties"]["title_matches"]["enum"]
        self.assertEqual(enum.count(UNKNOWN), 1)

    def test_column_description_becomes_the_extraction_instruction(self):
        instruction = "Use yes only when HR states the title verbatim."
        derived = derive_recipient_schema(
            [GATE, select("Title matches", ["Yes", "No", "Unknown"], instruction)]
        )
        self.assertEqual(
            derived.schema["properties"]["title_matches"]["description"], instruction
        )

    def test_checkbox_answer_column_is_refused(self):
        """A checkbox has two states; CALL-E answers with three.

        Recording "HR would not tell me" as an unticked box is the exact
        misrepresentation this product exists to prevent, so the column is
        refused at setup with the fix named rather than written wrongly
        after a call has been paid for.
        """
        with self.assertRaises(SchemaError) as caught:
            derive_recipient_schema(
                [GATE, {"name": "Declined to answer", "type": "checkbox", "options": {}}]
            )
        message = str(caught.exception)
        self.assertIn("single select", message)
        self.assertIn("Unknown", message)

    def test_select_without_an_unknown_choice_is_refused(self):
        """The live failure: CALL-E returned `unknown`, Airtable rejected the write."""
        with self.assertRaises(SchemaError) as caught:
            derive_recipient_schema(
                [GATE, select("Title matches", ["Yes", "No"])]
            )
        self.assertIn("Unknown", str(caught.exception))

    def test_the_choice_must_be_named_unknown_not_a_synonym(self):
        """Deliberately literal.

        "Not stated" and "Unclear" read as unknown to a person but are just
        other choices to the writeback, which would then fail exactly as it
        did live. The error names the one spelling that works rather than
        guessing at synonyms.
        """
        with self.assertRaises(SchemaError):
            derive_recipient_schema(
                [GATE, select("Title matches", ["Yes", "No", "Not stated"])]
            )

    def test_the_unknown_choices_label_is_kept_for_writeback(self):
        derived = derive_recipient_schema(
            [GATE, select("Title matches", ["Yes", "No", "Unknown"])]
        )
        self.assertEqual(derived.choice_labels[("title_matches", UNKNOWN)], "Unknown")

    def test_number_precision_selects_integer_or_number(self):
        derived = derive_recipient_schema(
            [
                GATE,
                {"name": "Years employed", "type": "number", "options": {"precision": 0}},
                {"name": "Fte", "type": "number", "options": {"precision": 2}},
            ]
        )
        props = derived.schema["properties"]
        self.assertEqual(props["years_employed"]["type"], "integer")
        self.assertEqual(props["fte"]["type"], "number")

    def test_text_columns_become_strings(self):
        derived = derive_recipient_schema(
            [GATE, {"name": "Notes", "type": "multilineText"}]
        )
        self.assertEqual(derived.schema["properties"]["notes"], {"type": "string"})

    def test_writeback_map_survives_derivation(self):
        derived = derive_recipient_schema(
            [GATE, select("Employment confirmed", ["Yes", "No", "Unknown"])]
        )
        self.assertEqual(
            derived.field_names["employment_confirmed"], "Employment confirmed"
        )
        self.assertEqual(
            derived.choice_labels[("employment_confirmed", "yes")], "Yes"
        )


class OnlySupportedFeatures(unittest.TestCase):
    """CALL-E documents which schema features it supports. Emit only those."""

    def test_schema_is_strict_and_flat(self):
        derived = derive_recipient_schema([GATE, select("Title matches", ["Yes", "No", "Unknown"])])
        self.assertEqual(derived.schema["additionalProperties"], False)
        self.assertEqual(derived.schema["type"], "object")
        self.assertCountEqual(
            derived.schema["required"], list(derived.schema["properties"])
        )

    def test_never_emits_unsupported_keywords(self):
        derived = derive_recipient_schema([GATE, select("Title matches", ["Yes", "No", "Unknown"])])
        rendered = repr(derived.schema)
        for unsupported in ("$ref", "oneOf", "anyOf", "allOf"):
            self.assertNotIn(unsupported, rendered)

    def test_reserved_recipient_keys_are_refused_with_a_rename(self):
        for reserved in ("Summary", "Status", "Transcript", "Call id"):
            with self.assertRaises(SchemaError) as ctx:
                derive_recipient_schema([GATE, select(reserved, ["Yes", "No", "Unknown"])])
            self.assertIn("reserve", str(ctx.exception).lower())

    def test_reserved_set_matches_the_documented_names(self):
        for name in ("summary", "status", "transcript", "call_id"):
            self.assertIn(name, RESERVED_KEYS)


class ContactGate(unittest.TestCase):
    """Guards CALL-E issue #341: task_completed can be true with no call."""

    def test_schema_without_the_gate_is_refused(self):
        with self.assertRaises(SchemaError) as ctx:
            derive_recipient_schema([select("Employment confirmed", ["Yes", "No", "Unknown"])])
        self.assertIn(CONTACT_GATE_KEY, str(ctx.exception))

    def test_gate_must_be_able_to_answer_yes(self):
        with self.assertRaises(SchemaError):
            derive_recipient_schema(
                [select("Reached employer", ["Maybe", "Possibly"])]
            )

    def test_gate_is_required_in_the_emitted_schema(self):
        derived = derive_recipient_schema([GATE])
        self.assertIn(CONTACT_GATE_KEY, derived.schema["required"])


class Collisions(unittest.TestCase):
    def test_two_columns_mapping_to_one_key_are_refused(self):
        with self.assertRaises(SchemaError):
            derive_recipient_schema(
                [GATE, select("Title matches", ["Yes"]), select("title-matches", ["No"])]
            )

    def test_two_choices_reducing_to_one_value_are_refused(self):
        with self.assertRaises(SchemaError):
            derive_recipient_schema([GATE, select("Title", ["Yes!", "yes"])])

    def test_unsupported_column_type_is_refused_with_guidance(self):
        with self.assertRaises(SchemaError) as ctx:
            derive_recipient_schema(
                [GATE, {"name": "Attachment", "type": "multipleAttachments"}]
            )
        self.assertIn("single select", str(ctx.exception))

    def test_slug_is_stable_and_identifier_safe(self):
        self.assertEqual(slug("Employment confirmed?"), "employment_confirmed")
        self.assertEqual(slug("  Title   Matches  "), "title_matches")
        self.assertEqual(slug("2nd employer"), "f_2nd_employer")
        with self.assertRaises(SchemaError):
            slug("   ")


class TaskSchema(unittest.TestCase):
    def test_outcome_enum_covers_the_dispositions_and_unknown(self):
        schema = derive_task_schema()
        enum = schema["properties"]["verification_outcome"]["enum"]
        for expected in (
            "verified",
            "partial",
            "not_verified",
            "employer_unreachable",
            "declined",
            UNKNOWN,
        ):
            self.assertIn(expected, enum)

    def test_task_schema_is_strict(self):
        self.assertEqual(derive_task_schema()["additionalProperties"], False)


if __name__ == "__main__":
    unittest.main()
