from __future__ import annotations

import json
import unittest
from pathlib import Path

import access_route


def valid_raw() -> dict:
    return {
        "workflow_id": "cedar-library-access-001",
        "owner_authorized": True,
        "organization": {
            "display_name": "Cedar Public Library",
            "phone": "+12025550123",
            "published_source": "https://example.org/contact",
        },
        "requested_routes": [
            "email",
            "text",
            "scheduled_callback",
            "relay_support",
        ],
        "locale": "en-US",
        "allow_neutral_voicemail": False,
    }


def request() -> access_route.AccessRouteRequest:
    return access_route.parse_request(valid_raw())


class FakeCalls:
    def __init__(self) -> None:
        self.created: list[dict] = []

    def create(self, **kwargs):
        self.created.append(kwargs)
        return {"id": "call_demo_001"}

    def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
        assert call_id == "call_demo_001"
        assert timeout_seconds == 30
        assert interval_seconds == 2
        return {
            "status": "completed",
            "task_completed": True,
            "completion_confidence": 0.91,
            "structured_result": {
                "organization_reached": "yes",
                "automated_caller_accepted": "yes",
                "route_results": [
                    {
                        "route": "email",
                        "availability": "yes",
                        "instructions": "Use access@example.org or call +12025550177.",
                    }
                ],
                "next_step": "use_available_route",
                "evidence_summary": "Staff confirmed the public access route.",
            },
        }


class FakeClient:
    def __init__(self) -> None:
        self.calls = FakeCalls()


class AccessRouteTests(unittest.TestCase):
    def test_valid_request_parses(self) -> None:
        parsed = request()
        self.assertEqual(parsed.organization.display_name, "Cedar Public Library")
        self.assertEqual(
            parsed.requested_routes,
            ("email", "text", "scheduled_callback", "relay_support"),
        )

    def test_invalid_request_fields_fail_closed(self) -> None:
        cases = [
            (("owner_authorized",), False, "owner_authorized must be true"),
            (("organization", "phone"), "202-555-0123", "E.164"),
            (
                ("organization", "published_source"),
                "http://example.org/contact",
                "public HTTPS URL",
            ),
            (("locale",), "english", "locale must look like"),
        ]
        for path, value, message in cases:
            with self.subTest(path=path):
                raw = valid_raw()
                target = raw
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaisesRegex(ValueError, message):
                    access_route.parse_request(raw)

    def test_unknown_fields_are_rejected(self) -> None:
        raw = valid_raw()
        raw["reason_for_disability"] = "not allowed"
        with self.assertRaisesRegex(ValueError, "unsupported fields"):
            access_route.parse_request(raw)

    def test_duplicate_and_unknown_routes_are_rejected(self) -> None:
        raw = valid_raw()
        raw["requested_routes"] = ["email", "email"]
        with self.assertRaisesRegex(ValueError, "duplicates"):
            access_route.parse_request(raw)
        raw["requested_routes"] = ["telepathy"]
        with self.assertRaisesRegex(ValueError, "unsupported requested route"):
            access_route.parse_request(raw)

    def test_preview_masks_number_and_creates_no_call(self) -> None:
        payload = access_route.preview(request())
        self.assertIs(payload["creates_phone_call"], False)
        rendered = json.dumps(payload)
        self.assertNotIn("+12025550123", rendered)
        self.assertIn("+12******123", rendered)

    def test_preview_receipt_is_stable_and_bound_to_request(self) -> None:
        first = request()
        self.assertEqual(
            access_route.preview_receipt(first), access_route.preview_receipt(first)
        )
        raw = valid_raw()
        raw["requested_routes"] = ["email"]
        second = access_route.parse_request(raw)
        self.assertNotEqual(
            access_route.preview_receipt(first), access_route.preview_receipt(second)
        )

    def test_task_carries_no_personal_reason_or_commitment_authority(self) -> None:
        task = access_route.build_task(request())
        self.assertIn("Do not state or ask why", task)
        self.assertIn("Do not access or change an account", task)
        self.assertIn("make or change an appointment", task)

    def test_result_schema_is_closed_and_route_bounded(self) -> None:
        schema = access_route.build_result_schema(request())
        self.assertIs(schema["additionalProperties"], False)
        item = schema["properties"]["route_results"]["items"]
        self.assertIs(item["additionalProperties"], False)
        self.assertEqual(
            item["properties"]["route"]["enum"],
            ["email", "text", "scheduled_callback", "relay_support"],
        )

    def test_execute_requires_matching_receipt_before_call(self) -> None:
        client = FakeClient()
        with self.assertRaisesRegex(ValueError, "receipt does not match"):
            access_route.execute(
                request(), client, receipt="0" * 64, timeout_seconds=30
            )
        self.assertEqual(client.calls.created, [])

    def test_execute_places_one_call_and_redacts_phone_like_results(self) -> None:
        parsed = request()
        client = FakeClient()
        result = access_route.execute(
            parsed,
            client,
            receipt=access_route.preview_receipt(parsed),
            timeout_seconds=30,
        )
        self.assertEqual(len(client.calls.created), 1)
        self.assertEqual(
            result["idempotency_key"], "accessroute-cedar-library-access-001"
        )
        rendered = json.dumps(result)
        self.assertNotIn("+12025550177", rendered)
        self.assertIn("[phone-redacted]", rendered)

    def test_write_output_does_not_overwrite(self) -> None:
        destination = Path(__file__).parent / ".write-output-test.json"
        if destination.exists():
            destination.unlink()
        try:
            access_route.write_output(destination, {"ok": True})
            with self.assertRaises(FileExistsError):
                access_route.write_output(destination, {"ok": False})
            self.assertEqual(
                json.loads(destination.read_text(encoding="utf-8")), {"ok": True}
            )
        finally:
            if destination.exists():
                destination.unlink()


if __name__ == "__main__":
    unittest.main()
