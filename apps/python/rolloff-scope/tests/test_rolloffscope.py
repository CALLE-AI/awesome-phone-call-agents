from __future__ import annotations

import copy
import io
import json
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from rolloffscope.api import CalleApiClient, wait_for_terminal
from rolloffscope.cli import _assert_live_gate, main
from rolloffscope.core import (
    FACT_FIELDS,
    OFFICIAL_BASE_URL,
    RequestValidationError,
    approval_token,
    build_call_payload,
    idempotency_key,
    mask_phone,
    naive_base_price_candidate,
    normalize_call_result,
    normalize_recipient_quote,
    preview_plan,
    validate_request,
)


APP_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = APP_ROOT / "fixtures"


def load_json(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status = status
        self._body = json.dumps(payload).encode("utf-8")
        self.closed = False

    def getcode(self):
        return self.status

    def read(self):
        return self._body

    def close(self):
        self.closed = True


class LockedFixtureTest(unittest.TestCase):
    def setUp(self):
        self.request = load_json("request.json")
        self.completed = load_json("completed-call.json")
        self.matrix = load_json("normalization-cases.json")
        self.vendors = validate_request(self.request)["vendors"]

    def test_locked_matrix_is_exactly_four_unique_cases(self):
        cases = self.matrix["cases"]
        self.assertEqual(4, len(cases))
        self.assertEqual(4, len({case["name"] for case in cases}))
        self.assertEqual([0, 1, 2, 3], [case["recipient_index"] for case in cases])

    def test_four_of_four_classifications_and_totals_match(self):
        for case in self.matrix["cases"]:
            index = case["recipient_index"]
            with self.subTest(case=case["name"]):
                actual = normalize_recipient_quote(
                    self.request,
                    self.vendors[index],
                    self.completed["recipients"][index],
                )
                self.assertEqual(case["expected_classification"], actual["classification"])
                self.assertEqual(case["expected_total"], actual["normalized_total"])
                self.assertFalse(actual["commitment_allowed"])
                self.assertTrue(actual["requires_human_approval"])

    def test_every_present_material_fact_is_evidence_bound(self):
        for case in self.matrix["cases"]:
            index = case["recipient_index"]
            actual = normalize_recipient_quote(
                self.request,
                self.vendors[index],
                self.completed["recipients"][index],
            )
            self.assertEqual([], actual["evidence_missing_fields"], case["name"])

    def test_lowest_naive_base_is_incomplete_and_normalized_ranking_refuses_it(self):
        naive = []
        for index, recipient in enumerate(self.completed["recipients"]):
            if naive_base_price_candidate(recipient):
                naive.append((recipient["structured_result"]["base_rental_amount"], index))
        naive.sort()
        self.assertEqual(1, naive[0][1])
        actual = normalize_call_result(self.request, self.completed)
        self.assertEqual(["clear-bin"], [item["vendor_id"] for item in actual["ranked_for_human_review"]])

    def test_refusal_is_unresolved_and_never_a_candidate(self):
        recipient = {
            "status": "completed",
            "structured_result": {
                "outcome": "refused",
                "evidence": [{"fields": ["outcome"], "statement": "The recipient declined to provide a quote."}],
                "notes": "No bid was given.",
            },
        }
        actual = normalize_recipient_quote(self.request, self.vendors[0], recipient)
        self.assertEqual("unresolved", actual["classification"])
        self.assertIsNone(actual["normalized_total"])
        self.assertFalse(naive_base_price_candidate(recipient))


class EndToEndFixtureTest(unittest.TestCase):
    def setUp(self):
        self.request = load_json("request.json")
        self.completed = load_json("completed-call.json")

    def test_demo_output_matches_locked_expected_file(self):
        self.assertEqual(load_json("expected-normalized.json"), normalize_call_result(self.request, self.completed))

    def test_recipient_count_mismatch_disables_all_ranking(self):
        incomplete = copy.deepcopy(self.completed)
        incomplete["recipients"] = incomplete["recipients"][:-1]
        actual = normalize_call_result(self.request, incomplete)
        self.assertEqual(["recipient_count_mismatch"], actual["batch_errors"])
        self.assertEqual([], actual["ranked_for_human_review"])

    def test_transcript_values_are_never_persisted_in_normalized_output(self):
        result = copy.deepcopy(self.completed)
        result["recipients"][0]["transcript_turns"] = [
            {"speaker": "user", "text": "SYNTHETIC_TRANSCRIPT_MUST_NOT_PERSIST"}
        ]
        rendered = json.dumps(normalize_call_result(self.request, result))
        self.assertNotIn("SYNTHETIC_TRANSCRIPT_MUST_NOT_PERSIST", rendered)
        self.assertNotIn("transcript", rendered.lower())


class PreviewAndRequestContractTest(unittest.TestCase):
    def setUp(self):
        self.request = load_json("request.json")

    def test_default_preview_masks_e164_numbers_and_opens_no_network(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("network attempted")):
            preview = preview_plan(self.request)
        rendered = json.dumps(preview)
        self.assertFalse(preview["network_attempted"])
        for vendor in self.request["vendors"]:
            self.assertNotIn(vendor["phone"], rendered)
            self.assertRegex(mask_phone(vendor["phone"]), r"^\+\d{3} \*+ \d{3}$")

    def test_payload_matches_official_api_and_locked_dumpster_fields(self):
        payload = build_call_payload(self.request)
        self.assertEqual(
            {"task", "recipients", "result_schema", "recipient_result_schema", "metadata"}, set(payload)
        )
        self.assertEqual(4, len(payload["recipients"]))
        self.assertEqual([self.request["vendors"][0]["phone"]], payload["recipients"][0]["phones"])
        self.assertEqual("US", payload["recipients"][0]["region"])
        self.assertEqual("en-US", payload["recipients"][0]["locale"])
        properties = payload["recipient_result_schema"]["properties"]
        for field in (
            "base_rental_amount",
            "delivery_fee_status",
            "pickup_fee_status",
            "rental_days_included",
            "included_tonnage",
            "overage_per_ton_amount",
            "fuel_fee_status",
            "environmental_fee_status",
            "permit_requirement",
            "prohibited_materials",
            "tax_status",
            "availability",
            "quote_valid_until",
            "assumptions",
            "contradictions",
            "evidence",
        ):
            self.assertIn(field, properties)
        evidence_field_enum = properties["evidence"]["items"]["properties"]["fields"]["items"]["enum"]
        self.assertEqual(sorted(FACT_FIELDS), evidence_field_enum)
        rendered_schema = json.dumps(
            [payload["result_schema"], payload["recipient_result_schema"]], sort_keys=True
        )
        self.assertNotIn('"minimum"', rendered_schema)
        self.assertNotIn('"maxItems"', rendered_schema)
        self.assertIn('"description"', rendered_schema)

    def test_same_request_keeps_idempotency_and_material_changes_rotate_it(self):
        first_key = idempotency_key(self.request)
        first_token = approval_token(self.request)
        self.assertEqual(first_key, idempotency_key(copy.deepcopy(self.request)))
        self.assertEqual(first_token, approval_token(copy.deepcopy(self.request)))
        changed_scope = copy.deepcopy(self.request)
        changed_scope["scope"]["estimated_tonnage"] = 3
        self.assertNotEqual(first_key, idempotency_key(changed_scope))
        changed_recipient = copy.deepcopy(self.request)
        changed_recipient["vendors"][0]["phone"] = "+14155550109"
        self.assertNotEqual(first_key, idempotency_key(changed_recipient))

    def test_default_cli_is_preview_only(self):
        stdout = io.StringIO()
        with patch("urllib.request.urlopen", side_effect=AssertionError("network attempted")):
            with redirect_stdout(stdout):
                code = main([str(FIXTURES / "request.json")])
        self.assertEqual(0, code)
        result = json.loads(stdout.getvalue())
        self.assertEqual("RolloffScope", result["app"])
        self.assertEqual("dry_run", result["mode"])
        self.assertFalse(result["network_attempted"])

    def test_invalid_e164_and_duplicate_recipient_are_rejected(self):
        invalid = copy.deepcopy(self.request)
        invalid["vendors"][0]["phone"] = "4155550101"
        with self.assertRaisesRegex(RequestValidationError, "E.164"):
            validate_request(invalid)
        duplicate = copy.deepcopy(self.request)
        duplicate["vendors"][1]["phone"] = duplicate["vendors"][0]["phone"]
        with self.assertRaisesRegex(RequestValidationError, "phone numbers must be unique"):
            validate_request(duplicate)


class LiveGateTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 15, 18, 0, tzinfo=timezone.utc)
        raw = load_json("request.json")
        raw["live_authorized"] = True
        raw["call_window"] = {
            "starts_at": (self.now - timedelta(minutes=5)).isoformat(),
            "ends_at": (self.now + timedelta(minutes=5)).isoformat(),
        }
        self.request = validate_request(raw)
        self.allowlist = {vendor["phone"] for vendor in self.request["vendors"]}

    def test_live_gate_requires_current_token_allowlist_and_window(self):
        token = approval_token(self.request)
        with self.assertRaisesRegex(RequestValidationError, "exactly match"):
            _assert_live_gate(self.request, "wrong", self.now, self.allowlist)
        with self.assertRaisesRegex(RequestValidationError, "allowlist"):
            _assert_live_gate(self.request, token, self.now, set())
        with self.assertRaisesRegex(RequestValidationError, "outside"):
            _assert_live_gate(self.request, token, self.now + timedelta(hours=1), self.allowlist)
        _assert_live_gate(self.request, token, self.now, self.allowlist)

    def test_fixture_live_command_fails_before_api_use(self):
        request = load_json("request.json")
        stderr = io.StringIO()
        env = {
            "CALLE_API_KEY": "iams_fixture_only",
            "ROLLOFFSCOPE_ALLOWED_PHONES": ",".join(vendor["phone"] for vendor in request["vendors"]),
        }
        with patch.dict(os.environ, env, clear=False), redirect_stderr(stderr):
            code = main(
                [
                    str(FIXTURES / "request.json"),
                    "--live",
                    "--confirm",
                    approval_token(request),
                ]
            )
        self.assertEqual(2, code)
        self.assertIn("not explicitly authorized", stderr.getvalue())


