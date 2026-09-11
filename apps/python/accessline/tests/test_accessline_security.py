"""Security and privacy gates for AccessLine live path (network-free)."""

from __future__ import annotations

import json
import unittest
from typing import Any
from unittest.mock import patch

from accessline.adapter import CallEAdapter, CallERestProvider
from accessline.exceptions import CallEUnavailable
from accessline.calle_rest import CallERestClient
from accessline.live_auth import (
    LiveAuthorizationError,
    LiveCallIntent,
    assert_live_call_authorized,
    assert_strict_e164,
)
from accessline.origin import assert_approved_call_e_origin
from accessline.privacy import mask_phone, sanitize_artifact_dict
from accessline.prompt import build_call_script
from accessline.schema import AccessLineInput
from accessline.workflow import AccessLineWorkflow, WorkflowError


class FakeTransport:
    calls: list[dict[str, Any]] = []

    def __init__(self, responses: list[tuple[int, dict[str, Any]]] | None = None) -> None:
        self._responses = list(responses or [])
        self._index = 0

    def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, dict[str, Any]]:
        FakeTransport.calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": json.loads(body.decode("utf-8")) if body else None,
            }
        )
        if self._index >= len(self._responses):
            raise AssertionError("unexpected transport call")
        response = self._responses[self._index]
        self._index += 1
        return response


def _live_input(
    *,
    phone: str = "+15555550199",
    authorized: str | None = None,
    consent: bool = True,
    run_id: str = "run_test_001",
    action: str = "live_call",
    include_intent: bool = True,
) -> AccessLineInput:
    kwargs: dict[str, Any] = {
        "venue_name": "Fictional Test Venue",
        "phone_number": phone,
        "visit_date": "2026-09-10",
        "consent_confirmed": consent,
    }
    if include_intent:
        kwargs.update(
            {
                "live_run_id": run_id,
                "live_authorized_destination_e164": authorized if authorized is not None else phone,
                "live_action": action,
            }
        )
    return AccessLineInput(**kwargs)


class StrictE164Tests(unittest.TestCase):
    def test_valid_e164_accepted(self) -> None:
        self.assertEqual(assert_strict_e164("+15555550199"), "+15555550199")

    def test_no_plus_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("15555550199")

    def test_whitespace_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("+1 5555550199")

    def test_hyphenated_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("+1-555-555-0199")

    def test_parentheses_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("+1(555)5550199")

    def test_extension_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("+15555550199ext123")

    def test_too_short_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("+1")

    def test_too_long_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_strict_e164("+" + ("1" * 16))


class DestinationAuthorizationTests(unittest.TestCase):
    def test_exact_authorized_destination_accepted(self) -> None:
        intent = LiveCallIntent(
            run_id="run_a",
            authorized_destination_e164="+15555550199",
            action="live_call",
        )
        assert_live_call_authorized(
            destination="+15555550199",
            consent_confirmed=True,
            live_intent=intent,
            expected_run_id="run_a",
        )

    def test_different_destination_rejected(self) -> None:
        intent = LiveCallIntent(
            run_id="run_a",
            authorized_destination_e164="+15555550199",
            action="live_call",
        )
        with self.assertRaises(LiveAuthorizationError):
            assert_live_call_authorized(
                destination="+15555550999",
                consent_confirmed=True,
                live_intent=intent,
            )

    def test_consent_alone_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            assert_live_call_authorized(
                destination="+15555550199",
                consent_confirmed=True,
                live_intent=None,
            )

    def test_missing_fresh_intent_rejected_by_workflow(self) -> None:
        FakeTransport.calls = []
        transport = FakeTransport([(201, {"id": "call_x", "status": "completed", "recipients": []})])
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(
                provider=CallERestProvider(
                    client=CallERestClient(api_key="iams_live_test_key", transport=transport)
                )
            )
        )
        with self.assertRaises(WorkflowError):
            workflow.run_live(_live_input(include_intent=False))
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_mismatched_run_rejected(self) -> None:
        intent = LiveCallIntent(
            run_id="run_a",
            authorized_destination_e164="+15555550199",
            action="live_call",
        )
        with self.assertRaises(LiveAuthorizationError):
            assert_live_call_authorized(
                destination="+15555550199",
                consent_confirmed=True,
                live_intent=intent,
                expected_run_id="run_other",
            )

    def test_mismatched_action_rejected(self) -> None:
        with self.assertRaises(LiveAuthorizationError):
            LiveCallIntent(
                run_id="run_a",
                authorized_destination_e164="+15555550199",
                action="preview",
            )


