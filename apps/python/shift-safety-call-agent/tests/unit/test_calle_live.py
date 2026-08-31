"""Network-blocked tests for the guarded CALL-E runtime boundary."""

from __future__ import annotations

import unittest
from copy import deepcopy
from importlib.metadata import PackageNotFoundError
from unittest.mock import Mock

from shift_safety_call_agent.adapters.calle_live import (
    CALLE_API_KEY_ENV,
    EXACT_EXECUTION_PERMIT,
    EXACT_HUMAN_CONFIRMATION,
    CalleClientConstructionError,
    CalleRuntimeResources,
    CalleRuntimeConfigurationError,
    GuardedCalleLiveBoundary,
    LiveCallConfiguration,
    LiveCallExecutionPermitError,
    LiveCallGateError,
    LiveCallResultError,
    ProductionCalleClientFactory,
    build_live_call_preflight,
    build_redacted_runtime_evidence,
    execute_one_live_call,
    is_valid_e164_format,
    is_valid_japanese_self_call_recipient,
    require_live_call_gates,
)
from shift_safety_call_agent.adapters.calle_sdk_adapter import (
    CalleSdkAdapter,
    RealCallExecutionDisabledError,
)
from shift_safety_call_agent.application.calle_planning import create_calle_preview_plan
from shift_safety_call_agent.adapters.calle_sdk_adapter import ProviderTimeoutError
from tests.fixtures.calle_sdk_contract import network_blocked
from tests.fixtures.calle_responses import NO_INCIDENT_RESPONSE


def _synthetic_e164() -> str:
    """Return synthetic +81 shape only, without claiming allocation or ownership."""

    return "+81" + ("9" * 10)


class ProductionCalleClientFactoryTests(unittest.TestCase):
    def test_missing_key_fails_without_import_or_network(self) -> None:
        loader = Mock(side_effect=AssertionError("SDK import attempted"))
        factory = ProductionCalleClientFactory(environment={}, module_loader=loader)
        with network_blocked(), self.assertRaisesRegex(
            CalleRuntimeConfigurationError, "CALLE_API_KEY is not set"
        ):
            factory.create()
        loader.assert_not_called()

    def test_constructor_failure_redacts_runtime_key(self) -> None:
        runtime_key = "-".join(("synthetic", "runtime", "credential"))

        class FailingClient:
            def __init__(self, *, api_key: str) -> None:
                raise RuntimeError(f"rejected {api_key}")

        module = type("SyntheticCalleModule", (), {"CalleClient": FailingClient})
        factory = ProductionCalleClientFactory(
            environment={CALLE_API_KEY_ENV: runtime_key},
            version_reader=lambda _: "0.6.0",
            module_loader=lambda _: module,  # type: ignore[arg-type]
        )
        with network_blocked(), self.assertRaises(CalleClientConstructionError) as raised:
            factory.create()
        self.assertNotIn(runtime_key, str(raised.exception))
        self.assertNotIn(runtime_key, repr(factory))

    def test_real_pinned_client_constructs_and_injects_without_network(self) -> None:
        try:
            __import__("calle")
        except ImportError:
            self.skipTest("optional calle-ai SDK is not installed")

        runtime_key = "-".join(("synthetic", "runtime", "credential"))
        factory = ProductionCalleClientFactory(
            environment={CALLE_API_KEY_ENV: runtime_key}
        )
        with network_blocked():
            resources = factory.create()
            try:
                adapter = CalleSdkAdapter(
                    resources.calls_resource,  # type: ignore[arg-type]
                    idempotency_key_generator=lambda _: "not-executed",
                )
                plan = create_calle_preview_plan("no-incident")
                with self.assertRaises(RealCallExecutionDisabledError):
                    adapter.execute(plan)
            finally:
                resources.close()
        self.assertNotIn(runtime_key, repr(resources))

    def test_sdk_readiness_uses_pinned_inspection_only(self) -> None:
        factory = ProductionCalleClientFactory(
            environment={},
            version_reader=Mock(side_effect=PackageNotFoundError("calle-ai")),
        )
        with network_blocked():
            self.assertFalse(factory.sdk_is_ready())


class LiveCallGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.valid = LiveCallConfiguration(
            provider="calle",
            live_call_enabled=True,
            recipient=_synthetic_e164(),
            human_confirmation=EXACT_HUMAN_CONFIRMATION,
        )

    def test_e164_validator_checks_format_without_country_inference(self) -> None:
        self.assertTrue(is_valid_e164_format(_synthetic_e164()))
        non_japanese = "+" + ("9" * 11)
        trunk_zero = "+810" + ("9" * 9)
        self.assertTrue(is_valid_e164_format(non_japanese))
        self.assertTrue(is_valid_e164_format(trunk_zero))
        self.assertTrue(is_valid_japanese_self_call_recipient(_synthetic_e164()))
        self.assertFalse(is_valid_japanese_self_call_recipient(non_japanese))
        self.assertFalse(is_valid_japanese_self_call_recipient(trunk_zero))
        for invalid in (None, "", "not-a-recipient", "81-00-00", "+012345678"):
            with self.subTest(invalid=invalid):
                self.assertFalse(is_valid_e164_format(invalid))
                self.assertFalse(is_valid_japanese_self_call_recipient(invalid))

    def test_each_missing_gate_blocks_before_factory_construction(self) -> None:
        cases = (
            LiveCallConfiguration("fake", True, _synthetic_e164(), EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", False, _synthetic_e164(), EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", True, None, EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", True, "not-a-recipient", EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", True, _synthetic_e164(), "not confirmed"),
        )
        for configuration in cases:
            factory = Mock()
            boundary = GuardedCalleLiveBoundary(configuration, factory)
            with self.subTest(configuration=configuration), network_blocked(), self.assertRaises(
                LiveCallGateError
            ):
                boundary.construct_runtime_resources()
            factory.create.assert_not_called()

    def test_only_one_recipient_shape_is_accepted(self) -> None:
        invalid_values = (
            "+" + ("9" * 11),
            "+810" + ("9" * 9),
            _synthetic_e164() + "," + _synthetic_e164(),
            _synthetic_e164() + " " + _synthetic_e164(),
            " " + _synthetic_e164(),
            _synthetic_e164() + "\n",
            "+81" + ("9" * 3),
            "+81" + ("9" * 14),
            "+81" + ("\uff19" * 10),
        )
        for index, value in enumerate(invalid_values):
            factory = Mock()
            configuration = LiveCallConfiguration(
                "calle", True, value, EXACT_HUMAN_CONFIRMATION
            )
            boundary = GuardedCalleLiveBoundary(configuration, factory)
            with self.subTest(case=index), network_blocked():
                self.assertFalse(is_valid_japanese_self_call_recipient(value))
                with self.assertRaises(LiveCallGateError) as raised:
                    boundary.construct_runtime_resources()
                self.assertNotIn(value, str(raised.exception))
                with self.assertRaises(LiveCallGateError) as raised:
                    boundary.execute_call(
                        create_calle_preview_plan("no-incident"),
                        execution_permit=EXACT_EXECUTION_PERMIT,
                    )
                self.assertNotIn(value, str(raised.exception))
                factory.create.assert_not_called()
        self.assertEqual(GuardedCalleLiveBoundary.maximum_recipients, 1)
        self.assertFalse(GuardedCalleLiveBoundary.scheduled_calls_supported)
        self.assertEqual(GuardedCalleLiveBoundary.automatic_call_retries, 0)

    def test_valid_gates_construct_resources(self) -> None:
        resources = Mock()
        factory = Mock()
        factory.create.return_value = resources
        boundary = GuardedCalleLiveBoundary(self.valid, factory)
        with network_blocked():
            self.assertIs(boundary.construct_runtime_resources(), resources)
        factory.create.assert_called_once_with()
        self.assertNotIn(_synthetic_e164(), repr(boundary))
        self.assertNotIn(_synthetic_e164(), repr(self.valid))


