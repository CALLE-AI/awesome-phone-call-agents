import json
import contextlib
import io
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1]))
import app


class VoiceScoutTests(unittest.TestCase):
    def test_preview_never_places_call(self):
        lead = json.loads((Path(__file__).parents[1] / "examples" / "synthetic_lead.json").read_text())
        result = app.preview(lead)
        self.assertEqual(result["mode"], "preview")
        self.assertIn("no call was placed", result["message"])
        self.assertTrue(result["idempotency_key"].startswith("voice-scout:"))
        self.assertNotIn("0000000000", json.dumps(result))

    def test_live_requires_explicit_authorization(self):
        lead = {"id": "x", "business_name": "Test", "industry": "Test", "phone": "+15550000000"}
        with self.assertRaises(RuntimeError):
            app.run_live(lead)

    def test_nested_provider_output_is_sanitized(self):
        result = app.sanitize_result({
            "transcript": "Call +15551234567 and then +441234567890.",
            "recipient_phone": "+15551234567",
            "api_key": "secret-value",
            "nested": {"destination": "+15557654321"},
        })
        encoded = json.dumps(result)
        self.assertNotIn("+15551234567", encoded)
        self.assertNotIn("+441234567890", encoded)
        self.assertNotIn("+15557654321", encoded)
        self.assertNotIn("secret-value", encoded)
        self.assertIn("[REDACTED]", encoded)

    def test_unicode_digits_are_not_valid_e164(self):
        path = Path(tempfile.mkdtemp()) / "lead.json"
        path.write_text(json.dumps({"id": "x", "business_name": "Test", "industry": "Test", "phone": "+١٥٥٥٠٠٠٠٠٠٠"}))
        with self.assertRaises(ValueError):
            app.load_lead(path)

    def test_grouped_phone_display_does_not_change_private_lead(self):
        lead = {
            "phone": "+12025550123",
            "notes": "Call +1 (202) 555-0123 or (202) 555-0124 on 2026-09-17.",
        }
        original = dict(lead)
        public = app.safe_lead(lead)
        self.assertEqual(lead, original)
        self.assertNotIn("202) 555", json.dumps(public))
        self.assertNotIn(lead["phone"], json.dumps(public))
        self.assertIn("2026-09-17", public["notes"])

    def test_cli_provider_exception_is_coarse_and_not_retried(self):
        for exception_type in (OSError, Exception):
            with self.subTest(exception=exception_type.__name__):
                stderr = io.StringIO()
                with patch.object(sys, "argv", ["app.py", "--live", "--lead", "synthetic.json"]), \
                     patch.object(app, "load_lead", return_value={}), \
                     patch.object(app, "run_live", side_effect=exception_type("Synthetic +12025550123 diagnostic")) as run, \
                     contextlib.redirect_stderr(stderr):
                    self.assertEqual(app.main(), 1)
                run.assert_called_once()
                self.assertNotIn("+12025550123", stderr.getvalue())
                self.assertNotIn("diagnostic", stderr.getvalue())
                self.assertIn("Live CALL-E run failed", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
