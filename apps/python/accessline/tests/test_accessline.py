"""Deterministic tests for AccessLine local build."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

from accessline.adapter import (
    CallEAdapter,
    MockCallEProvider,
)
from accessline.exceptions import CallEUnavailable
from accessline.calle_contract import IMPLEMENTATION_STATE_READY
from accessline.ledger import ABSOLUTE_CEILING, CallLedger, CallLedgerError
from accessline.prompt import (
    AUTOMATION_DISCLOSURE,
    CLOSING_REQUIREMENT,
    FIXED_QUESTIONS,
    REPEAT_BEHAVIOR,
    build_call_script,
    script_contains_disclosure,
    script_contains_polite_closing,
    script_contains_repeat_behavior,
    script_does_not_conceal_ai_identity,
    script_contains_sensitive_expansion,
    script_preserves_three_question_scope,
)
from accessline.schema import (
    AccessLineInput,
    derive_accessline_completion_status,
    is_valid_accessline_verification,
    validate_result,
)
from accessline.workflow import AccessLineWorkflow, ConsentRequired

ROOT = Path(__file__).resolve().parents[1]
DEMO_FIXTURE = ROOT / "examples/demo_fictional_venue.json"


def _input(*, consent: bool = True, with_live_intent: bool = False) -> AccessLineInput:
    phone = "+15555550199"
    kwargs = {
        "venue_name": "Fictional Test Venue",
        "phone_number": phone,
        "visit_date": "2026-09-10",
        "consent_confirmed": consent,
    }
    if with_live_intent:
        kwargs.update(
            {
                "live_run_id": "run_test_001",
                "live_authorized_destination_e164": phone,
                "live_action": "live_call",
            }
        )
    return AccessLineInput(**kwargs)


def _valid_response(**overrides):
    payload = {
        "venue_name": "Fictional Test Venue",
        "called_at": "2026-09-01T12:00:00+00:00",
        "step_free_entrance": "yes",
        "accessible_restroom": "yes",
        "access_instructions": "Use main entrance.",
        "uncertainty_notes": "MOCK only.",
        "source_type": "phone_call",
        "completion_status": "complete",
    }
    payload.update(overrides)
    return payload


class AccessLineTests(unittest.TestCase):
    def test_valid_structured_accessibility_result(self) -> None:
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(provider=MockCallEProvider(_valid_response()))
        )
        artifacts = workflow.run_mock(_input(), _valid_response())
        self.assertEqual(artifacts.result.source_type, "phone_call")
        self.assertEqual(artifacts.result.step_free_entrance, "yes")

    def test_ambiguous_entrance_stays_unknown(self) -> None:
        response = _valid_response(step_free_entrance="unknown", uncertainty_notes="Ramp slope unclear.")
        workflow = AccessLineWorkflow(adapter=CallEAdapter(provider=MockCallEProvider(response)))
        artifacts = workflow.run_mock(_input(), response)
        self.assertEqual(artifacts.result.step_free_entrance, "unknown")

    def test_ambiguous_restroom_stays_unknown(self) -> None:
        response = _valid_response(accessible_restroom="unknown")
        workflow = AccessLineWorkflow(adapter=CallEAdapter(provider=MockCallEProvider(response)))
        artifacts = workflow.run_mock(_input(), response)
        self.assertEqual(artifacts.result.accessible_restroom, "unknown")

    def test_access_instructions_preserved(self) -> None:
        response = _valid_response(access_instructions="Use east-side ramp.")
        workflow = AccessLineWorkflow(adapter=CallEAdapter(provider=MockCallEProvider(response)))
        artifacts = workflow.run_mock(_input(), response)
        self.assertEqual(artifacts.result.access_instructions, "Use east-side ramp.")

    def test_malformed_provider_output_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            validate_result({"venue_name": "x"})

    def test_missing_consent_blocks_call_path(self) -> None:
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(provider=MockCallEProvider(_valid_response()))
        )
        with self.assertRaises(ConsentRequired):
            workflow.run_mock(_input(consent=False), _valid_response())

    def test_automation_disclosure_present(self) -> None:
        script = build_call_script(_input())
        self.assertIn("automated assistant", script.lower())
        self.assertTrue(script_contains_disclosure(script))
        self.assertIn(AUTOMATION_DISCLOSURE, script)

    def test_no_sensitive_question_expansion(self) -> None:
        script = build_call_script(_input()).lower()
        self.assertNotIn("social security", script)
        self.assertNotIn("medical diagnosis", script)
        self.assertFalse(script_contains_sensitive_expansion(build_call_script(_input())))

    def test_three_question_scope_preserved(self) -> None:
        script = build_call_script(_input())
        self.assertTrue(script_preserves_three_question_scope(script))
        self.assertEqual(len(FIXED_QUESTIONS), 3)

    def test_repeat_behavior_present(self) -> None:
        script = build_call_script(_input())
        self.assertTrue(script_contains_repeat_behavior(script))
        self.assertIn(REPEAT_BEHAVIOR, script)

    def test_polite_closing_present(self) -> None:
        script = build_call_script(_input())
        self.assertTrue(script_contains_polite_closing(script))
        self.assertIn(CLOSING_REQUIREMENT, script)

    def test_does_not_conceal_ai_identity(self) -> None:
        script = build_call_script(_input())
        self.assertTrue(script_does_not_conceal_ai_identity(script))

    def test_script_remains_concise(self) -> None:
        script = build_call_script(_input())
        self.assertLessEqual(len(script.split()), 220)

    def test_create_call_body_unchanged_except_task_text(self) -> None:
        from accessline.adapter import CallEAdapter

        adapter = CallEAdapter()
        body = adapter.rest_client.build_create_call_body(_input(), build_call_script(_input()))
        self.assertEqual(set(body.keys()), {"task", "recipients", "recipient_result_schema", "metadata"})
        self.assertNotIn("voice", json.dumps(body).lower())

    def test_absent_credential_fails_closed_before_network(self) -> None:
        adapter = CallEAdapter()
        self.assertEqual(adapter.implementation_state, IMPLEMENTATION_STATE_READY)
        with self.assertRaises(CallEUnavailable):
            adapter.rest_client.build_create_call_request(_input(), build_call_script(_input()))

    def test_documented_request_can_be_built_without_network(self) -> None:
        preview = CallEAdapter().build_documented_create_call_spec(_input())
        self.assertIn("body_preview_without_auth", preview)
        body = preview["body_preview_without_auth"]
        self.assertIn("task", body)
        self.assertIn("recipient_result_schema", body)
        self.assertEqual(body["recipients"][0]["phones"], ["+15555550199"])

    def test_mock_calls_do_not_increment_live_ledger(self) -> None:
        ledger = CallLedger()
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(provider=MockCallEProvider(_valid_response())),
            ledger=ledger,
        )
        workflow.run_mock(_input(), _valid_response())
        self.assertEqual(ledger.live_call_count, 0)
        self.assertEqual(ledger.mock_call_count, 1)

    def test_live_ledger_rejects_over_20(self) -> None:
        ledger = CallLedger(live_call_count=ABSOLUTE_CEILING)
        with self.assertRaises(CallLedgerError):
            ledger.record_live_call()

    def test_early_validation_stop_at_call_6_without_valid_result(self) -> None:
        ledger = CallLedger()
        for index in range(6):
            ledger.record_live_call(label=f"call-{index + 1}")
        with self.assertRaises(CallLedgerError):
            ledger.record_live_call(label="call-7")

    def test_source_type_fixed_to_phone_call(self) -> None:
        result = validate_result(_valid_response())
        self.assertEqual(result.source_type, "phone_call")

    def test_cli_mock_end_to_end_fixture(self) -> None:
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "accessline.cli",
                "--fixture",
                str(DEMO_FIXTURE),
                "--mode",
                "mock",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertFalse(payload["real_call_performed"])
        self.assertEqual(payload["structured_output"]["source_type"], "phone_call")
        self.assertEqual(payload["ledger"]["live_call_count"], 0)
        self.assertNotIn("+15555550100", json.dumps(payload))
        self.assertTrue(payload["input"]["phone_number"].startswith("+1"))
        self.assertIn("*", payload["input"]["phone_number"])
        self.assertNotIn("mock_transcript", payload)
        self.assertTrue(payload.get("transcript_present"))
        self.assertEqual(payload.get("fixture_kind"), "FICTIONAL_TEST_DATA")
        self.assertTrue(payload.get("synthetic"))

    def test_preview_live_blocked_without_credentials(self) -> None:
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "accessline.cli",
                "--fixture",
                str(DEMO_FIXTURE),
                "--mode",
                "preview-live",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = json.loads(proc.stdout)
        self.assertEqual(payload["provider_state"], IMPLEMENTATION_STATE_READY)
        self.assertIn("documented_create_call", payload)

    def test_schema_validation_remains_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            validate_result({"venue_name": "X"})

    def test_is_valid_accessline_verification_requires_complete(self) -> None:
        complete = validate_result(_valid_response())
        partial = validate_result(_valid_response(completion_status="partial"))
        self.assertTrue(is_valid_accessline_verification(complete))
        self.assertFalse(is_valid_accessline_verification(partial))

    def test_question_flow_not_executed_derives_partial(self) -> None:
        status = derive_accessline_completion_status(
            provider_status="completed",
            structured={
                "step_free_entrance": "unknown",
                "accessible_restroom": "unknown",
                "access_instructions": "",
            },
            uncertainty_notes="The accessibility questions were not asked or answered.",
            call_task={"status": "completed", "task_completed": True},
        )
        self.assertEqual(status, "partial")


if __name__ == "__main__":
    unittest.main()
