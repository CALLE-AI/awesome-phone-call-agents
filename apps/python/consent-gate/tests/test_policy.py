import json
import os
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from consent_gate.policy import (
    PolicyError,
    build_manifest,
    record_outcome,
    validate_attempt_limit,
    validate_dispatch_window,
    validate_plan,
    validate_rejection_cooldown,
)
from consent_gate.ledger import DurableLedger
from consent_gate.__main__ import (
    _execute,
    _finalize_result,
    _reconcile,
    _request_for_plan,
    _request_identity,
    _simulate,
    _verified_outcome,
)


PROVIDER_NAMESPACE = "calle-project-test"


def valid_plan():
    return {
        "purpose": "Confirm that the consenting tester can hear an accessibility message.",
        "purpose_kind": "accessibility_test",
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


def high_confidence_result(**structured_overrides):
    structured = {
        "contact_made": "yes",
        "can_hear_clearly": "yes",
        "end_call_requested": "no",
        "do_not_call_requested": "no",
    }
    structured.update(structured_overrides)
    return {
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.95, "label": "high"},
        "evidence": [{"kind": "transcript"}],
        "structured_result": structured,
        "recipients": [
            {
                "attempts": [
                    {
                        "status": "completed",
                        "failure_code": None,
                        "transcript_turns": [
                            {"speaker": "recipient", "text": "I can hear you."}
                        ],
                    }
                ]
            }
        ],
    }


