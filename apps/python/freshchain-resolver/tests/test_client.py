import copy
import json
import sys
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path


APP_DIR = Path(__file__).parents[1]
sys.path.insert(0, str(APP_DIR))
import client  # noqa: E402
from store import Store  # noqa: E402


EXAMPLE = json.loads(
    (APP_DIR / "example_request.json").read_text(encoding="utf-8")
)


class FakeCalls:
    def __init__(self, result):
        self.result = result
        self.created = None

    def create(self, **kwargs):
        self.created = kwargs
        return {"id": "call_demo_123"}

    def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
        assert call_id == "call_demo_123"
        return self.result


class PollingFailureCalls:
    def create(self, **kwargs):
        return {"id": "call_cli_accepted_001"}

    def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
        raise TimeoutError("provider result timed out")


class FreshChainTests(unittest.TestCase):
    def test_preview_masks_phone_and_never_calls(self):
        request = client.parse_request(EXAMPLE)
        plan = client.preview(request)
        self.assertFalse(plan["creates_phone_call"])
        self.assertNotIn(EXAMPLE["phone"], json.dumps(plan))
        self.assertTrue(
            plan["call_arguments"]["idempotency_key"].startswith("freshchain-")
        )

    def test_accept_result_routes_to_proceed(self):
        request = client.parse_request(EXAMPLE)
        simulated = client.simulated_result(request, "accept")
        self.assertEqual(simulated["decision"]["route"], "proceed")

    def test_rebook_result_routes_to_rebook(self):
        request = client.parse_request(EXAMPLE)
        simulated = client.simulated_result(request, "rebook")
        self.assertEqual(simulated["decision"]["route"], "rebook")

    def test_temperature_unknown_never_routes_to_proceed(self):
        raw = copy.deepcopy(EXAMPLE)
        raw["temperature_status"] = "unknown"
        request = client.parse_request(raw)
        structured = client.simulated_result(request, "accept")["structured_result"]
        self.assertEqual(
            client.route_outcome(request, structured)["route"], "hold"
        )

    def test_live_adapter_calls_calle_at_runtime(self):
        request = client.parse_request(EXAMPLE)
        structured = client.simulated_result(request, "accept")["structured_result"]
        fake = FakeCalls(
            {
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {"score": 0.94, "label": "high"},
                "structured_result": structured,
            }
        )
        accepted = []
        result = client.execute(request, fake, 30, on_created=accepted.append)
        self.assertEqual(
            fake.created["recipients"][0]["phones"], [EXAMPLE["phone"]]
        )
        self.assertFalse(fake.created["result_schema"]["additionalProperties"])
        self.assertEqual(result["call_id"], "call_demo_123")
        self.assertEqual(accepted, ["call_demo_123"])
        self.assertEqual(result["decision"]["route"], "proceed")

    def test_idempotency_key_is_bound_to_canonical_call_payload(self):
        request = client.parse_request(EXAMPLE)
        original_key = client.idempotency_key(request)
        self.assertEqual(original_key, client.idempotency_key(request))

        for field, value in (
            ("phone", "+12025550199"),
            ("receiving_site_name", "North Receiving Annex"),
            ("predicted_arrival_local", "2026-07-31T19:30:00-04:00"),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(EXAMPLE)
                changed[field] = value
                changed_request = client.parse_request(changed)
                self.assertNotEqual(
                    original_key, client.idempotency_key(changed_request)
                )

    def test_live_result_fails_closed(self):
        request = client.parse_request(EXAMPLE)
        structured = client.simulated_result(request, "accept")["structured_result"]
        cases = [
            {
                "status": "failed",
                "task_completed": True,
                "completion_confidence": 0.99,
                "structured_result": structured,
            },
            {
                "status": "completed",
                "task_completed": False,
                "completion_confidence": 0.99,
                "structured_result": structured,
            },
            {
                "status": "completed",
                "task_completed": True,
                "completion_confidence": {"score": 0.2},
                "structured_result": structured,
            },
            {
                "status": "completed",
                "task_completed": True,
                "completion_confidence": 0.99,
                "structured_result": {
                    **structured,
                    "human_escalation_required": "yes",
                },
            },
            {
                "status": "completed",
                "task_completed": True,
                "completion_confidence": 0.99,
                "structured_result": {"right_desk": "yes"},
            },
        ]
        for provider_result in cases:
            with self.subTest(provider_result=provider_result):
                result = client.execute(request, FakeCalls(provider_result), 30)
                self.assertEqual(result["decision"]["route"], "escalate")

    def test_cli_live_execution_claims_and_audits_ambiguity(self):
        request = client.parse_request(EXAMPLE)
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "cli-audit.sqlite3"
            with self.assertRaisesRegex(RuntimeError, "outcome is unknown"):
                client.execute_cli_with_audit(
                    request,
                    PollingFailureCalls(),
                    30,
                    database,
                )

            store = Store(database)
            case = store.list_cases()[0]
            attempt = store.list_attempts()[0]
            self.assertEqual(case["status"], "outcome_unknown")
            self.assertEqual(case["decision"], "escalate")
            self.assertEqual(attempt["provider_call_id"], "call_cli_accepted_001")
            self.assertEqual(attempt["provider_status"], "outcome_unknown")
            self.assertIsNone(
                store.claim_cli_live_execution(asdict(request))
            )

    def test_live_base_url_is_restricted(self):
        self.assertEqual(
            client.validate_base_url("https://api.heycall-e.com"),
            "https://api.heycall-e.com",
        )
        self.assertEqual(
            client.validate_base_url("http://127.0.0.1:8089"),
            "http://127.0.0.1:8089",
        )
        for unsafe in (
            "http://api.heycall-e.com",
            "https://example.com",
            "http://192.168.1.20:8080",
            "http://localhost",
        ):
            with self.subTest(unsafe=unsafe):
                with self.assertRaises(ValueError):
                    client.validate_base_url(unsafe)

    def test_rejects_unsafe_ids(self):
        for field in ("workflow_id", "shipment_reference"):
            with self.subTest(field=field):
                raw = copy.deepcopy(EXAMPLE)
                raw[field] = "../../secret"
                with self.assertRaises(ValueError):
                    client.parse_request(raw)

    def test_requires_authorized_operational_contact(self):
        raw = copy.deepcopy(EXAMPLE)
        raw["authorized_operational_contact"] = False
        with self.assertRaises(ValueError):
            client.parse_request(raw)


if __name__ == "__main__":
    unittest.main()
