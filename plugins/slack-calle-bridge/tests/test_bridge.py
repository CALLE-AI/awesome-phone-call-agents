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
        parsed = bridge.parse_command("+12025550123 | confirm the maintenance window")
        self.assertEqual(parsed["mode"], "preview")
        self.assertEqual(parsed["phone"], "+12025550123")

    def test_run_requires_explicit_prefix(self):
        parsed = bridge.parse_command("run +12025550123 | confirm the maintenance window")
        self.assertEqual(parsed["mode"], "run")

    def test_rejects_non_e164_phone(self):
        with self.assertRaisesRegex(ValueError, "E.164"):
            bridge.parse_command("555-1234 | ask a question")

    def test_rejects_missing_goal_separator(self):
        with self.assertRaisesRegex(ValueError, "Use:"):
            bridge.parse_command("+12025550123 ask a question")

    def test_slack_signature_and_replay_window(self):
        body = b"team_id=T1&text=preview%20%2B12025550123%20%7C%20check"
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
        masked = bridge.mask_phone("+12025550123")
        self.assertNotIn("2025550123", masked)
        self.assertTrue(masked.endswith("23"))

    def test_idempotency_is_stable_and_context_bound(self):
        form = {"team_id": "T1", "channel_id": "C1", "user_id": "U1"}
        first = bridge.idempotency_key(form, "+12025550123", "check status")
        self.assertEqual(first, bridge.idempotency_key(form, "+12025550123", "check status"))
        self.assertNotEqual(first, bridge.idempotency_key(form, "+12025550123", "check ETA"))

    def test_payload_is_one_recipient_and_disclosed(self):
        payload = bridge.build_call_payload("+12025550123", "confirm the service ETA")
        self.assertEqual(payload["recipients"], [{"phones": ["+12025550123"]}])
        self.assertIn("AI calling", payload["task"])
        self.assertIn("Do not buy anything", payload["task"])

    def test_calle_base_url_is_pinned_to_approved_origin(self):
        self.assertEqual(
            bridge.calle_base_url("https://api.heycall-e.com/"),
            "https://api.heycall-e.com",
        )
        with self.assertRaises(ValueError):
            bridge.calle_base_url("http://api.heycall-e.com")
        with self.assertRaises(ValueError):
            bridge.calle_base_url("https://attacker.example")

    def test_safe_result_excludes_transcript(self):
        call = {
            "id": "call_1",
            "status": "completed",
            "structured_result": {"outcome": "resolved", "summary": "ETA is 4 PM"},
            "transcript": "private full transcript",
            "recording_url": "https://example.invalid/private.mp3",
        }
        result = bridge.safe_result(call, "+12025550123")
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
        command = bridge.parse_command("run +12025550123 | confirm the service window")
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

    def test_run_rejects_unapproved_origin_before_transport(self):
        calls = []
        command = bridge.parse_command("run +12025550123 | confirm the service window")
        with self.assertRaises(ValueError):
            bridge.run_calle(
                {"team_id": "T1", "channel_id": "C1", "user_id": "U1"},
                command,
                "test-api-key",
                "https://attacker.example",
                transport=lambda *args: calls.append(args),
            )
        self.assertEqual(calls, [])

    def test_unicode_digits_are_not_accepted_as_e164(self):
        with self.assertRaisesRegex(ValueError, "ASCII E.164"):
            bridge.parse_command("+١٢٠٢٥٥٥٠١٢٣ | confirm the service window")

    def test_provider_summary_is_bounded_and_masks_phone_data(self):
        call = {
            "status": "completed",
            "structured_result": {
                "outcome": "resolved",
                "summary": "Call +1 (202) 555-0123 done\n" + "x" * 600,
            },
        }
        result = bridge.safe_result(call, "+12025550123")
        self.assertNotIn("202", result["summary"])
        self.assertIn("[phone redacted]", result["summary"])
        self.assertLessEqual(len(result["summary"]), 500)
        self.assertNotIn("\n", result["summary"])

    def test_provider_result_types_fail_closed(self):
        call = {
            "status": "completed",
            "structured_result": {"outcome": "invented", "summary": {"phone": "+12025550123"}},
        }
        result = bridge.safe_result(call, "+12025550123")
        self.assertEqual(result["outcome"], "needs_human")
        self.assertEqual(result["summary"], "No structured summary returned.")


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
