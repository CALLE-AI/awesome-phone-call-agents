import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from consent_gate.policy import (
    PolicyError,
    build_manifest,
    record_outcome,
    validate_attempt_limit,
    validate_dispatch_window,
    validate_plan,
    validate_rejection_cooldown,
)
from consent_gate.__main__ import _execute, _simulate, _verified_outcome


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
            _execute(plan, "I reviewed this call plan", None)

    def test_valid_plan_passes(self):
        self.assertEqual(validate_plan(valid_plan()), [])

    def test_timezone_must_exist_in_iana_database(self):
        plan = valid_plan()
        plan["timezone"] = "Mars/Olympus_Mons"
        self.assertIn("valid IANA", " ".join(validate_plan(plan)))

    def test_dispatch_window_uses_recipient_local_time(self):
        plan = valid_plan()
        now = datetime(2026, 7, 29, 0, tzinfo=timezone.utc)  # 09:00 Seoul
        self.assertEqual(validate_dispatch_window(plan, now=now), [])
        outside = datetime(2026, 7, 29, 12, tzinfo=timezone.utc)  # 21:00 Seoul
        self.assertIn("outside", " ".join(validate_dispatch_window(plan, now=outside)))

    def test_dispatch_reservations_enforce_attempt_limit(self):
        plan = valid_plan()
        history = [
            {
                "event": "dispatch_reserved",
                "phone_fingerprint": record_outcome(plan["phone"], "failed")[
                    "phone_fingerprint"
                ],
            }
        ]
        self.assertIn("max_attempts", " ".join(validate_attempt_limit(plan, history)))

    def test_unresolved_dispatch_requires_reconciliation_even_with_attempts_left(self):
        plan = valid_plan()
        plan["max_attempts"] = 2
        history = [
            {
                "event": "dispatch_reserved",
                "state": "reconciliation_required",
                "phone_fingerprint": record_outcome(plan["phone"], "failed")[
                    "phone_fingerprint"
                ],
            }
        ]
        self.assertIn("reconcile", " ".join(validate_attempt_limit(plan, history)))

    def test_live_execution_requires_durable_state(self):
        plan = valid_plan()
        plan["execution_allowed"] = True
        with self.assertRaisesRegex(PolicyError, "durable ledger"):
            _execute(plan, "I reviewed this call plan", None)

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

    def test_completed_provider_status_with_recipient_refusal_is_rejected(self):
        result = {
            "status": "completed",
            "structured_result": {"can_hear_clearly": "no"},
        }
        self.assertEqual(_verified_outcome(result), "rejected")

    def test_completed_provider_status_without_reachability_is_unknown(self):
        self.assertEqual(_verified_outcome({"status": "completed"}), "unknown")

    def test_completed_provider_status_requires_verified_reachability(self):
        result = {
            "status": "completed",
            "structured_result": {"can_hear_clearly": "yes"},
        }
        self.assertEqual(_verified_outcome(result), "completed")


if __name__ == "__main__":
    unittest.main()
