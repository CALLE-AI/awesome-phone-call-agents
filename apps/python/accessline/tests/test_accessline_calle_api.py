"""CALL-E authoritative REST adapter contract tests (network-free)."""

from __future__ import annotations

import json
import ssl
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from accessline.adapter import CallEAdapter, CallERestProvider
from accessline.exceptions import CallEUnavailable
from accessline.calle_contract import (
    AUTH_ENV_VAR,
    CREATE_CALL_PATH,
    GET_CALL_PATH_TEMPLATE,
    IMPLEMENTATION_STATE_READY,
)
from accessline.calle_rest import (
    CallERestClient,
    UrllibCallERestTransport,
    build_verified_ssl_context,
    extract_safe_provider_diagnostics,
)
from accessline.ledger import CallLedger, CallLedgerError
from accessline.prompt import build_call_script
from accessline.schema import AccessLineInput, derive_accessline_completion_status, validate_result
from accessline.workflow import AccessLineWorkflow, ConsentRequired


class FakeTransport:
    calls: list[dict[str, Any]] = []

    def __init__(self, responses: list[tuple[int, dict[str, Any]]]) -> None:
        self._responses = list(responses)
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


def _noop_sleep(_seconds: float) -> None:
    return None


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


def _structured(**overrides: Any) -> dict[str, Any]:
    payload = {
        "step_free_entrance": "yes",
        "accessible_restroom": "unknown",
        "access_instructions": "Use side ramp.",
        "uncertainty_notes": "Restroom availability not fully confirmed.",
    }
    payload.update(overrides)
    return payload


def _call_task(*, status: str, structured: dict[str, Any] | None = None, call_id: str = "call_123") -> dict[str, Any]:
    recipient_structured = structured
    return {
        "id": call_id,
        "object": "call_task",
        "status": status,
        "task": "accessibility check",
        "recipients": [
            {
                "id": "rcp_123",
                "phones": ["+15555550199"],
                "status": status if status != "queued" else "pending",
                "structured_result": recipient_structured,
                "attempts": [
                    {
                        "status": status if status == "completed" else "in_progress",
                        "transcript_turns": [
                            {"speaker": "bot", "text": "automated assistant disclosure"},
                            {"speaker": "user", "text": "side ramp available"},
                        ],
                    }
                ] if status == "completed" else [],
            }
        ],
        "structured_result": None,
        "summary": "Accessibility facts collected." if status == "completed" else None,
        "task_completed": True if status == "completed" else None,
        "completion_confidence": {"score": 0.8, "label": "high"} if status == "completed" else None,
        "evidence": [],
        "metadata": {},
        "failure_code": "provider_error" if status == "failed" else None,
        "failure_message": "Call failed" if status == "failed" else None,
        "created_at": "2026-09-01T12:00:00+00:00",
        "completed_at": "2026-09-01T12:01:00+00:00" if status == "completed" else None,
    }


def _completed_call_task(**structured_overrides: Any) -> dict[str, Any]:
    return _call_task(status="completed", structured=_structured(**structured_overrides))


class CallEApiIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeTransport.calls = []

    def test_default_provider_uses_real_transport_without_network(self) -> None:
        client = CallERestClient()
        provider = CallERestProvider(client=client)
        self.assertIsInstance(client.transport, UrllibCallERestTransport)
        self.assertIsInstance(provider.client.transport, UrllibCallERestTransport)
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_builds_valid_documented_request(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        spec = client.build_create_call_request(_input(), build_call_script(_input()))
        self.assertEqual(spec.method, "POST")
        self.assertTrue(spec.url.endswith(CREATE_CALL_PATH))
        self.assertEqual(spec.headers["Authorization"], "Bearer iams_live_test_key")
        self.assertIn("recipient_result_schema", spec.body)

    def test_absent_credential_fails_closed(self) -> None:
        client = CallERestClient(api_key=None)
        with self.assertRaises(CallEUnavailable):
            client.build_create_call_request(_input(), build_call_script(_input()))

    def test_consent_false_blocks_workflow_before_adapter(self) -> None:
        transport = FakeTransport([(201, _call_task(status="queued", structured=None))])
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(
                provider=CallERestProvider(
                    client=CallERestClient(api_key="iams_live_test_key", transport=transport)
                )
            )
        )
        with self.assertRaises(ConsentRequired):
            workflow.run_live(_input(consent=False, with_live_intent=True))
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_ledger_ceiling_blocks_before_adapter(self) -> None:
        ledger = CallLedger()
        for index in range(6):
            ledger.record_live_call(label=f"call-{index + 1}")
        transport = FakeTransport([(201, _call_task(status="queued", structured=None))])
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(
                provider=CallERestProvider(
                    client=CallERestClient(api_key="iams_live_test_key", transport=transport)
                )
            ),
            ledger=ledger,
        )
        with self.assertRaises(CallLedgerError):
            workflow.run_live(_input(with_live_intent=True))
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_documented_success_response_normalizes(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        result = client.normalize_call_task(_completed_call_task(), input_data=_input())
        self.assertEqual(result.step_free_entrance, "yes")
        self.assertEqual(result.accessible_restroom, "unknown")
        self.assertEqual(result.source_type, "phone_call")

    def test_documented_failure_response_fails_closed(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        failed = _call_task(status="failed", structured=None)
        with self.assertRaises(CallEUnavailable):
            client.normalize_call_task(failed, input_data=_input())

    def test_ambiguous_values_preserve_uncertainty(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        result = client.normalize_call_task(
            _completed_call_task(step_free_entrance="maybe"),
            input_data=_input(),
        )
        self.assertEqual(result.step_free_entrance, "unknown")

    def test_post_queued_triggers_get_polling(self) -> None:
        transport = FakeTransport(
            [
                (201, _call_task(status="queued", structured=None)),
                (200, _completed_call_task()),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        terminal = client.create_call_and_wait_for_terminal(
            _input(),
            build_call_script(_input()),
        )
        self.assertEqual(terminal["status"], "completed")
        self.assertEqual(len(FakeTransport.calls), 2)
        self.assertTrue(FakeTransport.calls[0]["url"].endswith(CREATE_CALL_PATH))
        self.assertTrue(
            FakeTransport.calls[1]["url"].endswith(
                GET_CALL_PATH_TEMPLATE.format(call_id="call_123")
            )
        )

    def test_queued_to_in_progress_to_completed(self) -> None:
        transport = FakeTransport(
            [
                (201, _call_task(status="queued", structured=None)),
                (200, _call_task(status="in_progress", structured=None)),
                (200, _completed_call_task()),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        terminal = client.create_call_and_wait_for_terminal(
            _input(),
            build_call_script(_input()),
        )
        self.assertEqual(terminal["status"], "completed")
        self.assertEqual(len(FakeTransport.calls), 3)
        self.assertEqual(FakeTransport.calls[0]["method"], "POST")
        self.assertEqual(FakeTransport.calls[1]["method"], "GET")
        self.assertEqual(FakeTransport.calls[2]["method"], "GET")

    def test_already_completed_create_response_handled(self) -> None:
        transport = FakeTransport([(201, _completed_call_task())])
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        terminal = client.create_call_and_wait_for_terminal(
            _input(),
            build_call_script(_input()),
        )
        self.assertEqual(terminal["status"], "completed")
        self.assertEqual(len(FakeTransport.calls), 1)

    def test_failed_terminal_status_fails_closed(self) -> None:
        transport = FakeTransport(
            [
                (201, _call_task(status="queued", structured=None)),
                (200, _call_task(status="failed", structured=None)),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        with self.assertRaises(CallEUnavailable):
            client.create_call_and_wait_for_terminal(_input(), build_call_script(_input()))

    def test_canceled_terminal_status_fails_closed(self) -> None:
        transport = FakeTransport(
            [
                (201, _call_task(status="queued", structured=None)),
                (200, _call_task(status="canceled", structured=None)),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        with self.assertRaises(CallEUnavailable):
            client.create_call_and_wait_for_terminal(_input(), build_call_script(_input()))

    def test_unknown_status_fails_closed(self) -> None:
        transport = FakeTransport(
            [
                (201, _call_task(status="queued", structured=None)),
                (200, _call_task(status="mystery", structured=None)),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        with self.assertRaises(CallEUnavailable):
            client.create_call_and_wait_for_terminal(_input(), build_call_script(_input()))

    def test_missing_call_id_fails_closed_when_polling_required(self) -> None:
        queued = _call_task(status="queued", structured=None)
        queued.pop("id")
        transport = FakeTransport([(201, queued)])
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        with self.assertRaises(CallEUnavailable):
            client.create_call_and_wait_for_terminal(_input(), build_call_script(_input()))

    def test_polling_timeout_fails_closed(self) -> None:
        queued = _call_task(status="queued", structured=None)
        transport = FakeTransport([(201, queued), (200, queued), (200, queued)])
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        created = client.create_call(_input(), build_call_script(_input()))
        with self.assertRaises(CallEUnavailable) as ctx:
            client.wait_for_terminal_call(created, max_attempts=2)
        self.assertIn("timed out", str(ctx.exception))

    def test_only_one_post_on_successful_async_lifecycle(self) -> None:
        transport = FakeTransport(
            [
                (201, _call_task(status="queued", structured=None)),
                (200, _call_task(status="in_progress", structured=None)),
                (200, _completed_call_task()),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        provider = CallERestProvider(client=client)
        adapter = CallEAdapter(provider=provider)
        workflow = AccessLineWorkflow(adapter=adapter, ledger=CallLedger())
        artifacts = workflow.run_live(_input(with_live_intent=True))
        post_calls = [call for call in FakeTransport.calls if call["method"] == "POST"]
        get_calls = [call for call in FakeTransport.calls if call["method"] == "GET"]
        self.assertEqual(len(post_calls), 1)
        self.assertEqual(len(get_calls), 2)
        self.assertEqual(artifacts.result.accessible_restroom, "unknown")

    def test_idempotency_key_sent_on_create_only(self) -> None:
        transport = FakeTransport([(201, _completed_call_task())])
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        provider = CallERestProvider(client=client)
        provider.place_call(
            CallEAdapter(provider=provider).build_request(_input(), mode="live")
        )
        self.assertIn("Idempotency-Key", FakeTransport.calls[0]["headers"])
        self.assertTrue(FakeTransport.calls[0]["headers"]["Idempotency-Key"])

    def test_fake_transport_error_fails_closed_without_ledger_increment(self) -> None:
        transport = FakeTransport([(401, {"error": "unauthorized"})])
        client = CallERestClient(api_key="iams_live_test_key", transport=transport)
        provider = CallERestProvider(client=client)
        adapter = CallEAdapter(provider=provider)
        ledger = CallLedger()
        workflow = AccessLineWorkflow(adapter=adapter, ledger=ledger)
        with self.assertRaises(CallEUnavailable):
            workflow.run_live(_input(with_live_intent=True))
        self.assertEqual(ledger.live_call_count, 0)

    def test_mock_path_still_network_free(self) -> None:
        from accessline.adapter import MockCallEProvider

        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(
                provider=MockCallEProvider(
                    {
                        "venue_name": "Fictional Test Venue",
                        "called_at": "2026-09-01T12:00:00+00:00",
                        "step_free_entrance": "yes",
                        "accessible_restroom": "yes",
                        "access_instructions": "",
                        "uncertainty_notes": "MOCK",
                        "source_type": "phone_call",
                        "completion_status": "complete",
                    }
                )
            ),
            ledger=CallLedger(),
        )
        workflow.run_mock(_input(), {})
        self.assertEqual(workflow.ledger.live_call_count, 0)

    def test_auth_env_var_constant(self) -> None:
        self.assertEqual(AUTH_ENV_VAR, "CALLE_API_KEY")

    def test_implementation_state_ready_without_provider(self) -> None:
        self.assertEqual(CallEAdapter().implementation_state, IMPLEMENTATION_STATE_READY)

    def test_credential_not_logged_in_request_spec(self) -> None:
        client = CallERestClient(api_key="iams_live_secret_key")
        spec = client.build_create_call_request(_input(), build_call_script(_input()))
        redacted = spec.to_dict()
        self.assertEqual(redacted["headers"]["Authorization"], "Bearer [REDACTED]")
        self.assertNotIn("iams_live_secret_key", json.dumps(redacted))

    def test_provider_completed_does_not_force_accessline_complete(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        task = _completed_call_task(
            step_free_entrance="unknown",
            accessible_restroom="unknown",
            access_instructions="",
            uncertainty_notes=(
                "Call connected briefly but the accessibility questions were not asked "
                "or answered; no step-free entrance, accessible restroom, or "
                "access-instruction information was verified."
            ),
        )
        result = client.normalize_call_task(task, input_data=_input())
        self.assertEqual(result.completion_status, "partial")
        self.assertEqual(result.step_free_entrance, "unknown")
        self.assertEqual(result.accessible_restroom, "unknown")

    def test_genuine_unknown_after_question_flow_remains_complete(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        result = client.normalize_call_task(
            _completed_call_task(
                step_free_entrance="unknown",
                accessible_restroom="unknown",
                access_instructions="",
                uncertainty_notes="Staff answered all three questions but could not confirm details.",
            ),
            input_data=_input(),
        )
        self.assertEqual(result.completion_status, "complete")

    def test_task_completed_false_yields_partial(self) -> None:
        client = CallERestClient(api_key="iams_live_test_key")
        task = _completed_call_task(
            uncertainty_notes="Call ended before verification finished.",
        )
        task["task_completed"] = False
        result = client.normalize_call_task(task, input_data=_input())
        self.assertEqual(result.completion_status, "partial")

    def test_incomplete_verification_does_not_mark_first_valid_result(self) -> None:
        transport = FakeTransport(
            [
                (
                    201,
                    _completed_call_task(
                        step_free_entrance="unknown",
                        accessible_restroom="unknown",
                        access_instructions="",
                        uncertainty_notes=(
                            "Call connected briefly but the accessibility questions were not asked "
                            "or answered."
                        ),
                    ),
                ),
            ]
        )
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        ledger = CallLedger()
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(provider=CallERestProvider(client=client)),
            ledger=ledger,
        )
        artifacts = workflow.run_live(_input(with_live_intent=True))
        self.assertEqual(artifacts.result.completion_status, "partial")
        self.assertEqual(ledger.live_call_count, 1)
        self.assertIsNone(ledger.first_valid_result_call)

    def test_complete_verification_marks_first_valid_result(self) -> None:
        transport = FakeTransport([(201, _completed_call_task())])
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        ledger = CallLedger()
        workflow = AccessLineWorkflow(
            adapter=CallEAdapter(provider=CallERestProvider(client=client)),
            ledger=ledger,
        )
        workflow.run_live(_input(with_live_intent=True))
        self.assertEqual(ledger.first_valid_result_call, 1)

    def test_fictional_complete_fixture_remains_valid(self) -> None:
        fixture_path = (
            Path(__file__).resolve().parents[1]
            / "examples/fictional_complete_structured_result.json"
        )
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(payload.get("fixture_kind"), "FICTIONAL_TEST_DATA")
        self.assertTrue(payload.get("synthetic"))
        self.assertFalse(payload.get("live_call"))
        result = validate_result(
            {k: v for k, v in payload.items() if k in {
                "venue_name","called_at","step_free_entrance","accessible_restroom",
                "access_instructions","uncertainty_notes","source_type","completion_status"
            }}
        )
        self.assertEqual(result.completion_status, "complete")
        self.assertEqual(
            derive_accessline_completion_status(
                provider_status="completed",
                structured={
                    "step_free_entrance": result.step_free_entrance,
                    "accessible_restroom": result.accessible_restroom,
                    "access_instructions": result.access_instructions,
                    "uncertainty_notes": result.uncertainty_notes,
                },
                uncertainty_notes=result.uncertainty_notes,
                call_task={"status": "completed", "task_completed": True},
            ),
            "complete",
        )

    def test_extract_safe_provider_diagnostics_omits_secrets(self) -> None:
        task = _completed_call_task()
        diagnostics = extract_safe_provider_diagnostics(task)
        serialized = json.dumps(diagnostics)
        self.assertIn("provider_status", diagnostics)
        self.assertNotIn("+15555550199", serialized)
        self.assertNotIn("transcript", serialized.lower())

    def test_rest_provider_attaches_provider_diagnostics(self) -> None:
        transport = FakeTransport([(201, _completed_call_task())])
        client = CallERestClient(
            api_key="iams_live_test_key",
            transport=transport,
            sleeper=_noop_sleep,
        )
        provider = CallERestProvider(client=client)
        response = provider.place_call(
            CallEAdapter(provider=provider).build_request(_input(), mode="live")
        )
        self.assertIsNotNone(response.provider_diagnostics)
        self.assertEqual(response.provider_diagnostics["provider_status"], "completed")


class CallETlsTransportTests(unittest.TestCase):
    def test_urllib_transport_uses_verified_ssl_context(self) -> None:
        transport = UrllibCallERestTransport()
        self.assertIsInstance(transport.ssl_context, ssl.SSLContext)
        self.assertEqual(transport.ssl_context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(transport.ssl_context.check_hostname)

    def test_verified_ssl_context_created_from_certifi_where(self) -> None:
        with patch("certifi.where", return_value="/tmp/accessline-test-ca.pem") as mock_where:
            with patch("ssl.create_default_context") as mock_create:
                mock_create.return_value = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                build_verified_ssl_context()
                mock_where.assert_called_once()
                mock_create.assert_called_once_with(cafile="/tmp/accessline-test-ca.pem")

    def test_ssl_verification_is_not_disabled(self) -> None:
        transport = UrllibCallERestTransport()
        self.assertNotEqual(transport.ssl_context.verify_mode, ssl.CERT_NONE)
        self.assertTrue(transport.ssl_context.check_hostname)

    def test_transport_construction_makes_no_network_request(self) -> None:
        FakeTransport.calls = []
        UrllibCallERestTransport()
        CallERestClient()
        CallERestProvider()
        self.assertEqual(len(FakeTransport.calls), 0)

    def test_missing_certifi_fails_closed(self) -> None:
        saved = sys.modules.get("certifi")
        sys.modules["certifi"] = None
        try:
            with self.assertRaises(CallEUnavailable):
                build_verified_ssl_context()
        finally:
            if saved is None:
                sys.modules.pop("certifi", None)
            else:
                sys.modules["certifi"] = saved

    @patch("urllib.request.urlopen")
    def test_urlopen_receives_verified_ssl_context(self, mock_urlopen) -> None:
        transport = UrllibCallERestTransport()
        mock_urlopen.return_value.__enter__.return_value.status = 404
        mock_urlopen.return_value.__enter__.return_value.read.return_value = b""
        transport.request(
            method="GET",
            url="https://api.heycall-e.com/v1/calls/call_test",
            headers={},
            body=None,
        )
        _args, kwargs = mock_urlopen.call_args
        self.assertIs(kwargs["context"], transport.ssl_context)


if __name__ == "__main__":
    unittest.main()
