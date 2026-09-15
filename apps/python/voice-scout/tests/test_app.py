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

    def test_live_requires_credentials(self):
        lead = {"id": "x", "business_name": "Test", "industry": "Test", "phone": "+15550000000"}
        with tempfile.TemporaryDirectory():
            old_key = app.os.environ.pop("CALLE_API_KEY", None)
            old_goal = app.os.environ.pop("CALLE_GOAL_ID", None)
            try:
                with self.assertRaises(RuntimeError):
                    app.run_live(lead)
            finally:
                if old_key is not None:
                    app.os.environ["CALLE_API_KEY"] = old_key
                if old_goal is not None:
                    app.os.environ["CALLE_GOAL_ID"] = old_goal


if __name__ == "__main__":
    unittest.main()
