import json
import os
import tempfile
import unittest
import sys
from pathlib import Path
from io import StringIO
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from appointment_confirm.engine import execute_mock, execute_with_client, preview
from appointment_confirm.live_client import validate_trusted_base_url
from appointment_confirm.schema import load_intake
from appointment_confirm.task import idempotency_key
import client as cli

APP = Path(__file__).resolve().parents[1]
FIXTURES = APP / "fixtures"


class FakeCalle:
    def __init__(self, payload):
        self.payload = payload
        self.kwargs = None

    def create_and_wait(self, **kwargs):
        self.kwargs = kwargs
        return self.payload


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.intake = load_intake(FIXTURES / "sample_appointment.json")

    def test_preview_does_not_call(self):
        plan = preview(self.intake)
        self.assertFalse(plan["creates_phone_call"])
        self.assertEqual(plan["mode"], "preview")
        self.assertIn("+44", plan["phone_masked"])
        self.assertNotIn("7700900123", json.dumps(plan))
        self.assertIn("recipient_result_schema", plan)
        self.assertEqual(plan["idempotency_key"], idempotency_key(self.intake))

    def test_mock_confirm_yes_json(self):
        ticket = execute_mock(self.intake, FIXTURES / "conversation_confirm_yes.json")
        self.assertEqual(ticket["mode"], "mock")
        self.assertFalse(ticket["creates_phone_call"])
        self.assertEqual(ticket["can_attend"], "yes")
        self.assertEqual(ticket["confirmed_time"], "2026-09-03T10:00:00+01:00")
        self.assertEqual(ticket["disposition"], "confirmed")
        self.assertFalse(ticket["needs_human"])

    def test_mock_reschedule_needs_human(self):
        ticket = execute_mock(self.intake, FIXTURES / "conversation_reschedule.json")
        self.assertEqual(ticket["can_attend"], "no")
        self.assertEqual(ticket["requested_time"], "2026-09-03T14:00:00+01:00")
        self.assertEqual(ticket["disposition"], "reschedule_requested")
        self.assertTrue(ticket["needs_human"])

    def test_mock_voicemail_unknown(self):
        ticket = execute_mock(self.intake, FIXTURES / "conversation_voicemail.json")
        self.assertEqual(ticket["can_attend"], "unknown")
        self.assertEqual(ticket["disposition"], "voicemail")
        self.assertTrue(ticket["needs_human"])

    def test_low_confidence_fail_closed(self):
        ticket = execute_mock(self.intake, FIXTURES / "conversation_ambiguous.json")
        self.assertEqual(ticket["disposition"], "needs_human")
        self.assertTrue(ticket["needs_human"])

    def test_incomplete_call_fail_closed(self):
        fake = FakeCalle({"status": "failed", "task_completed": False, "recipients": [{}]})
        ticket = execute_with_client(self.intake, fake, mode="live")
        self.assertEqual(ticket["disposition"], "needs_human")
        self.assertTrue(ticket["creates_phone_call"])

    def test_live_client_receives_schema_and_idempotency(self):
        payload = {
            "id": "call_test",
            "status": "completed",
            "task_completed": True,
            "completion_confidence": {"score": 0.95, "label": "high"},
            "evidence": ["Yes"],
            "recipients": [
                {
                    "structured_result": {
                        "can_attend": "yes",
                        "confirmed_time": "2026-09-03T10:00:00+01:00",
                        "requested_time": "",
                        "disposition": "confirmed",
                    },
                    "attempts": [{"transcript_turns": []}],
                }
            ],
        }
        fake = FakeCalle(payload)
        ticket = execute_with_client(self.intake, fake, mode="live")
        self.assertEqual(ticket["can_attend"], "yes")
        self.assertIn("recipient_result_schema", fake.kwargs)
        self.assertEqual(fake.kwargs["recipients"][0]["phones"], [self.intake["phone"]])
        self.assertTrue(fake.kwargs["idempotency_key"].startswith("appointment_confirm:"))

    def test_base_url_locked(self):
        with self.assertRaises(ValueError):
            validate_trusted_base_url("https://evil.example")

    def test_cli_preview_and_mock(self):
        buf = StringIO()
        with patch("sys.stdout", buf):
            rc = cli.main(["--request", str(FIXTURES / "sample_appointment.json"), "--preview"])
        self.assertEqual(rc, 0)
        buf = StringIO()
        with patch("sys.stdout", buf):
            rc = cli.main(
                [
                    "--request",
                    str(FIXTURES / "sample_appointment.json"),
                    "--mock",
                    "--fixture",
                    str(FIXTURES / "conversation_decline.json"),
                ]
            )
        self.assertEqual(rc, 0)

    def test_cli_execute_without_consent(self):
        with patch("sys.stderr", StringIO()):
            rc = cli.main(["--request", str(FIXTURES / "sample_appointment.json"), "--execute"])
        self.assertEqual(rc, 2)

    def test_cli_execute_without_key(self):
        env = {k: v for k, v in os.environ.items() if k != "CALLE_API_KEY"}
        with patch.dict(os.environ, env, clear=True), patch("sys.stderr", StringIO()):
            rc = cli.main(
                [
                    "--request",
                    str(FIXTURES / "sample_appointment.json"),
                    "--execute",
                    "--confirm-consent",
                ]
            )
        self.assertEqual(rc, 2)

    def test_output_file_mode_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ticket.json"
            with patch("sys.stdout", StringIO()):
                rc = cli.main(
                    [
                        "--request",
                        str(FIXTURES / "sample_appointment.json"),
                        "--mock",
                        "--output",
                        str(dest),
                    ]
                )
            self.assertEqual(rc, 0)
            self.assertEqual(oct(dest.stat().st_mode)[-3:], "600")
            with patch("sys.stderr", StringIO()):
                rc = cli.main(
                    [
                        "--request",
                        str(FIXTURES / "sample_appointment.json"),
                        "--mock",
                        "--output",
                        str(dest),
                    ]
                )
            self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