def verified_no_contact_result(status="no_answer"):
    return {
        "status": status,
        "task_completed": False,
        "structured_result": {
            "contact_made": "no",
            "can_hear_clearly": "unknown",
            "end_call_requested": "unknown",
            "do_not_call_requested": "unknown",
        },
        "recipients": [
            {
                "attempts": [
                    {
                        "status": "failed",
                        "failure_code": "no_answer",
                        "transcript_turns": [],
                    }
                ]
            }
        ],
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

    def test_accepted_call_still_waiting_blocks_concurrent_dispatch(self):
        plan = valid_plan()
        plan["max_attempts"] = 2
        history = [
            {
                "event": "dispatch_reserved",
                "state": "accepted_waiting",
                "provider_call_id": "call_123",
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

    def test_blocks_api_tokens_and_pins(self):
        for secret in ("API token", "PIN", "access token"):
            with self.subTest(secret=secret):
                plan = valid_plan()
                plan["purpose"] = f"Ask the recipient to provide their {secret}."
                self.assertIn("secrets", " ".join(validate_plan(plan)))

    def test_blocks_sensitive_purpose_domains(self):
        purposes = {
            "medical": "Diagnose the recipient's symptoms and recommend treatment.",
            "legal": "Give the recipient legal advice about a pending lawsuit.",
            "financial": "Recommend an investment and arrange a money transfer.",
            "emergency": "Handle an emergency and decide whether to call an ambulance.",
        }
        for domain, purpose in purposes.items():
            with self.subTest(domain=domain):
                plan = valid_plan()
                plan["purpose"] = purpose
                self.assertIn(domain, " ".join(validate_plan(plan)))

    def test_rejects_unapproved_or_modified_purpose_template(self):
        plan = valid_plan()
        plan["purpose_kind"] = "freeform"
        self.assertIn("purpose_kind", " ".join(validate_plan(plan)))
        plan = valid_plan()
        plan["purpose"] += " Also discuss an unrelated topic."
        self.assertIn("exactly match", " ".join(validate_plan(plan)))

    def test_safe_accessibility_purpose_remains_allowed(self):
        self.assertEqual(validate_plan(valid_plan()), [])

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

    def test_do_not_call_is_permanent(self):
        history = [record_outcome(valid_plan()["phone"], "do_not_call")]
        errors = validate_rejection_cooldown(valid_plan(), history)
        self.assertIn("explicit do-not-call", " ".join(errors))

    def test_explicit_do_not_call_requires_transcript_corroboration(self):
        result = high_confidence_result(do_not_call_requested="yes")
        result["recipients"][0]["attempts"][0]["transcript_turns"][0][
            "text"
        ] = "Please do not call me again."
        self.assertEqual(_verified_outcome(result), "do_not_call")

    def test_uncorroborated_do_not_call_fails_closed(self):
        result = high_confidence_result(do_not_call_requested="yes")
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_agent_acknowledgement_does_not_corroborate_do_not_call(self):
        result = high_confidence_result(do_not_call_requested="yes")
        result["recipients"][0]["attempts"][0]["transcript_turns"] = [
            {"speaker": "agent", "text": "I will not call you again."}
        ]
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_inability_to_hear_is_not_recipient_refusal(self):
        result = {
            "status": "completed",
            "structured_result": {
                "contact_made": "yes",
                "can_hear_clearly": "no",
                "end_call_requested": "no",
                "do_not_call_requested": "no",
            },
        }
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_provider_rejection_is_not_recipient_refusal(self):
        result = {
            "status": "rejected",
            "structured_result": {
                "contact_made": "unknown",
                "end_call_requested": "no",
                "do_not_call_requested": "no",
            },
        }
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_completed_provider_status_without_reachability_is_unknown(self):
        self.assertEqual(_verified_outcome({"status": "completed"}), "unknown")

    def test_completed_provider_status_requires_verified_reachability(self):
        result = high_confidence_result()
        self.assertEqual(_verified_outcome(result), "completed")

    def test_temporary_refusal_creates_rejected_outcome(self):
        result = high_confidence_result(end_call_requested="yes")
        result["recipients"][0]["attempts"][0]["transcript_turns"][0][
            "text"
        ] = "This is not a good time. Please end this call."
        self.assertEqual(_verified_outcome(result), "rejected")

    def test_temporary_refusal_is_persisted_and_starts_cooldown(self):
        result = high_confidence_result(end_call_requested="yes")
        result["recipients"][0]["attempts"][0]["transcript_turns"][0][
            "text"
        ] = "Please end this call and call me later."
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "ledger.json"
            ledger = DurableLedger(state_path)
            with ledger.locked_events() as events:
                events.append(
                    {
                        "event": "dispatch_reserved",
                        "reservation_id": "reservation-1",
                        "phone_fingerprint": record_outcome(
                            valid_plan()["phone"], "failed"
                        )["phone_fingerprint"],
                        "occurred_at": datetime.now(timezone.utc).isoformat(),
                        "state": "accepted_waiting",
                    }
                )
            _finalize_result(ledger, "reservation-1", result)
            history = ledger.load()

        self.assertEqual(history[0]["outcome"], "rejected")
        self.assertEqual(history[0]["state"], "accepted")
        self.assertIn(
            "within the last 24 hours",
            " ".join(validate_rejection_cooldown(valid_plan(), history)),
        )

    def test_uncorroborated_temporary_refusal_fails_closed(self):
        result = high_confidence_result(end_call_requested="yes")
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_low_confidence_temporary_refusal_fails_closed(self):
        result = high_confidence_result(end_call_requested="yes")
        result["recipients"][0]["attempts"][0]["transcript_turns"][0][
            "text"
        ] = "Please hang up."
        result["completion_confidence"] = {"score": 0.4, "label": "low"}
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_low_confidence_completion_fails_closed(self):
        result = high_confidence_result()
        result["completion_confidence"] = {"score": 0.4, "label": "low"}
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_completed_provider_status_without_stop_evidence_is_unknown(self):
        result = {
            "status": "completed",
            "structured_result": {
                "contact_made": "yes",
                "can_hear_clearly": "yes",
            },
        }
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_no_answer_requires_positive_no_contact_evidence(self):
        self.assertEqual(_verified_outcome({"status": "no_answer"}), "unknown")
        result = verified_no_contact_result()
        self.assertEqual(_verified_outcome(result), "no_answer")

    def test_no_contact_model_field_without_attempt_evidence_fails_closed(self):
        result = verified_no_contact_result()
        result.pop("recipients")
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_failed_after_possible_contact_requires_reconciliation(self):
        result = {
            "status": "failed",
            "structured_result": {"contact_made": "unknown"},
        }
        self.assertEqual(_verified_outcome(result), "unknown")

    def test_request_identity_is_content_bound_and_stable(self):
        payload = _request_for_plan(valid_plan(), PROVIDER_NAMESPACE)
        digest, key = _request_identity(payload, PROVIDER_NAMESPACE)
        self.assertEqual(
            (digest, key), _request_identity(payload, PROVIDER_NAMESPACE)
        )
        changed = json.loads(json.dumps(payload))
        changed["task"] += " Changed."
        self.assertNotEqual(
            digest, _request_identity(changed, PROVIDER_NAMESPACE)[0]
        )
        self.assertTrue(key.endswith(digest))

    def test_request_identity_is_bound_to_provider_namespace(self):
        payload = _request_for_plan(valid_plan(), PROVIDER_NAMESPACE)
        self.assertNotEqual(
            _request_identity(payload, PROVIDER_NAMESPACE),
            _request_identity(payload, "calle-project-other"),
        )

    def test_request_schema_requires_contact_evidence(self):
        schema = _request_for_plan(valid_plan(), PROVIDER_NAMESPACE)["result_schema"]
        self.assertIn("contact_made", schema["required"])
        self.assertIn("do_not_call_requested", schema["required"])

    def test_request_repeats_sensitive_content_boundaries(self):
        task = _request_for_plan(valid_plan(), PROVIDER_NAMESPACE)["task"]
        self.assertIn("medical, legal, or financial advice", task)
        self.assertIn("do not handle emergencies", task)

    def test_request_uses_allowlisted_purpose_not_modified_free_text(self):
        plan = valid_plan()
        plan["purpose"] = "UNTRUSTED FREEFORM TEXT"
        task = _request_for_plan(plan, PROVIDER_NAMESPACE)["task"]
        self.assertNotIn("UNTRUSTED", task)
        self.assertIn("consenting tester", task)

    def test_execute_checkpoints_call_id_before_waiting(self):
        plan = valid_plan()
        plan["execution_allowed"] = True
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "ledger.json"
            observed = {}

            class FakeCalls:
                def create(self, **kwargs):
                    observed["create"] = kwargs
                    return {"id": "call_123"}

                def wait_for_result(self, call_id):
                    observed["during_wait"] = json.loads(
                        state_path.read_text(encoding="utf-8")
                    )[0]
                    self.assert_call_id = call_id
                    return high_confidence_result()

            fake_calls = FakeCalls()

            class FakeClient:
                def __init__(self, **_kwargs):
                    self.calls = fake_calls

            fake_module = types.SimpleNamespace(CalleClient=FakeClient)
            with (
                patch.dict(sys.modules, {"calle": fake_module}),
                patch.dict(
                    os.environ,
                    {
                        "CALLE_API_KEY": "test-only",
                        "CALLE_IDEMPOTENCY_NAMESPACE": PROVIDER_NAMESPACE,
                    },
                ),
                patch(
                    "consent_gate.__main__.validate_dispatch_window",
                    return_value=[],
                ),
            ):
                result = _execute(
                    plan,
                    "I reviewed this call plan",
                    str(state_path),
                )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(fake_calls.assert_call_id, "call_123")
            self.assertEqual(observed["during_wait"]["state"], "accepted_waiting")
            self.assertEqual(
                observed["during_wait"]["provider_call_id"], "call_123"
            )
            self.assertEqual(
                observed["create"]["idempotency_key"],
                observed["during_wait"]["idempotency_key"],
            )
            self.assertEqual(
                observed["during_wait"]["request_payload"],
                {
                    key: value
                    for key, value in observed["create"].items()
                    if key != "idempotency_key"
                },
            )
            self.assertEqual(
                observed["during_wait"]["provider_namespace"],
                PROVIDER_NAMESPACE,
            )

    def test_reconcile_resumes_accepted_waiting_by_call_id_without_create(self):
        plan = valid_plan()
        plan["execution_allowed"] = True
        payload = _request_for_plan(plan, PROVIDER_NAMESPACE)
        digest, key = _request_identity(payload, PROVIDER_NAMESPACE)
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "ledger.json"
            state_path.write_text(
                json.dumps(
                    [
                        {
                            "event": "dispatch_reserved",
                            "reservation_id": "reservation-1",
                            "state": "accepted_waiting",
                            "request_payload": payload,
                            "request_sha256": digest,
                            "idempotency_key": key,
                            "provider_namespace": PROVIDER_NAMESPACE,
                            "provider_call_id": "call_123",
                        }
                    ]
                ),
                encoding="utf-8",
            )

            class FakeCalls:
                def create(self, **_kwargs):
                    raise AssertionError("accepted_waiting must not create a new call")

                def wait_for_result(self, call_id):
                    self.call_id = call_id
                    return high_confidence_result()

            fake_calls = FakeCalls()

            class FakeClient:
                def __init__(self, **_kwargs):
                    self.calls = fake_calls

            with (
                patch.dict(
                    sys.modules,
                    {"calle": types.SimpleNamespace(CalleClient=FakeClient)},
                ),
                patch.dict(
                    os.environ,
                    {
                        "CALLE_API_KEY": "test-only",
                        "CALLE_IDEMPOTENCY_NAMESPACE": PROVIDER_NAMESPACE,
                    },
                ),
            ):
                result = _reconcile(
                    plan,
                    "I reviewed this call plan",
                    str(state_path),
                    "reservation-1",
                )

            self.assertEqual(result["status"], "completed")
            self.assertEqual(fake_calls.call_id, "call_123")
            event = json.loads(state_path.read_text(encoding="utf-8"))[0]
            self.assertEqual(event["state"], "accepted")


if __name__ == "__main__":
    unittest.main()
