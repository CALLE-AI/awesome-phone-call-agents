import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from incident_callback import InputError, IncidentRequest, place_call, preview  # noqa: E402


VALID = {
    "requestId": "incident-test-001",
    "severity": "high",
    "service": "checkout-api",
    "summary": "Elevated latency; invoice generation remains healthy.",
    "contextUrl": "https://cloud-steward.example.test",
    "planId": "plan-test-001",
    "recipient": {
        "phone": "+15550102020",
        "relationship": "consenting on-call owner",
        "consentRecordedAt": "2026-08-02T00:00:00Z",
    },
}


class IncidentCallbackTest(unittest.TestCase):
    def test_preview_masks_phone_and_never_calls_provider(self) -> None:
        result = preview(IncidentRequest.from_dict(VALID))
        self.assertEqual(result["status"], "previewed")
        self.assertNotIn("+15550102020", json.dumps(result))
        self.assertFalse(result["networkRequestMade"])
        self.assertTrue(result["actionRemainsPending"])

    def test_rejects_missing_consent(self) -> None:
        payload = json.loads(json.dumps(VALID))
        payload["recipient"]["relationship"] = "unknown"
        with self.assertRaises(InputError):
            IncidentRequest.from_dict(payload)

    def test_live_mode_requires_literal_confirmation(self) -> None:
        request = IncidentRequest.from_dict(VALID)
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaises(InputError):
                    place_call(request, Path(directory) / "audit.jsonl", "calle")

    def test_live_mode_uses_plan_run_status_and_keeps_action_pending(self) -> None:
        request = IncidentRequest.from_dict(VALID)
        responses = [
            {"authenticated": True},
            {
                "ready_to_run": True,
                "to_phone": request.phone,
                "plan_id": "plan-provider-1",
                "confirm_token": "not-written-to-audit",
            },
            {"run_id": "run-1"},
            {"status": "completed", "decision": "acknowledged"},
        ]
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            with (
                patch.dict(os.environ, {"CALLE_LIVE_CONFIRMATION": "CALL_ON_CALL_ONCE"}),
                patch("incident_callback.run_cli", side_effect=responses) as run_cli,
            ):
                result = place_call(request, audit_path, "calle")
            self.assertEqual(run_cli.call_count, 4)
            self.assertEqual(result["decision"], "acknowledged")
            self.assertTrue(result["actionRemainsPending"])
            audit = audit_path.read_text(encoding="utf-8")
            self.assertNotIn(request.phone, audit)
            self.assertNotIn("confirm_token", audit)


if __name__ == "__main__":
    unittest.main()