class _RecordingLiveCalls:
    def __init__(self, response: object, *, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.call_count = 0
        self.kwargs: dict[str, object] | None = None

    def create_and_wait(self, **kwargs: object) -> object:
        self.call_count += 1
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return deepcopy(self.response)


class _SyntheticClient:
    def __init__(self, calls: _RecordingLiveCalls) -> None:
        self.calls = calls
        self.close_count = 0

    def close(self) -> None:
        self.close_count += 1


def _terminal_response() -> dict[str, object]:
    response = deepcopy(NO_INCIDENT_RESPONSE)
    response["id"] = "call_synthetic_1"
    response["summary"] = "The fictional self-check was completed."
    return response


class LiveCallExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.configuration = LiveCallConfiguration(
            provider="calle",
            live_call_enabled=True,
            recipient=_synthetic_e164(),
            human_confirmation=EXACT_HUMAN_CONFIRMATION,
        )
        self.plan = create_calle_preview_plan("no-incident")

    def _boundary(
        self,
        calls: _RecordingLiveCalls,
    ) -> tuple[GuardedCalleLiveBoundary, Mock, _SyntheticClient]:
        client = _SyntheticClient(calls)
        resources = CalleRuntimeResources(client=client, calls_resource=calls)
        factory = Mock()
        factory.create.return_value = resources
        return GuardedCalleLiveBoundary(self.configuration, factory), factory, client

    def test_empty_and_mismatched_execution_permits_make_zero_calls(self) -> None:
        for permit in (None, "", "PLACE TWO CALLS", " PLACE ONE CALL NOW"):
            calls = _RecordingLiveCalls(_terminal_response())
            boundary, factory, _ = self._boundary(calls)
            with self.subTest(permit=permit), network_blocked(), self.assertRaises(
                LiveCallExecutionPermitError
            ):
                boundary.execute_call(self.plan, execution_permit=permit)
            self.assertEqual(calls.call_count, 0)
            factory.create.assert_not_called()

    def test_each_closed_existing_gate_makes_zero_calls(self) -> None:
        cases = (
            LiveCallConfiguration("fake", True, _synthetic_e164(), EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", False, _synthetic_e164(), EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", True, None, EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", True, "invalid", EXACT_HUMAN_CONFIRMATION),
            LiveCallConfiguration("calle", True, _synthetic_e164(), "no"),
        )
        for configuration in cases:
            calls = _RecordingLiveCalls(_terminal_response())
            client = _SyntheticClient(calls)
            factory = Mock()
            factory.create.return_value = CalleRuntimeResources(client, calls)
            boundary = GuardedCalleLiveBoundary(configuration, factory)
            with self.subTest(configuration=configuration), network_blocked(), self.assertRaises(
                LiveCallGateError
            ):
                boundary.execute_call(
                    self.plan,
                    execution_permit=EXACT_EXECUTION_PERMIT,
                )
            self.assertEqual(calls.call_count, 0)
            factory.create.assert_not_called()

    def test_missing_api_key_makes_zero_calls(self) -> None:
        with network_blocked(), self.assertRaises(CalleRuntimeConfigurationError):
            execute_one_live_call(
                self.plan,
                EXACT_EXECUTION_PERMIT,
                {
                    "CALL_PROVIDER": "calle",
                    "ALLOW_REAL_CALLS": "true",
                    "CALLE_RECIPIENT_E164": _synthetic_e164(),
                    "CALLE_HUMAN_CONFIRMATION": EXACT_HUMAN_CONFIRMATION,
                },
                factory=ProductionCalleClientFactory(environment={}),
            )

    def test_valid_gates_invoke_confirmed_create_and_wait_contract_once(self) -> None:
        calls = _RecordingLiveCalls(_terminal_response())
        boundary, factory, client = self._boundary(calls)
        with network_blocked():
            outcome = boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        self.assertEqual(calls.call_count, 1)
        factory.create.assert_called_once_with()
        self.assertEqual(client.close_count, 1)
        assert calls.kwargs is not None
        self.assertEqual(
            calls.kwargs["recipient"],
            {"phones": [_synthetic_e164()], "region": "JP"},
        )
        self.assertEqual(calls.kwargs["task"], self.plan.task)
        self.assertEqual(calls.kwargs["idempotency_key"], self.plan.plan_id)
        self.assertEqual(calls.kwargs["interval_seconds"], 2.0)
        self.assertEqual(calls.kwargs["timeout_seconds"], 600.0)
        self.assertEqual(
            calls.kwargs["metadata"],
            {
                "task_version": "en-safety-v2",
                "result_schema_version": "safety-result-v1",
            },
        )
        self.assertNotIn("locale", repr(calls.kwargs["recipient"]))
        self.assertNotIn("recipients", calls.kwargs)
        self.assertNotIn("webhook_url", calls.kwargs)
        self.assertIsNotNone(outcome.normalized_result)
        self.assertEqual(outcome.snapshot.provider_id, "call_synthetic_1")

    def test_redacted_runtime_evidence_contains_only_safe_fixed_facts(self) -> None:
        calls = _RecordingLiveCalls(_terminal_response())
        boundary, _, _ = self._boundary(calls)
        with network_blocked():
            outcome = boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        evidence = build_redacted_runtime_evidence(outcome)
        self.assertEqual(evidence["review_disposition"], "no_immediate_action")
        self.assertEqual(evidence["task_version"], "en-safety-v2")
        self.assertEqual(evidence["result_schema_version"], "safety-result-v1")
        self.assertFalse(evidence["transcript_persisted"])
        self.assertFalse(evidence["phone_persisted"])
        rendered = repr(evidence).lower()
        for forbidden in ("provider_id", "call_synthetic", "recipient", "raw evidence"):
            self.assertNotIn(forbidden, rendered)

    def test_incomplete_live_task_is_not_assessed_in_redacted_evidence(self) -> None:
        response = _terminal_response()
        response["task_completed"] = False
        calls = _RecordingLiveCalls(response)
        boundary, _, _ = self._boundary(calls)
        with network_blocked():
            outcome = boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        evidence = build_redacted_runtime_evidence(outcome)
        self.assertEqual(evidence["review_disposition"], "not_assessed")
        self.assertTrue(evidence["structured_result_present"])

    def test_exception_is_redacted_and_never_retried(self) -> None:
        class CalleTimeoutError(Exception):
            pass

        calls = _RecordingLiveCalls(
            _terminal_response(),
            error=CalleTimeoutError("sensitive provider detail"),
        )
        boundary, _, client = self._boundary(calls)
        with network_blocked(), self.assertRaises(ProviderTimeoutError) as raised:
            boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        self.assertEqual(calls.call_count, 1)
        self.assertEqual(client.close_count, 1)
        self.assertNotIn("sensitive provider detail", str(raised.exception))

    def test_raw_transcript_is_not_selected_or_retained(self) -> None:
        response = _terminal_response()
        response["transcript"] = "forbidden raw transcript"
        calls = _RecordingLiveCalls(response)
        boundary, _, _ = self._boundary(calls)
        with network_blocked():
            outcome = boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        self.assertNotIn("transcript", repr(outcome).lower())
        self.assertNotIn("forbidden", repr(outcome))

    def test_incomplete_structured_result_is_not_normalized_or_retried(self) -> None:
        response = _terminal_response()
        response["structured_result"] = None
        calls = _RecordingLiveCalls(response)
        boundary, _, _ = self._boundary(calls)
        with network_blocked():
            outcome = boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        self.assertEqual(calls.call_count, 1)
        self.assertIsNone(outcome.normalized_result)

    def test_response_conversion_failure_is_redacted_and_not_retried(self) -> None:
        class FailingModel:
            def to_dict(self) -> object:
                raise RuntimeError("sensitive response detail")

        response = _terminal_response()
        response["structured_result"] = FailingModel()
        calls = _RecordingLiveCalls(response)
        boundary, _, _ = self._boundary(calls)
        with network_blocked(), self.assertRaises(LiveCallResultError) as raised:
            boundary.execute_call(
                self.plan,
                execution_permit=EXACT_EXECUTION_PERMIT,
            )
        self.assertEqual(calls.call_count, 1)
        self.assertNotIn("sensitive response detail", str(raised.exception))


class LivePreflightTests(unittest.TestCase):
    def test_preflight_reports_only_states_and_never_constructs_client(self) -> None:
        factory = Mock()
        factory.api_key_is_set.return_value = True
        factory.sdk_is_ready.return_value = True
        environment = {
            "CALL_PROVIDER": "calle",
            "ALLOW_REAL_CALLS": "true",
            "CALLE_RECIPIENT_E164": _synthetic_e164(),
            "CALLE_HUMAN_CONFIRMATION": EXACT_HUMAN_CONFIRMATION,
        }
        with network_blocked():
            result = build_live_call_preflight(environment, factory=factory)
        self.assertEqual(result.provider, "live")
        self.assertTrue(result.api_key_set)
        self.assertTrue(result.recipient_set)
        self.assertTrue(result.recipient_format_valid)
        self.assertTrue(result.live_call_enabled)
        self.assertTrue(result.human_confirmation_matches)
        self.assertTrue(result.client_factory_ready)
        self.assertFalse(result.real_call_will_be_placed)
        factory.create.assert_not_called()
        for recipient in ("+" + ("9" * 11), "+810" + ("9" * 9)):
            environment["CALLE_RECIPIENT_E164"] = recipient
            with network_blocked():
                result = build_live_call_preflight(environment, factory=factory)
            self.assertFalse(result.recipient_format_valid)
            self.assertNotIn(recipient, repr(result))
            factory.create.assert_not_called()

    def test_default_preflight_remains_fake_and_disabled(self) -> None:
        factory = Mock()
        factory.api_key_is_set.return_value = False
        factory.sdk_is_ready.return_value = True
        with network_blocked():
            result = build_live_call_preflight({}, factory=factory)
        self.assertEqual(result.provider, "fake")
        self.assertFalse(result.api_key_set)
        self.assertFalse(result.recipient_set)
        self.assertFalse(result.live_call_enabled)
        self.assertFalse(result.human_confirmation_matches)
        self.assertFalse(result.client_factory_ready)
        factory.sdk_is_ready.assert_not_called()
        factory.create.assert_not_called()
        untrusted_provider = "+" + ("9" * 11)
        unsupported = build_live_call_preflight(
            {"CALL_PROVIDER": untrusted_provider}, factory=factory
        )
        self.assertEqual(unsupported.provider, "unsupported")
        self.assertNotIn(untrusted_provider, repr(unsupported))


if __name__ == "__main__":
    unittest.main()
