import json
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
