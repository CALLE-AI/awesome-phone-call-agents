import json
import unittest
from pathlib import Path

from partline.web import WebSnapshot, serve_web


ROOT = Path(__file__).resolve().parents[1]


class PartLineWebTests(unittest.TestCase):
    def snapshot(self) -> WebSnapshot:
        return WebSnapshot.load(
            ROOT / "fixtures" / "example-request.json",
            ROOT / "fixtures" / "completed-call.json",
        )

    def test_browser_payload_never_contains_full_phone_numbers(self) -> None:
        payload = json.dumps(self.snapshot().as_dict())
        self.assertNotIn("+1555010101", payload)
        self.assertIn("+15******01", payload)

    def test_browser_payload_contains_ranked_evidence(self) -> None:
        candidates = self.snapshot().as_dict()["evidence"]["candidates"]
        self.assertEqual(candidates[0]["supplier"], "Acme Industrial Supply")
        self.assertEqual(candidates[0]["match_status"], "exact")
        self.assertTrue(candidates[-1]["needs_human_followup"])

    def test_web_server_refuses_public_binding(self) -> None:
        with self.assertRaisesRegex(ValueError, "localhost only"):
            serve_web(
                ROOT / "fixtures" / "example-request.json",
                ROOT / "fixtures" / "completed-call.json",
                host="0.0.0.0",
                port=0,
            )


if __name__ == "__main__":
    unittest.main()
