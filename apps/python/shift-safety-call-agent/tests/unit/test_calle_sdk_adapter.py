"""Offline contract tests for the injected CALL-E SDK adapter."""

from __future__ import annotations

import hashlib
import inspect
import re
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from shift_safety_call_agent.adapters.calle_offline import (
    InvalidProviderResponseError,
    InvalidStructuredResultError,
    UnknownProviderStatusError,
)
from shift_safety_call_agent.adapters.calle_sdk_adapter import (
    CONTRACT_TEST_RECIPIENT,
    CalleCallsResource,
    CalleSdkAdapter,
    ContractTestExecutionPermit,
    ProviderAuthenticationError,
    ProviderRateLimitError,
    ProviderServerError,
    ProviderTimeoutError,
    ProviderTransportError,
    ProviderUnknownError,
    ProviderValidationError,
    RealCallExecutionDisabledError,
    build_calle_sdk_request,
    normalize_calle_sdk_response,
)
from shift_safety_call_agent.application.calle_planning import create_calle_preview_plan
from shift_safety_call_agent.domain.enums import IncidentLevel
from tests.fixtures.calle_responses import (
    EMPTY_EVIDENCE_RESPONSE,
    EQUIPMENT_ISSUE_RESPONSE,
    INVALID_STRUCTURED_RESPONSE,
    MINOR_NEAR_MISS_RESPONSE,
    NO_INCIDENT_RESPONSE,
    NULL_STRUCTURED_RESPONSE,
    TASK_INCOMPLETE_RESPONSE,
    UNKNOWN_STATUS_RESPONSE,
)
from tests.fixtures.calle_sdk_contract import (
    CalleAPIError,
    CalleAuthenticationError,
    CalleConnectionError,
    CalleRateLimitError,
    CalleTimeoutError,
    RecordingCalleCalls,
    contract_exception_cases,
    contract_response_cases,
    make_contract_test_permit,
    network_blocked,
)

FIXED_TIME = datetime(2026, 8, 4, 9, 0, tzinfo=timezone.utc)


def make_plan():
    return create_calle_preview_plan(
        "no-incident",
        id_generator=lambda: "plan-contract",
        clock=lambda: FIXED_TIME,
    )


def make_adapter(calls: RecordingCalleCalls) -> CalleSdkAdapter:
    return CalleSdkAdapter(calls, idempotency_key_generator=lambda plan: "idem-contract")