class FakeApiEndToEndTest(unittest.TestCase):
    def test_fake_api_post_poll_and_normalization(self):
        request_data = load_json("request.json")
        completed = load_json("completed-call.json")
        completed_with_transcript = copy.deepcopy(completed)
        completed_with_transcript["recipients"][0]["transcript"] = "SYNTHETIC_DO_NOT_STORE"
        responses = [
            FakeResponse({"id": completed["id"], "status": "queued"}, status=201),
            FakeResponse({"id": completed["id"], "status": "in_progress"}),
            FakeResponse(completed_with_transcript),
        ]
        captured = []

        def opener(request, timeout):
            captured.append(
                {
                    "url": request.full_url,
                    "method": request.get_method(),
                    "headers": {name.lower(): value for name, value in request.header_items()},
                    "body": json.loads(request.data.decode("utf-8")) if request.data else None,
                    "timeout": timeout,
                }
            )
            return responses.pop(0)

        client = CalleApiClient("iams_fixture_only", opener=opener)
        payload = build_call_payload(request_data)
        key = idempotency_key(request_data)
        created = client.create_call(payload, key)
        final = wait_for_terminal(
            client,
            created["id"],
            poll_interval_seconds=0,
            timeout_seconds=5,
            sleep=lambda _: None,
            monotonic=lambda: 0,
        )
        normalized = normalize_call_result(request_data, final)

        self.assertEqual(["POST", "GET", "GET"], [item["method"] for item in captured])
        self.assertEqual(f"{OFFICIAL_BASE_URL}/v1/calls", captured[0]["url"])
        self.assertEqual(key, captured[0]["headers"]["idempotency-key"])
        self.assertEqual(payload, captured[0]["body"])
        self.assertTrue(all(item["url"].endswith("/v1/calls/call_fixture_rolloffscope_001") for item in captured[1:]))
        self.assertEqual(load_json("expected-normalized.json"), normalized)
        self.assertNotIn("SYNTHETIC_DO_NOT_STORE", json.dumps(normalized))

    def test_credentials_are_pinned_to_official_origin(self):
        with self.assertRaisesRegex(ValueError, "official CALL-E API origin"):
            CalleApiClient("iams_fixture_only", base_url="http://127.0.0.1:9999")


if __name__ == "__main__":
    unittest.main()
