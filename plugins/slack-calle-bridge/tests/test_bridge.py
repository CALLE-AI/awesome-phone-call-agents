import hashlib
import hmac
import os
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN))

import bridge  # noqa: E402


class BridgeTests(unittest.TestCase):
    def test_preview_is_default(self):
        parsed = bridge.parse_command("+15551234567 | confirm the maintenance window")
        self.assertEqual(parsed["mode"], "preview")
        self.assertEqual(parsed["phone"], "+15551234567")

    def test_run_requires_explicit_prefix(self):
        parsed = bridge.parse_command("run +15551234567 | confirm the maintenance window")
        self.assertEqual(parsed["mode"], "run")

    def test_rejects_non_e164_phone(self):
        with self.assertRaisesRegex(ValueError, "E.164"):
            bridge.parse_command("555-1234 | ask a question")

    def test_rejects_missing_goal_separator(self):
        with self.assertRaisesRegex(ValueError, "Use:"):
            bridge.parse_command("+15551234567 ask a question")

    def test_slack_signature_and_replay_window(self):
        body = b"team_id=T1&text=preview%20%2B15551234567%20%7C%20check"
        secret = "test-secret"
        timestamp = "1700000000"
        base = b"v0:" + timestamp.encode() + b":" + body
        signature = "v0=" + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
        self.assertTrue(
            bridge.verify_slack_signature(body, timestamp, signature, secret, now=1700000000)
        )
        self.assertFalse(
            bridge.verify_slack_signature(body, timestamp, signature, secret, now=1700000401)
        )

    def test_response_url_is_slack_only(self):
        ok = "https://hooks.slack.com/actions/T/B/secret"
        self.assertEqual(bridge.validate_response_url(ok), ok)
        with self.assertRaisesRegex(ValueError, "hooks.slack.com"):
            bridge.validate_response_url("https://example.com/result")

    def test_mask_phone(self):
        masked = bridge.mask_phone("+15551234567")
        self.assertNotIn("5551234567", masked)
        self.assertTrue(masked.endswith("67"))

    def test_idempotency_is_stable_and_context_bound(self):
        form = {"team_id": "T1", "channel_id": "C1", "user_id": "U1"}
        first = bridge.idempotency_key(form, "+15551234567", "check status")
        self.assertEqual(first, bridge.idempotency_key(form, "+15551234567", "check status"))
        self.assertNotEqual(first, bridge.idempotency_key(form, "+15551234567", "check ETA"))

    def test_payload_is_one_recipient_and_disclosed(self):
        payload = bridge.build_call_payload("+15551234567", "confirm the service ETA")
        self.assertEqual(payload["recipients"], [{"phones": ["+15551234567"]}])
        self.assertIn("AI calling", payload["task"])
        self.assertIn("Do not buy anything", payload["task"])

    def test_calle_base_url_is_https_except_test_localhost(self):
        self.assertEqual(
            bridge.calle_base_url("https://api.heycall-e.com/"),
            "https://api.heycall-e.com",
        )
        with self.assertRaises(ValueError):
            bridge.calle_base_url("http://api.heycall-e.com")

    def test_safe_result_excludes_transcript(self):
        call = {
            "id": "call_1",
            "status": "completed",
            "structured_result": {"outcome": "resolved", "summary": "ETA is 4 PM"},
            "transcript": "private full transcript",
            "recording_url": "https://example.invalid/private.mp3",
        }
        result = bridge.safe_result(call, "+15551234567")
        rendered = str(result)
        self.assertNotIn("private full transcript", rendered)
        self.assertNotIn("recording_url", rendered)

    def test_run_calle_posts_once_then_polls(self):
        calls = []

        def fake_transport(method, url, headers, body=None):
            calls.append((method, url, headers, body))
            if method == "POST":
                return {"id": "call_123", "status": "queued"}
            return {
                "id": "call_123",
                "status": "completed",
                "structured_result": {"outcome": "resolved", "summary": "Window confirmed"},
            }

        form = {"team_id": "T1", "channel_id": "C1", "user_id": "U1"}
        command = bridge.parse_command("run +15551234567 | confirm the service window")
        result = bridge.run_calle(
            form,
            command,
            "test-api-key",
            "https://api.heycall-e.com",
            transport=fake_transport,
            sleep=lambda _: None,
        )
        self.assertEqual(result["outcome"], "resolved")
        self.assertEqual([item[0] for item in calls], ["POST", "GET"])
        self.assertTrue(calls[0][2]["Idempotency-Key"].startswith("slack-calle-"))


    def test_nested_recipient_result_is_supported(self):
        call = {
            "id": "call_nested",
            "status": "completed",
            "recipients": [
                {"structured_result": {"outcome": "declined", "summary": "Asked not to be called."}}
            ],
        }
        result = bridge.safe_result(call, "+12025550123")
        self.assertEqual(result["outcome"], "declined")
        self.assertEqual(result["summary"], "Asked not to be called.")

    def test_slack_output_escapes_mentions(self):
        safe = bridge.slack_safe_text("<!channel> & <@U123>")
        self.assertNotIn("<!channel>", safe)
        self.assertNotIn("<@U123>", safe)
        self.assertIn("&lt;!channel&gt;", safe)


if __name__ == "__main__":
    unittest.main()