class OriginPinningTests(unittest.TestCase):
    def test_official_https_origin_accepted(self) -> None:
        self.assertEqual(
            assert_approved_call_e_origin("https://api.heycall-e.com"),
            "https://api.heycall-e.com",
        )

    def test_http_rejected(self) -> None:
        with self.assertRaises(CallEUnavailable):
            assert_approved_call_e_origin("http://api.heycall-e.com")

    def test_arbitrary_hostile_origin_rejected(self) -> None:
        with self.assertRaises(CallEUnavailable):
            assert_approved_call_e_origin("https://evil.example.com")

    def test_lookalike_host_rejected(self) -> None:
        with self.assertRaises(CallEUnavailable):
            assert_approved_call_e_origin("https://api.heycall-e.com.evil.example")

    def test_alternate_port_rejected(self) -> None:
        with self.assertRaises(CallEUnavailable):
            assert_approved_call_e_origin("https://api.heycall-e.com:8443")

    def test_userinfo_rejected(self) -> None:
        with self.assertRaises(CallEUnavailable):
            assert_approved_call_e_origin("https://user:pass@api.heycall-e.com")

    def test_unapproved_origin_never_gets_auth_header(self) -> None:
        FakeTransport.calls = []
        with self.assertRaises(CallEUnavailable):
            CallERestClient(
                api_key="iams_live_test_key",
                base_url="https://attacker.example",
                transport=FakeTransport(),
            )
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_env_override_to_hostile_origin_rejected_before_auth(self) -> None:
        FakeTransport.calls = []
        with patch.dict(
            "os.environ",
            {"CALLE_BASE_URL": "https://attacker.example", "CALLE_API_KEY": "iams_live_test_key"},
            clear=False,
        ):
            with self.assertRaises(CallEUnavailable):
                CallERestClient(transport=FakeTransport())
        self.assertEqual(len(FakeTransport.calls), 0)


class PrivacyTests(unittest.TestCase):
    def test_mask_phone(self) -> None:
        masked = mask_phone("+15555550199")
        self.assertTrue(masked.startswith("+1"))
        self.assertIn("*", masked)
        self.assertTrue(masked.endswith("0199"))
        self.assertNotEqual(masked, "+15555550199")

    def test_artifact_omits_transcript_by_default(self) -> None:
        payload = sanitize_artifact_dict(
            {
                "input": {"phone_number": "+15555550199", "venue_name": "X", "consent_confirmed": True},
                "mock_transcript": "secret live transcript body",
            }
        )
        self.assertNotIn("mock_transcript", payload)
        self.assertTrue(payload["transcript_present"])
        self.assertNotIn("secret live transcript body", json.dumps(payload))
        self.assertNotIn("+15555550199", json.dumps(payload))

    def test_opt_in_transcript_retention(self) -> None:
        payload = sanitize_artifact_dict(
            {
                "input": {"phone_number": "+15555550199"},
                "mock_transcript": "synthetic transcript only",
            },
            include_transcript=True,
        )
        self.assertEqual(payload["mock_transcript"], "synthetic transcript only")
        self.assertEqual(payload["transcript_retention"], "OPT_IN_DEBUG")


class ProviderBoundaryGateTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeTransport.calls = []

    def test_provider_not_called_when_intent_missing(self) -> None:
        transport = FakeTransport([(201, {"id": "c", "status": "completed", "recipients": []})])
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(
                provider=CallERestProvider(
                    client=CallERestClient(api_key="iams_live_test_key", transport=transport)
                )
            )
        )
        with self.assertRaises(WorkflowError):
            workflow.run_live(_live_input(include_intent=False, consent=True))
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_provider_called_only_after_gates_pass(self) -> None:
        completed = {
            "id": "call_123",
            "status": "completed",
            "recipients": [
                {
                    "phones": ["+15555550199"],
                    "status": "completed",
                    "structured_result": {
                        "step_free_entrance": "yes",
                        "accessible_restroom": "yes",
                        "access_instructions": "side ramp",
                        "uncertainty_notes": "",
                    },
                    "attempts": [],
                }
            ],
            "created_at": "2026-09-01T12:00:00+00:00",
            "completed_at": "2026-09-01T12:01:00+00:00",
            "task_completed": True,
        }
        transport = FakeTransport([(201, completed)])
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(
                provider=CallERestProvider(
                    client=CallERestClient(
                        api_key="iams_live_test_key",
                        transport=transport,
                        sleeper=lambda _s: None,
                    )
                )
            )
        )
        artifacts = workflow.run_live(_live_input(include_intent=True))
        self.assertEqual(len(FakeTransport.calls), 1)
        self.assertIn("Authorization", FakeTransport.calls[0]["headers"])
        self.assertTrue(FakeTransport.calls[0]["url"].startswith("https://api.heycall-e.com/"))
        serialized = json.dumps(workflow.artifacts_to_dict(artifacts))
        self.assertNotIn("+15555550199", serialized)
        self.assertNotIn("mock_transcript", serialized)
        self.assertIn("transcript_present", serialized)


if __name__ == "__main__":
    unittest.main()
