import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from consent_gate import Authorization, build_request, redact, safe_call_result


class Tests(unittest.TestCase):
    def auth(self, **overrides):
        data = {"source":"written consent","authorized_at":"2026-08-01T00:00:00Z","expires_at":"2026-12-01T00:00:00Z","purpose":"pharmacy hours","allowed_disclosures":["first_name"],"voicemail_allowed":False,"revoked":False}
        data.update(overrides)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "authorization.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            return Authorization.from_json(path)

    def test_valid(self):
        self.assertEqual(self.auth().validate("Call about pharmacy hours", ("first_name",), datetime(2026, 9, 1, tzinfo=timezone.utc)), [])

    def test_fail_closed(self):
        errors = self.auth(expires_at="2026-08-15T00:00:00Z", revoked=True).validate("Call about pharmacy hours", ("medical_record",), datetime(2026, 9, 1, tzinfo=timezone.utc))
        self.assertIn("authorization is revoked", errors)
        self.assertIn("authorization is expired", errors)
        self.assertIn("disclosures exceed scope: medical_record", errors)

    def test_redaction(self):
        request = build_request("Call about pharmacy hours", "+15555550123", self.auth())
        self.assertEqual(redact(request)["recipients"][0]["phones"], ["<REDACTED_PHONE>"])

    def test_live_result_omits_phone_and_transcript(self):
        result = SimpleNamespace(
            id="call_demo",
            status="completed",
            task_completed=True,
            phone="+15555550123",
            transcript="private recipient speech",
        )
        rendered = json.dumps(safe_call_result(result))
        self.assertIn("call_demo", rendered)
        self.assertNotIn("+15555550123", rendered)
        self.assertNotIn("private recipient speech", rendered)


if __name__ == "__main__":
    unittest.main()
