"""Tests for the Airtable adapter."""

import unittest

from certa.airtable import (
    AIRTABLE_ORIGIN,
    AirtableError,
    FieldMap,
    FixtureAirtable,
    LiveAirtable,
    answer_columns,
    base_definition,
    create_base,
    scope,
    to_row,
)
from certa.schema import derive_recipient_schema
from certa.types import ApplicantSuppliedNumber, NumberSource, SourcedNumber

FIELDS = FieldMap()
SOURCED = "+15550100471"
ON_APPLICATION = "+15550109999"


def sel(name, choices, desc=""):
    return {
        "name": name,
        "type": "singleSelect",
        "description": desc,
        "options": {"choices": [{"id": f"c{i}", "name": c} for i, c in enumerate(choices)]},
    }


SCHEMA = [
    {"name": FIELDS.request_id, "type": "singleLineText"},
    {"name": FIELDS.applicant_ref, "type": "singleLineText"},
    {"name": FIELDS.applicant_name, "type": "singleLineText"},
    {"name": FIELDS.employer_name, "type": "singleLineText"},
    {"name": FIELDS.sourced_number, "type": "singleLineText"},
    {"name": FIELDS.number_source, "type": "singleLineText"},
    {"name": FIELDS.applicant_supplied_number, "type": "singleLineText"},
    {"name": FIELDS.consent_receipt_id, "type": "singleLineText"},
    {"name": FIELDS.consent_disclosure_version, "type": "singleLineText"},
    {"name": FIELDS.consent_signed_at, "type": "singleLineText"},
    {"name": FIELDS.consent_token, "type": "singleLineText"},
    {"name": FIELDS.cancelled, "type": "checkbox", "options": {}},
    {"name": FIELDS.status, "type": "singleLineText"},
    {"name": FIELDS.reason, "type": "multilineText"},
    {"name": FIELDS.call_id, "type": "singleLineText"},
    sel("Reached employer", ["Yes", "No", "Unknown"]),
    sel("Employment confirmed", ["Yes", "No", "Unknown"], "Use yes only if HR states it."),
    sel("Title matches", ["Yes", "No", "Unknown"]),
    sel("Declined to answer", ["Yes", "No", "Unknown"]),
]


def record(**overrides):
    values = {
        FIELDS.request_id: "VR-1041",
        FIELDS.applicant_ref: "APP-8823",
        FIELDS.applicant_name: "Dana Okafor",
        FIELDS.employer_name: "Cascade Freight Systems",
        FIELDS.sourced_number: SOURCED,
        FIELDS.number_source: "official_site",
        FIELDS.applicant_supplied_number: ON_APPLICATION,
        FIELDS.consent_receipt_id: "CR-1",
        FIELDS.consent_disclosure_version: "voe-disclosure-2026-01",
        FIELDS.consent_signed_at: "2026-09-09T09:00:00Z",
        FIELDS.consent_token: "a" * 64,
    }
    values.update(overrides)
    return {"id": "recABC", "fields": values}


class AnswerColumns(unittest.TestCase):
    def test_control_columns_are_excluded(self):
        names = {c["name"] for c in answer_columns(SCHEMA, FIELDS)}
        self.assertNotIn(FIELDS.consent_token, names)
        self.assertNotIn(FIELDS.status, names)

    def test_operator_columns_survive(self):
        names = {c["name"] for c in answer_columns(SCHEMA, FIELDS)}
        self.assertEqual(
            names,
            {"Reached employer", "Employment confirmed", "Title matches", "Declined to answer"},
        )

    def test_adding_a_column_adds_a_schema_field(self):
        """The whole idea: a new question is a new column, not new code."""
        extended = SCHEMA + [sel("Still employed today", ["Yes", "No", "Unknown"])]
        derived = derive_recipient_schema(answer_columns(extended, FIELDS))
        self.assertIn("still_employed_today", derived.schema["properties"])

    def test_column_description_reaches_the_derived_schema(self):
        derived = derive_recipient_schema(answer_columns(SCHEMA, FIELDS))
        self.assertEqual(
            derived.schema["properties"]["employment_confirmed"]["description"],
            "Use yes only if HR states it.",
        )


class RowMapping(unittest.TestCase):
    def test_sourced_number_becomes_dialable(self):
        row = to_row(record(), FIELDS)
        self.assertIsInstance(row.request.sourced, SourcedNumber)
        self.assertEqual(row.request.sourced.e164, SOURCED)

    def test_application_number_is_read_but_stays_undialable(self):
        """The provenance boundary at the edge of the system."""
        row = to_row(record(), FIELDS)
        self.assertIsInstance(row.request.applicant_supplied, ApplicantSuppliedNumber)
        self.assertNotIsInstance(row.request.applicant_supplied, SourcedNumber)
        self.assertEqual(row.request.applicant_supplied.raw, ON_APPLICATION)

    def test_missing_sourced_number_yields_no_dialable_target(self):
        row = to_row(record(**{FIELDS.sourced_number: ""}), FIELDS)
        self.assertIsNone(row.request.sourced)

    def test_unrecognised_number_source_is_refused_with_the_allowed_set(self):
        with self.assertRaises(AirtableError) as ctx:
            to_row(record(**{FIELDS.number_source: "application"}), FIELDS)
        self.assertIn("not a recognised", str(ctx.exception))
        self.assertIn("official_site", str(ctx.exception))

    def test_malformed_number_is_refused_not_repaired(self):
        with self.assertRaises(AirtableError):
            to_row(record(**{FIELDS.sourced_number: "555 010 0471"}), FIELDS)

    def test_incomplete_consent_receipt_is_refused(self):
        with self.assertRaises(AirtableError):
            to_row(record(**{FIELDS.consent_signed_at: ""}), FIELDS)

    def test_no_receipt_means_no_consent(self):
        row = to_row(record(**{FIELDS.consent_receipt_id: ""}), FIELDS)
        self.assertIsNone(row.request.consent)

    def test_cancelled_checkbox_is_carried_through(self):
        row = to_row(record(**{FIELDS.cancelled: True}), FIELDS)
        self.assertTrue(row.request.cancelled)

    def test_presented_token_is_kept_separate_from_the_request(self):
        row = to_row(record(), FIELDS)
        self.assertEqual(row.presented_token, "a" * 64)
        self.assertFalse(hasattr(row.request, "consent_token"))


