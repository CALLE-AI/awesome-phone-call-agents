"""The CALL-E adapter, exercised through an injected transport.

No test in this file opens a socket. The transport records what would have
been sent, which is the only way to assert that a bearer token never leaves
for the wrong host.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from runaround.calle_client import (
    CallEClient,
    CallEError,
    assert_approved_origin,
    build_create_call_body,
    extract_structured_result,
)


class RecordingTransport:
    """Replays queued responses and remembers every request."""

    def __init__(self, responses: list[tuple[int, dict[str, Any]]]):
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def request(self, *, method, url, headers, body):
        self.requests.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": json.loads(body.decode("utf-8")) if body else None,
            }
        )
        if not self.responses:
            raise AssertionError("the client made more requests than expected")
        return self.responses.pop(0)


def client(responses, **kwargs):
    return CallEClient(
        api_key="test-key",
        transport=RecordingTransport(responses),
        poll_interval=0,
        sleep=lambda _seconds: None,
        **kwargs,
    )


class OriginTests(unittest.TestCase):
    def test_the_official_origin_is_approved(self):
        self.assertEqual(
            assert_approved_origin("https://api.heycall-e.com/"),
            "https://api.heycall-e.com",
        )

    def test_a_host_that_merely_ends_in_the_right_letters_is_refused(self):
        for hostile in (
            "https://api.heycall-e.com.evil.example",
            "https://api-heycall-e.com",
            "https://notapi.heycall-e.com",
        ):
            with self.subTest(hostile=hostile):
                with self.assertRaises(CallEError):
                    assert_approved_origin(hostile)

    def test_plain_http_is_refused(self):
        with self.assertRaises(CallEError):
            assert_approved_origin("http://api.heycall-e.com")

    def test_a_client_without_a_key_refuses_to_exist(self):
        with self.assertRaises(CallEError):
            CallEClient(api_key="", transport=RecordingTransport([]))


class RequestShapeTests(unittest.TestCase):
    def test_the_create_body_matches_the_documented_contract(self):
        body = build_create_call_body(
            task_text="Call the desk.",
            desk_phone="+15550100",
            region="US",
            locale="en-US",
            metadata={"case_id": "parcel-8472"},
        )
        self.assertEqual(body["task"], "Call the desk.")
        self.assertEqual(body["recipients"], [
            {"phones": ["+15550100"], "locale": "en-US", "region": "US"}
        ])
        self.assertEqual(body["result_schema"]["type"], "object")
        self.assertFalse(body["result_schema"]["additionalProperties"])

    def test_the_bearer_token_and_idempotency_key_are_sent(self):
        api = client([(201, {"id": "call_1", "status": "completed"})])
        api.create_call(body={"task": "x"}, key="runaround-abc")
        sent = api.transport.requests[0]
        self.assertEqual(sent["method"], "POST")
        self.assertEqual(sent["url"], "https://api.heycall-e.com/v1/calls")
        self.assertEqual(sent["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(sent["headers"]["Idempotency-Key"], "runaround-abc")


class PollingTests(unittest.TestCase):
    def test_polling_stops_at_the_first_terminal_state(self):
        api = client(
            [
                (201, {"id": "call_1", "status": "queued"}),
                (200, {"id": "call_1", "status": "in_progress"}),
                (200, {"id": "call_1", "status": "completed"}),
            ]
        )
        call = api.place_hop(body={"task": "x"}, key="k")
        self.assertEqual(call["status"], "completed")
        self.assertEqual(len(api.transport.requests), 3)

    def test_a_terminal_create_response_is_not_polled_again(self):
        api = client([(201, {"id": "call_1", "status": "completed"})])
        api.place_hop(body={"task": "x"}, key="k")
        self.assertEqual(len(api.transport.requests), 1)

    def test_an_exhausted_poll_ceiling_is_an_unknown_outcome_not_a_failure(self):
        api = client(
            [
                (201, {"id": "call_1", "status": "queued"}),
                (200, {"id": "call_1", "status": "in_progress"}),
                (200, {"id": "call_1", "status": "in_progress"}),
            ],
            poll_max_attempts=2,
        )
        with self.assertRaises(CallEError) as raised:
            api.place_hop(body={"task": "x"}, key="k")
        self.assertIn("outcome is unknown", str(raised.exception))

    def test_an_unrecognized_status_is_refused_rather_than_assumed(self):
        api = client(
            [
                (201, {"id": "call_1", "status": "queued"}),
                (200, {"id": "call_1", "status": "partially_done"}),
            ]
        )
        with self.assertRaises(CallEError):
            api.place_hop(body={"task": "x"}, key="k")


class ErrorTests(unittest.TestCase):
    def test_a_documented_error_code_reaches_the_caller(self):
        api = client(
            [
                (
                    403,
                    {
                        "error": {
                            "code": "unsupported_region",
                            "message": "destination region is not enabled",
                            "details": {},
                        }
                    },
                )
            ]
        )
        with self.assertRaises(CallEError) as raised:
            api.create_call(body={"task": "x"})
        self.assertIn("unsupported_region", str(raised.exception))

    def test_a_create_response_without_an_id_is_refused(self):
        api = client([(201, {"status": "queued"})])
        with self.assertRaises(CallEError):
            api.place_hop(body={"task": "x"}, key="k")


class ResultExtractionTests(unittest.TestCase):
    def test_the_task_level_result_is_preferred(self):
        call = {
            "structured_result": {"owns_request": "yes"},
            "recipients": [{"structured_result": {"owns_request": "no"}}],
        }
        self.assertEqual(
            extract_structured_result(call), {"owns_request": "yes"}
        )

    def test_the_recipient_result_is_the_fallback(self):
        call = {
            "structured_result": None,
            "recipients": [{"structured_result": {"owns_request": "no"}}],
        }
        self.assertEqual(extract_structured_result(call), {"owns_request": "no"})

    def test_no_result_anywhere_is_none_not_an_empty_object(self):
        call = {"structured_result": None, "recipients": [{"structured_result": {}}]}
        self.assertIsNone(extract_structured_result(call))


if __name__ == "__main__":
    unittest.main()
