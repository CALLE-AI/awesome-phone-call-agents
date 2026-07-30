import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from consent_gate.policy import (
    PolicyError,
    build_manifest,
    record_outcome,
    validate_plan,
    validate_rejection_cooldown,
)
from consent_gate.__main__ import _simulate
from consent_gate.__main__ import _execute


def valid_plan():
    return {
        "purpose": "Confirm that the consenting tester can hear an accessibility message.",
        "phone": "+15555550100",
        "recipient_source": "self",
        "consent_basis": "self_test",
        "ai_disclosure": "This is an automated AI test call.",
        "timezone": "Asia/Seoul",
        "allowed_window": {"start_hour": 9, "end_hour": 18},
        "max_attempts": 1,
        "recording": False,
        "retention_days": 0,
        "locale": "en-US",
        "region": "US",
    }


class PolicyTests(unittest.TestCase):
    def test_example_cannot_enter_live_execution(self):
        plan = json.loads(
            Path("examples/consented_test_call.json").read_text(encoding="utf-8")
        )
        with self.assertRaisesRegex(
            PolicyError, "live execution requires execution_allowed"
        ):
            _execute(plan, "I reviewed this call plan", [])

    def test_valid_plan_passes(self):
        self.assertEqual(validate_plan(valid_plan()), [])

    def test_offline_simulation_is_redacted_and_places_no_call(self):
        plan = valid_plan()
        result = _simulate(plan, [])
        self.assertFalse(result["network_used"])
        self.assertFalse(result["call_placed"])
        self.assertEqual(result["preflight"], "passed")
        self.assertNotIn(plan["phone"], json.dumps(result))

    def test_blocks_secret_request(self):
        plan = valid_plan()
        plan["purpose"] = "Ask the recipient for their one-time code to verify identity."
        self.assertIn("secrets", " ".join(validate_plan(plan)))

    def test_blocks_non_consent_source(self):
        plan = valid_plan()
        plan["recipient_source"] = "scraped_directory"
        self.assertIn("consent-based", " ".join(validate_plan(plan)))

    def test_recording_requires_consent(self):
        plan = valid_plan()
        plan["recording"] = True
        self.assertIn("recording_consent", " ".join(validate_plan(plan)))

    def test_manifest_redacts_phone(self):
        plan = valid_plan()
        manifest = build_manifest(plan)
        self.assertNotIn("phone", manifest)
        self.assertNotIn(plan["phone"], str(manifest))
        self.assertEqual(len(manifest["phone_fingerprint"]), 12)

    def test_invalid_manifest_raises(self):
        plan = valid_plan()
        plan["max_attempts"] = 10
        with self.assertRaises(PolicyError):
            build_manifest(plan)

    def test_rejection_blocks_retry_during_24_hour_window(self):
        now = datetime(2026, 7, 29, 12, tzinfo=timezone.utc)
        history = [
            record_outcome(
                valid_plan()["phone"],
                "rejected",
                occurred_at=now - timedelta(hours=23, minutes=59),
            )
        ]
        errors = validate_rejection_cooldown(valid_plan(), history, now=now)
        self.assertIn("within the last 24 hours", " ".join(errors))

    def test_retry_allowed_after_24_hour_window(self):
        now = datetime(2026, 7, 29, 12, tzinfo=timezone.utc)
        history = [
            record_outcome(
                valid_plan()["phone"],
                "rejected",
                occurred_at=now - timedelta(hours=24),
            )
        ]
        self.assertEqual(
            validate_rejection_cooldown(valid_plan(), history, now=now),
            [],
        )

    def test_rejection_history_uses_redacted_phone_fingerprint(self):
        event = record_outcome(valid_plan()["phone"], "rejected")
        self.assertNotIn("phone", event)
        self.assertNotIn(valid_plan()["phone"], str(event))


if __name__ == "__main__":
    unittest.main()
