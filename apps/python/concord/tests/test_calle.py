"""The wire contract.

A live call is the only thing that proves CALL-E accepts this payload, but a
fake transport can prove the client sends what the docs say it sends. Without
this, `calle.py` had no coverage at all and the one claim the technical score
rests on was untested.
"""

import json
import unittest
from pathlib import Path
from unittest import mock

from concord.calle import CalleAPIError, CalleClient
from concord.collector import build_payload, idempotency_key
from concord.models import Audit, Rubric

ROOT = Path(__file__).resolve().parents[1]


def load():
    return (
        Audit.load(str(ROOT / "fixtures" / "example-audit.json")),
        Rubric.load(str(ROOT / "rubrics" / "emergency-contraception.json")),
    )


class FakeResponse:
    def __init__(self, body: dict):
        self._body = json.dumps(body).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class TestRequestShape(unittest.TestCase):
    def setUp(self):
        self.client = CalleClient(api_key="test-key-not-real")

    def _capture(self, body: dict):
        captured = {}

        def fake_urlopen(request, timeout=None):
            captured["url"] = request.full_url
            captured["method"] = request.method
            captured["headers"] = {k.lower(): v for k, v in request.headers.items()}
            captured["body"] = json.loads(request.data) if request.data else None
            return FakeResponse(body)

        return captured, fake_urlopen

    def test_create_call_posts_to_v1_calls(self):
        audit, rubric = load()
        captured, fake = self._capture({"id": "call_test_1", "status": "queued"})
        with mock.patch("urllib.request.urlopen", fake):
            self.client.create_call(build_payload(audit, rubric), idempotency_key(audit, rubric))
        self.assertEqual(captured["url"], "https://api.heycall-e.com/v1/calls")
        self.assertEqual(captured["method"], "POST")

    def test_authorization_and_idempotency_headers_are_sent(self):
        audit, rubric = load()
        key = idempotency_key(audit, rubric)
        captured, fake = self._capture({"id": "call_test_1"})
        with mock.patch("urllib.request.urlopen", fake):
            self.client.create_call(build_payload(audit, rubric), key)
        self.assertEqual(captured["headers"]["authorization"], "Bearer test-key-not-real")
        self.assertEqual(captured["headers"]["idempotency-key"], key)
        self.assertEqual(captured["headers"]["content-type"], "application/json")

    def test_body_carries_the_compiled_schema_and_one_recipient_per_branch(self):
        audit, rubric = load()
        captured, fake = self._capture({"id": "call_test_1"})
        with mock.patch("urllib.request.urlopen", fake):
            self.client.create_call(build_payload(audit, rubric), "k")
        body = captured["body"]
        self.assertIn("task", body)
        self.assertIn("recipient_result_schema", body)
        self.assertEqual(len(body["recipients"]), len(audit.branches))
        self.assertEqual(
            [r["phones"][0] for r in body["recipients"]], [b.phone for b in audit.branches]
        )
        for criterion in rubric.criteria:
            self.assertIn(criterion.field, body["recipient_result_schema"]["required"])

    def test_get_call_uses_the_call_id(self):
        captured, fake = self._capture({"id": "call_x", "status": "completed"})
        with mock.patch("urllib.request.urlopen", fake):
            self.client.get_call("call_x")
        self.assertEqual(captured["url"], "https://api.heycall-e.com/v1/calls/call_x")
        self.assertEqual(captured["method"], "GET")
        self.assertIsNone(captured["body"])

    def test_base_url_is_configurable_within_the_allowlist(self):
        client = CalleClient(api_key="k", base_url="https://api.staging.heycall-e.com/")
        captured, fake = self._capture({"id": "c"})
        with mock.patch("urllib.request.urlopen", fake):
            client.get_call("c")
        self.assertEqual(captured["url"], "https://api.staging.heycall-e.com/v1/calls/c")


class TestCredentialHandling(unittest.TestCase):
    def test_a_missing_key_is_refused_before_any_network_use(self):
        with self.assertRaises(CalleAPIError):
            CalleClient(api_key="")

    def test_polling_stops_at_a_terminal_status(self):
        client = CalleClient(api_key="k")
        with mock.patch.object(client, "get_call", return_value={"status": "completed"}):
            self.assertEqual(client.wait_for_completion("c")["status"], "completed")

    def test_polling_timeout_says_not_to_start_a_second_audit(self):
        client = CalleClient(api_key="k")
        with mock.patch.object(client, "get_call", return_value={"status": "running"}):
            with self.assertRaises(CalleAPIError) as ctx:
                client.wait_for_completion("c", poll_seconds=0, timeout_seconds=0)
        self.assertIn("do not create a second audit", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
