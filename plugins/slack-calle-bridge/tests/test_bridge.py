import hashlib
import hmac
import io
import os
import sys
import unittest
from pathlib import Path
from email.message import Message
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import HTTPHandler, HTTPSHandler
from urllib.response import addinfourl

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



    def test_origin_variants_rejected_before_transport(self):
        command = bridge.parse_command("run +12025550123 | check status")
        origins = [
            "http://api.heycall-e.com", "https://api.heycall-e.com.evil.example",
            "https://api.heycall-e.com@evil.example", "https://user@api.heycall-e.com",
            "https://api.heycall-e.com:8443", "https://127.0.0.1",
            "https://api.heycall-e.com/path", "https://api.heycall-e.com?x=1",
            "https://api.heycall-e.com#fragment",
        ]
        for origin in origins:
            with self.subTest(origin=origin):
                with patch.object(HTTPSHandler, "https_open") as https_network, \
                     patch.object(HTTPHandler, "http_open") as http_network:
                    with self.assertRaises(ValueError):
                        bridge.run_calle({}, command, "test-key", origin)
                    https_network.assert_not_called()
                    http_network.assert_not_called()

    def test_bearer_origin_rechecked_at_http_boundary(self):
        for name in ("Authorization", "authorization"):
            with self.subTest(header=name):
                with patch.object(HTTPSHandler, "https_open") as network:
                    with self.assertRaises(ValueError):
                        bridge.request_json("GET", "https://evil.example/v1/calls",
                                            {name: "Bearer test-key"})
                    network.assert_not_called()

    def test_redirects_never_forward_bearer(self):
        for method in ("GET", "POST"):
            for code in (301, 302, 303, 307, 308):
                with self.subTest(method=method, code=code):
                    seen = []

                    def fake_open(handler, request):
                        seen.append(request)
                        headers = Message()
                        status = code if len(seen) == 1 else 200
                        if len(seen) == 1:
                            headers["Location"] = "https://evil.example/collect"
                        response = addinfourl(io.BytesIO(b'{}'), headers,
                                              request.full_url, status)
                        response.msg = "test response"
                        return response

                    with patch.object(HTTPSHandler, "https_open", fake_open), \
                         patch.object(HTTPHandler, "http_open", fake_open):
                        with self.assertRaises(HTTPError):
                            bridge.request_json(method, bridge.DEFAULT_CALLE_BASE_URL + "/v1/calls",
                                                {"Authorization": "Bearer test-key"},
                                                {} if method == "POST" else None)
                    self.assertEqual(len(seen), 1)
                    self.assertTrue(seen[0].full_url.startswith(bridge.DEFAULT_CALLE_BASE_URL + "/"))

    def test_run_destination_validation_precedes_transport(self):
        invalid = [None, [], "", "+02025550123", "+12025550123\n",
                   "+1\u0662025550123", "+1 202 555 0123", "+1234567890123456"]
        for phone in invalid:
            with self.subTest(phone=phone):
                calls = []
                with self.assertRaises(ValueError):
                    bridge.run_calle({}, {"mode": "run", "phone": phone, "goal": "check"},
                                     "test-key", bridge.DEFAULT_CALLE_BASE_URL,
                                     transport=lambda *args: calls.append(args))
                self.assertEqual(calls, [])

    def test_run_rejects_preview_at_call_boundary(self):
        calls = []
        command = bridge.parse_command("+12025550123 | check status")
        with self.assertRaises(ValueError):
            bridge.run_calle({}, command, "test-key", bridge.DEFAULT_CALLE_BASE_URL,
                             transport=lambda *args: calls.append(args))
        self.assertEqual(calls, [])

    def test_summary_masks_attached_separated_and_unicode_phones(self):
        phones = ["x+12025550123ext", "x12025550123y", "+1/202/555/0123",
                  "+1\u200b202\u200b555\u200b0123", "+1\u2011202\u2011555\u20110123",
                  "\uff0b\uff11\uff12\uff10\uff12\uff15\uff15\uff15\uff10\uff11\uff12\uff13",
                  "+\u0661\u0662\u0660\u0662\u0665\u0665\u0665\u0660\u0661\u0662\u0663"]
        for phone in phones:
            with self.subTest(phone=phone):
                summary = bridge.provider_safe_summary("Contact " + phone + " now")
                self.assertIn("[phone redacted]", summary)
                self.assertNotIn("202", summary)
                self.assertTrue(summary.isascii())

    def test_summary_masks_before_truncation(self):
        summary = bridge.provider_safe_summary("x" * 495 + " +12025550123")
        self.assertLessEqual(len(summary), 500)
        self.assertNotIn("+120", summary)
        self.assertEqual(bridge.provider_safe_summary("ETA is 4 PM"), "ETA is 4 PM")

    def test_unhashable_outcomes_fail_closed(self):
        for outcome in ([], {}, None, 1):
            with self.subTest(outcome=outcome):
                result = bridge.safe_result({"status": "completed", "structured_result": {
                    "outcome": outcome, "summary": ["private transcript", "+12025550123"]}},
                    "+12025550123")
                self.assertEqual(result["outcome"], "needs_human")
                self.assertEqual(result["summary"], "No structured summary returned.")

    def test_nested_provider_summary_is_sanitized_before_slack(self):
        call = {"status": "completed", "transcript": "private transcript", "recipients": [{
            "structured_result": {"outcome": "resolved", "summary": "<!channel> +1/202/555/0123"},
            "recording_url": "https://example.invalid/private.mp3"}]}
        result = bridge.safe_result(call, "+12025550123")
        with patch.object(bridge, "request_json") as send:
            bridge.post_slack_result("https://hooks.slack.com/actions/T/B/test", result)
        text = send.call_args.args[3]["text"]
        self.assertIn("[phone redacted]", text)
        for private in ("202", "<!channel>", "private transcript", "private.mp3"):
            self.assertNotIn(private, text)

    def test_same_signed_intent_replays_same_key_and_exact_payload(self):
        form = {"team_id": "T1", "channel_id": "C1", "user_id": "U1", "trigger_id": "original"}
        command = bridge.parse_command("run +12025550123 | check status")
        submissions = []

        def transport(method, url, headers, body=None):
            submissions.append((method, url, dict(headers), body))
            return {"id": "call_test", "status": "completed"}

        for delivery in (form, {**form, "response_url": "new-delivery-metadata"}):
            bridge.run_calle(delivery, command, "test-key", bridge.DEFAULT_CALLE_BASE_URL,
                             transport=transport)
        self.assertEqual(submissions[0], submissions[1])
        self.assertEqual(submissions[0][3]["recipients"], [{"phones": ["+12025550123"]}])

    def test_new_slack_trigger_or_changed_intent_gets_new_key(self):
        form = {"team_id": "T1", "channel_id": "C1", "user_id": "U1", "trigger_id": "original"}
        key = bridge.idempotency_key(form, "+12025550123", "check status")
        for field in form:
            with self.subTest(field=field):
                self.assertNotEqual(key, bridge.idempotency_key({**form, field: "new"},
                                                                "+12025550123", "check status"))
        self.assertNotEqual(key, bridge.idempotency_key(form, "+12025550124", "check status"))
        self.assertNotEqual(key, bridge.idempotency_key(form, "+12025550123", "different goal"))

    def test_creation_timeout_is_not_automatically_retried(self):
        calls = []

        def transport(*args):
            calls.append(args)
            raise TimeoutError("ambiguous provider acceptance")

        with self.assertRaises(TimeoutError):
            bridge.run_calle({"trigger_id": "original"},
                             bridge.parse_command("run +12025550123 | check status"),
                             "test-key", bridge.DEFAULT_CALLE_BASE_URL, transport=transport)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
