"""Credential-free, in-memory regressions; never open a network socket."""
import contextlib
import copy
import io
import json
import socket
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from claimcall.calle_client import CalleClient, CalleError, NoRedirect
from claimcall.cli import _print_outcome
from claimcall.dashboard import state_payload
from claimcall.display import mask_output, mask_output_text
from claimcall.models import new_case
from claimcall.policy import destination_problems


class OutputSafetyTests(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(socket.socket, "connect", side_effect=AssertionError("network forbidden"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_redirects_are_refused(self):
        req = urllib.request.Request("https://api.heycall-e.com/v1/calls")
        req.add_header("Authorization", "Bearer fixture-key")
        for status in (301, 302, 303, 307, 308):
            self.assertIsNone(NoRedirect().redirect_request(req, None, status, "redirect", {}, "http://example.invalid/"))
        client = CalleClient("fixture-key")
        self.assertTrue(any(isinstance(handler, NoRedirect) for handler in client._opener.handlers))

    def test_provider_error_details_stay_private(self):
        client = CalleClient("fixture-key")
        detail = b"phone +12025550123 secret fixture-only-secret"
        error = urllib.error.HTTPError(client.base_url, 502, "bad gateway", {}, io.BytesIO(detail))
        with patch.object(client._opener, "open", side_effect=error):
            with self.assertRaises(CalleError) as caught:
                client.create_call({}, "fixture-intent")
        self.assertEqual(str(caught.exception), "CALL-E API request failed: HTTP 502.")

    def test_ascii_complete_e164(self):
        self.assertEqual(destination_problems("+12025550123", "US"), [])
        for value in ("+12025550123\n", "+1٢٠٢٥٥٥٠١٢٣", "+12025550123 extra"):
            self.assertTrue(destination_problems(value, "US"))

    def test_recursive_masking_preserves_private_data_and_dates(self):
        original = {"transcript": [{"text": "Call +12025550123"}], "date": "2026-09-14"}
        before = copy.deepcopy(original)
        shown = mask_output(original)
        self.assertNotIn("+12025550123", json.dumps(shown))
        self.assertEqual(original, before)
        self.assertEqual(shown["date"], "2026-09-14")
        for phone in ("(202) 555-0123", "202-555-0123", "+44 20 7946 0958"):
            self.assertNotIn(phone, mask_output_text(phone))

    def test_dashboard_and_cli_mask_display_not_private_case(self):
        case = new_case("Example Traveller", "Example Air", "DEMO123", "EX101", "A", "B", "Cancelled", "2026-09-14", "+12025550123", "US")
        case["calls"] = [{"transcript": [{"text": "Callback +12025550123"}], "evidence": ["Use (202) 555-0123"]}]
        case["representative_commitments"] = ["Call +12025550123"]
        before = copy.deepcopy(case)
        shown = state_payload(case, False)
        self.assertNotIn("+12025550123", json.dumps(shown))
        self.assertNotIn("(202) 555-0123", json.dumps(shown))
        with contextlib.redirect_stdout(io.StringIO()) as output:
            _print_outcome(case, {"placed": True, "call": {"id": "fake-call"}, "call_status": "completed"}, "fixture")
        self.assertNotIn("+12025550123", output.getvalue())
        self.assertEqual(case, before)


if __name__ == "__main__":
    unittest.main()