class CalleSdkAdapterBoundaryTests(unittest.TestCase):
    """Verify injection, request construction, and hard execution barriers."""

    def test_protocol_exposes_only_the_explicit_audited_subset(self) -> None:
        signature = inspect.signature(CalleCallsResource.create_and_wait)
        self.assertEqual(
            tuple(signature.parameters),
            (
                "self",
                "task",
                "recipient",
                "result_schema",
                "metadata",
                "idempotency_key",
                "interval_seconds",
                "timeout_seconds",
            ),
        )
        for parameter in tuple(signature.parameters.values())[1:]:
            self.assertIs(parameter.kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIn("dict", str(signature.return_annotation))

    def test_permit_cannot_be_constructed_normally_or_replaced_by_boolean(self) -> None:
        with self.assertRaises(TypeError):
            ContractTestExecutionPermit()
        calls = RecordingCalleCalls(NO_INCIDENT_RESPONSE)
        with self.assertRaises(RealCallExecutionDisabledError):
            make_adapter(calls).execute(make_plan(), permit=True)  # type: ignore[arg-type]
        self.assertEqual(calls.call_count, 0)

    def test_missing_permit_rejects_before_calls_resource(self) -> None:
        calls = RecordingCalleCalls(NO_INCIDENT_RESPONSE)
        with self.assertRaises(RealCallExecutionDisabledError):
            make_adapter(calls).execute(make_plan())
        self.assertEqual(calls.call_count, 0)

    def test_unmarked_resource_is_rejected_even_with_test_permit(self) -> None:
        calls = RecordingCalleCalls(NO_INCIDENT_RESPONSE)
        calls.contract_test_only = False
        with self.assertRaises(RealCallExecutionDisabledError):
            make_adapter(calls).execute(make_plan(), permit=make_contract_test_permit())
        self.assertEqual(calls.call_count, 0)

    def test_request_builder_uses_only_confirmed_non_routable_fields(self) -> None:
        plan = make_plan()
        request = build_calle_sdk_request(
            plan,
            idempotency_key_generator=lambda value: "idem-injected",
        )
        self.assertEqual(request.recipient, {"phones": [CONTRACT_TEST_RECIPIENT], "region": "JP"})
        self.assertEqual(request.metadata, {"mode": "contract-test", "region": "JP"})
        self.assertEqual(request.idempotency_key, "idem-injected")
        self.assertEqual(request.interval_seconds, 2.0)
        self.assertEqual(request.timeout_seconds, 600.0)
        self.assertNotIn("locale", request.recipient)
        self.assertNotRegex(repr(request.recipient), r"(?<!\d)\+[1-9]\d{7,14}(?!\d)")

    def test_calls_double_is_invoked_once_without_retaining_task_text(self) -> None:
        plan = make_plan()
        calls = RecordingCalleCalls(NO_INCIDENT_RESPONSE)
        with network_blocked():
            result = make_adapter(calls).execute(plan, permit=make_contract_test_permit())
        self.assertIs(result.incident_level, IncidentLevel.NONE)
        self.assertEqual(calls.call_count, 1)
        assert calls.last_call is not None
        self.assertIs(calls.last_call.task_present, True)
        self.assertEqual(calls.last_call.task_digest, hashlib.sha256(plan.task.encode()).hexdigest())
        self.assertEqual(calls.last_call.recipient["region"], "JP")
        self.assertEqual(calls.last_call.result_schema, dict(build_calle_sdk_request(
            plan, idempotency_key_generator=lambda value: "unused"
        ).result_schema))
        self.assertEqual(calls.last_call.metadata, {"mode": "contract-test", "region": "JP"})
        self.assertEqual(calls.last_call.idempotency_key, "idem-contract")
        self.assertFalse(hasattr(calls.last_call, "task"))

    def test_sdk_adapter_is_not_wired_to_cli_application_or_domain(self) -> None:
        source_roots = (Path("src/shift_safety_call_agent/domain"), Path("src/shift_safety_call_agent/application"))
        for root in source_roots:
            for path in root.glob("*.py"):
                source = path.read_text(encoding="utf-8")
                self.assertNotRegex(source, r"(?m)^\s*(from\s+calle|import\s+calle\b)")
                self.assertNotIn("CalleClient", source)
        cli_source = Path("src/shift_safety_call_agent/cli.py").read_text(encoding="utf-8")
        self.assertNotIn("CalleSdkAdapter", cli_source)
        self.assertNotIn("ContractTestExecutionPermit", cli_source)


class CalleSdkResponseTests(unittest.TestCase):
    """Verify conservative reuse of the Phase 1C-1 snapshot and mapper."""

    def test_three_complete_scenarios_map_through_existing_domain_result(self) -> None:
        cases = (
            (NO_INCIDENT_RESPONSE, IncidentLevel.NONE),
            (MINOR_NEAR_MISS_RESPONSE, IncidentLevel.MINOR),
            (EQUIPMENT_ISSUE_RESPONSE, IncidentLevel.MODERATE),
        )
        for response, expected in cases:
            with self.subTest(expected=expected), network_blocked():
                result = make_adapter(RecordingCalleCalls(response)).execute(
                    make_plan(), permit=make_contract_test_permit()
                )
            self.assertIs(result.incident_level, expected)
            self.assertIsNone(result.confidence)

    def test_double_provides_every_required_response_shape(self) -> None:
        self.assertEqual(
            set(contract_response_cases()),
            {
                "completed-no-incident",
                "completed-near-miss",
                "equipment-follow-up",
                "null-structured-result",
                "task-incomplete",
                "no-confidence",
                "valid-confidence",
                "no-evidence",
                "unknown-status",
                "invalid-structured-result",
            },
        )

    def test_null_incomplete_and_missing_evidence_remain_unknown(self) -> None:
        missing_evidence = deepcopy(NO_INCIDENT_RESPONSE)
        missing_evidence.pop("evidence")
        for response in (NULL_STRUCTURED_RESPONSE, TASK_INCOMPLETE_RESPONSE, EMPTY_EVIDENCE_RESPONSE, missing_evidence):
            with self.subTest(response=response), network_blocked():
                result = make_adapter(RecordingCalleCalls(response)).execute(
                    make_plan(), permit=make_contract_test_permit()
                )
            self.assertIs(result.incident_level, IncidentLevel.UNKNOWN)
            self.assertIsNone(result.requires_follow_up)

    def test_confidence_is_typed_but_not_used_for_domain_safety(self) -> None:
        snapshot = normalize_calle_sdk_response(NO_INCIDENT_RESPONSE)
        assert snapshot.completion_confidence is not None
        self.assertEqual(snapshot.completion_confidence.score, 0.92)
        self.assertEqual(snapshot.completion_confidence.label, "high")
        result = make_adapter(RecordingCalleCalls(NO_INCIDENT_RESPONSE)).execute(
            make_plan(), permit=make_contract_test_permit()
        )
        self.assertIsNone(result.confidence)

    def test_absent_confidence_remains_none(self) -> None:
        response = deepcopy(NO_INCIDENT_RESPONSE)
        response.pop("completion_confidence")
        snapshot = normalize_calle_sdk_response(response)
        self.assertIsNone(snapshot.completion_confidence)

    def test_invalid_confidence_structured_result_and_status_are_rejected(self) -> None:
        invalid_confidence = deepcopy(NO_INCIDENT_RESPONSE)
        invalid_confidence["completion_confidence"] = {"score": "invalid", "label": "high"}
        with self.assertRaises(InvalidProviderResponseError):
            normalize_calle_sdk_response(invalid_confidence)
        with self.assertRaises(InvalidStructuredResultError):
            normalize_calle_sdk_response(INVALID_STRUCTURED_RESPONSE)
        with self.assertRaises(UnknownProviderStatusError):
            make_adapter(RecordingCalleCalls(UNKNOWN_STATUS_RESPONSE)).execute(
                make_plan(), permit=make_contract_test_permit()
            )

    def test_sdk_model_and_recipient_fields_are_selected_without_transcript(self) -> None:
        response = deepcopy(NO_INCIDENT_RESPONSE)
        response.update(
            {
                "id": "call-contract",
                "summary": "fictional summary",
                "recipients": [
                    {
                        "id": "recipient-contract",
                        "status": "completed",
                        "structured_result": None,
                        "summary": "fictional recipient summary",
                        "transcript": "private-marker",
                    }
                ],
                "transcript": "private-marker",
                "future_field": "ignored",
            }
        )

        class SdkModelDouble:
            def __init__(self) -> None:
                for key, value in response.items():
                    setattr(self, key, value)

            def to_dict(self):
                raise AssertionError("full SDK model must not be serialized")

        snapshot = normalize_calle_sdk_response(SdkModelDouble())
        self.assertEqual(snapshot.provider_id, "call-contract")
        self.assertEqual(snapshot.summary, "fictional summary")
        assert snapshot.recipient_result is not None
        self.assertEqual(snapshot.recipient_result.provider_id, "recipient-contract")
        self.assertFalse(hasattr(snapshot, "transcript"))
        self.assertFalse(hasattr(snapshot.recipient_result, "transcript"))


class CalleSdkExceptionTests(unittest.TestCase):
    """Verify raw SDK errors never escape the adapter."""

    def test_sdk_exception_categories_are_translated(self) -> None:
        expected_types = {
            "authentication": ProviderAuthenticationError,
            "validation": ProviderValidationError,
            "rate-limit": ProviderRateLimitError,
            "timeout": ProviderTimeoutError,
            "transport": ProviderTransportError,
            "server": ProviderServerError,
            "unknown": ProviderUnknownError,
        }
        for name, raw_error in contract_exception_cases().items():
            expected = expected_types[name]
            with self.subTest(expected=expected), self.assertRaises(expected) as context:
                make_adapter(RecordingCalleCalls(error=raw_error)).execute(
                    make_plan(), permit=make_contract_test_permit()
                )
            self.assertIsNone(context.exception.__cause__)

    def test_exception_mapping_never_reads_or_copies_raw_text_or_details(self) -> None:
        class SensitiveFailure(Exception):
            details = {"private": "private-marker"}

            def __str__(self) -> str:
                raise AssertionError("raw exception rendered")

        with self.assertRaises(ProviderUnknownError) as context:
            make_adapter(RecordingCalleCalls(error=SensitiveFailure())).execute(
                make_plan(), permit=make_contract_test_permit()
            )
        rendered = str(context.exception)
        self.assertNotIn("private-marker", rendered)
        self.assertNotRegex(rendered, re.compile(r"(?i)transcript|response body|request body"))


if __name__ == "__main__":
    unittest.main()