class ViewScope(unittest.TestCase):
    """A filtered view hiding rows is a hazard, so both counts are reported."""

    def test_hidden_rows_are_counted(self):
        client = FixtureAirtable(SCHEMA, [record()] * 12, view_records=[record()] * 3)
        result = scope(client, "Verification Requests", "Ready to verify")
        self.assertEqual(result.in_view, 3)
        self.assertEqual(result.in_table, 12)
        self.assertEqual(result.hidden, 9)

    def test_no_hidden_rows_reports_zero(self):
        client = FixtureAirtable(SCHEMA, [record()] * 4)
        self.assertEqual(scope(client, "T", "V").hidden, 0)


class CredentialBoundary(unittest.TestCase):
    def test_token_only_goes_to_airtable(self):
        with self.assertRaises(AirtableError) as ctx:
            LiveAirtable("pat_x", "appX", base_url="https://evil.example.com")
        self.assertIn("refusing to send", str(ctx.exception))

    def test_missing_credentials_are_refused(self):
        with self.assertRaises(AirtableError):
            LiveAirtable("", "appX")
        with self.assertRaises(AirtableError):
            LiveAirtable("pat_x", "")

    def test_origin_constant_is_airtable(self):
        self.assertEqual(AIRTABLE_ORIGIN, "api.airtable.com")


class FixtureClient(unittest.TestCase):
    def test_writes_are_captured_not_sent(self):
        client = FixtureAirtable(SCHEMA, [record()])
        client.update_records("T", [{"id": "recABC", "fields": {"Status": "Verified"}}])
        self.assertEqual(len(client.writes), 1)
        self.assertFalse(hasattr(client, "token"))


if __name__ == "__main__":
    unittest.main()


class BaseCreation(unittest.TestCase):
    """`certa init` builds the table, because nineteen hand-made columns with
    one wrong field type fails confusingly and much later."""

    def setUp(self):
        self.table = base_definition()["tables"][0]
        self.names = [f["name"] for f in self.table["fields"]]

    def test_every_control_column_is_present(self):
        for name in FIELDS.control_columns():
            self.assertIn(name, self.names)

    def test_answer_columns_produce_a_valid_schema(self):
        derived = derive_recipient_schema(answer_columns(self.table["fields"], FIELDS))
        self.assertIn("reached_employer", derived.schema["properties"])
        self.assertIn("employment_confirmed", derived.schema["properties"])

    def test_number_source_offers_no_application_option(self):
        field = next(f for f in self.table["fields"] if f["name"] == FIELDS.number_source)
        choices = {c["name"] for c in field["options"]["choices"]}
        self.assertEqual(choices, {s.value for s in NumberSource})
        self.assertNotIn("application", choices)

    def test_answer_columns_carry_their_instruction(self):
        """The description is what the extraction model actually reads."""
        for name in ("Reached employer", "Employment confirmed", "Title matches"):
            field = next(f for f in self.table["fields"] if f["name"] == name)
            self.assertTrue(field.get("description"), msg=name)

    def test_a_bad_workspace_id_is_refused_before_any_request(self):
        for bad in ("app123", "", "my workspace"):
            with self.assertRaises(AirtableError, msg=bad):
                create_base("pat_x", bad)


if __name__ == "__main__":
    unittest.main()


class CountingRows(unittest.TestCase):
    """The row count must not smuggle an invalid parameter into the request.

    Asking Airtable for `fields[]=` with an empty value is rejected as an
    unknown field name, which turned the hidden-by-filter report into a 422
    against a real base while passing every fixture test.
    """

    def test_count_sends_no_field_selector(self):
        seen = []

        class Recording(LiveAirtable):
            def _request(self, method, path, *, body=None):
                seen.append(path)
                return {"records": []}

        Recording("pat_x", "appX").count_table("Verification Requests")
        self.assertTrue(seen)
        self.assertNotIn("fields", seen[0])

    def test_scope_counts_view_and_table_separately(self):
        client = FixtureAirtable(SCHEMA, [record()] * 7, view_records=[record()] * 2)
        result = scope(client, "T", "V")
        self.assertEqual((result.in_view, result.in_table, result.hidden), (2, 7, 5))
