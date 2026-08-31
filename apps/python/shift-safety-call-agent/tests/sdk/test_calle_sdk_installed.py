"""Static smoke tests that run only where the audited optional SDK is installed."""

import importlib
import inspect
from pathlib import Path
import socket
import unittest
from importlib.metadata import PackageNotFoundError, metadata, version
from unittest.mock import patch


try:
    INSTALLED_VERSION = version("calle-ai")
except PackageNotFoundError:
    INSTALLED_VERSION = None


@unittest.skipUnless(INSTALLED_VERSION is not None, "optional calle-ai SDK is not installed")
class InstalledCalleSdkTests(unittest.TestCase):
    """Verify the 0.6.0 contract without constructing CalleClient."""

    def test_distribution_and_import_contract_without_network(self) -> None:
        self.assertEqual(INSTALLED_VERSION, "0.6.0")
        self.assertEqual(metadata("calle-ai")["Requires-Python"], ">=3.11")
        with (
            patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")),
            patch.object(socket, "create_connection", side_effect=AssertionError("network attempted")),
        ):
            calle = importlib.import_module("calle")
        self.assertTrue(isinstance(getattr(calle, "CalleClient", None), type))

    def test_client_and_calls_signatures_are_static_and_exact(self) -> None:
        with (
            patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")),
            patch.object(socket, "create_connection", side_effect=AssertionError("network attempted")),
        ):
            from calle import CalleClient
            from calle.calls import CalleCalls

        client_parameters = inspect.signature(CalleClient).parameters
        self.assertEqual(
            tuple(client_parameters),
            ("api_key", "base_url", "timeout", "http_client"),
        )
        self.assertEqual(client_parameters["base_url"].default, "https://api.heycall-e.com")
        self.assertEqual(client_parameters["timeout"].default, 30.0)
        create_parameters = inspect.signature(CalleCalls.create).parameters
        self.assertEqual(
            tuple(create_parameters),
            (
                "self",
                "task",
                "recipient",
                "recipients",
                "result_schema",
                "recipient_result_schema",
                "metadata",
                "webhook_url",
                "idempotency_key",
            ),
        )
        wait_signature = inspect.signature(CalleCalls.create_and_wait)
        self.assertEqual(tuple(wait_signature.parameters), ("self", "kwargs"))
        self.assertEqual(wait_signature.parameters["kwargs"].kind, inspect.Parameter.VAR_KEYWORD)
        self.assertIn("dict", str(wait_signature.return_annotation))
        self.assertTrue(callable(CalleClient.close))
        self.assertTrue(callable(CalleClient.__enter__))
        self.assertTrue(callable(CalleClient.__exit__))

    def test_resources_confidence_model_and_exceptions_exist(self) -> None:
        with (
            patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")),
            patch.object(socket, "create_connection", side_effect=AssertionError("network attempted")),
        ):
            import calle
            from calle.calls import CalleCalls
            from calle.generated.models.completion_confidence import CompletionConfidence
            from calle.goals import CalleGoals
            from calle.webhooks import CalleWebhooks

        self.assertEqual(set(CompletionConfidence.__annotations__), {"score", "label"})
        self.assertIn(CompletionConfidence.__annotations__["score"], (float, "float"))
        self.assertIn(CompletionConfidence.__annotations__["label"], (str, "str"))
        self.assertTrue(all(isinstance(resource, type) for resource in (CalleCalls, CalleGoals, CalleWebhooks)))
        for exception_name in (
            "CalleAPIError",
            "CalleAuthenticationError",
            "CalleConnectionError",
            "CalleRateLimitError",
            "CalleTimeoutError",
            "CalleWebhookSignatureError",
        ):
            self.assertTrue(isinstance(getattr(calle, exception_name, None), type))

    def test_protocol_arguments_match_create_and_wait_forwarding_contract(self) -> None:
        with (
            patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")),
            patch.object(socket, "create_connection", side_effect=AssertionError("network attempted")),
        ):
            from calle.calls import CalleCalls

        from shift_safety_call_agent.adapters.calle_sdk_adapter import CalleCallsResource

        protocol_arguments = set(inspect.signature(CalleCallsResource.create_and_wait).parameters) - {"self"}
        create_arguments = set(inspect.signature(CalleCalls.create).parameters) - {"self"}
        wait_arguments = {"interval_seconds", "timeout_seconds"}
        self.assertEqual(
            protocol_arguments,
            {
                "task",
                "recipient",
                "result_schema",
                "metadata",
                "idempotency_key",
                "interval_seconds",
                "timeout_seconds",
            },
        )
        self.assertTrue(protocol_arguments.issubset(create_arguments | wait_arguments))
        self.assertIn(
            "dict",
            str(inspect.signature(CalleCallsResource.create_and_wait).return_annotation),
        )

    def test_static_telemetry_search_has_no_matches(self) -> None:
        calle = importlib.import_module("calle")
        package_root = Path(calle.__file__).parent
        terms = ("telemetry", "analytics", "metrics", "tracing", "opentelemetry", "sentry")
        matches = []
        for path in package_root.rglob("*.py"):
            lowered = path.read_text(encoding="utf-8").lower()
            if any(term in lowered for term in terms):
                matches.append(path)
        self.assertEqual(matches, [])

    def test_real_sdk_exception_classes_map_without_exposing_raw_details(self) -> None:
        with (
            patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")),
            patch.object(socket, "create_connection", side_effect=AssertionError("network attempted")),
        ):
            from calle import (
                CalleAPIError,
                CalleAuthenticationError,
                CalleConnectionError,
                CalleRateLimitError,
                CalleTimeoutError,
            )

        from shift_safety_call_agent.adapters.calle_sdk_adapter import (
            ProviderAuthenticationError,
            ProviderRateLimitError,
            ProviderServerError,
            ProviderTimeoutError,
            ProviderTransportError,
            ProviderValidationError,
            map_calle_sdk_exception,
        )

        cases = (
            (
                CalleAuthenticationError(code="unauthorized", message="private-marker", status_code=401),
                ProviderAuthenticationError,
            ),
            (
                CalleAPIError(code="invalid_request", message="private-marker", status_code=422),
                ProviderValidationError,
            ),
            (
                CalleRateLimitError(code="rate_limit_exceeded", message="private-marker", status_code=429),
                ProviderRateLimitError,
            ),
            (CalleTimeoutError("private-marker"), ProviderTimeoutError),
            (CalleConnectionError("private-marker"), ProviderTransportError),
            (
                CalleAPIError(code="internal_error", message="private-marker", status_code=503),
                ProviderServerError,
            ),
        )
        for raw_error, expected_type in cases:
            with self.subTest(expected_type=expected_type):
                mapped = map_calle_sdk_exception(raw_error)
                self.assertIsInstance(mapped, expected_type)
                self.assertNotIn("private-marker", str(mapped))


if __name__ == "__main__":
    unittest.main()
