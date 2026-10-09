import copy
import io
import os
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request
from calle_light import extract_command, phone, NoRedirects, api

def call():
    return {"id": "call_example", "status": "completed", "structured_result": {
        "decision": "turn_off_demo_light", "human_reached": "yes", "confirmation_quote": "Yes, please."},
        "recipients": [{"attempts": [{"transcript_turns": [
            {"speaker": "bot", "text": "Turn off the demo light. Is that correct?"},
            {"speaker": "user", "text": "Yes, please."}]}]}]}

class ContractTests(unittest.TestCase):
    def test_confirmed_request_is_not_execution(self):
        result = extract_command(call())
        self.assertEqual(result["action"], "turn_off_light")
        self.assertEqual(result["execution_status"], "not_dispatched")
    def test_final_correction_blocks_old_yes(self):
        data = call()
        data["recipients"][0]["attempts"][0]["transcript_turns"].append({"speaker": "user", "text": "Actually, leave it on."})
        self.assertIsNone(extract_command(data))
    def test_negated_confirmation(self):
        data = call()
        data["structured_result"]["confirmation_quote"] = "No, don't do that."
        data["recipients"][0]["attempts"][0]["transcript_turns"][-1]["text"] = "No, don't do that."
        self.assertIsNone(extract_command(data))
    def test_voicemail_and_unfinished_call(self):
        data = call();data["structured_result"]["human_reached"] = "no"
        self.assertIsNone(extract_command(data))
        data = call();data["status"] = "in_progress"
        self.assertIsNone(extract_command(data))
    def test_missing_transcript(self):
        data = call();data["recipients"] = []
        self.assertIsNone(extract_command(data))
    def test_australian_trunk_prefix(self):
        self.assertEqual(phone("+61 0400 000 000"), "+61400000000")
    def test_non_ascii_digits_are_not_e164(self):
        for number in ["+1" + "\u0662" * 9, "+1" + "\uff12" * 9]:
            with self.subTest(number=number), self.assertRaises(ValueError):
                phone(number)
        self.assertEqual(phone("+12025550123"), "+12025550123")
    def test_provider_redirects_are_refused_without_network(self):
        request = urllib.request.Request("https://api.heycall-e.com/v1/calls", headers={"Authorization": "Bearer fictional-test-key"})
        for target in ["https://example.com/calls", "http://api.heycall-e.com/calls", "https://api.heycall-e.com/elsewhere"]:
            for status in [301, 302, 303, 307, 308]:
                with self.subTest(target=target, status=status), self.assertRaises(urllib.error.HTTPError) as raised:
                    NoRedirects().redirect_request(request, None, status, "redirect", {}, target)
                self.assertEqual(raised.exception.code, status)
    def test_api_installs_redirect_guard_at_fixed_origin(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(b'{"id":"call_example"}')
        with patch.dict(os.environ, {"CALLE_API_KEY": "fictional-test-key"}, clear=True), patch("urllib.request.build_opener", return_value=opener) as build:
            self.assertEqual(api("calls", {"task": "fictional"}, "stable-example-key"), {"id": "call_example"})
        self.assertIsInstance(build.call_args.args[0], NoRedirects)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.heycall-e.com/v1/calls")
        self.assertEqual(request.get_header("Authorization"), "Bearer fictional-test-key")

if __name__ == "__main__":
    unittest.main()
