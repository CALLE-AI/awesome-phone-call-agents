"""Contract tests for the offline CALL-E response boundary."""

import unittest
from copy import deepcopy
from datetime import datetime, timezone

from shift_safety_call_agent.adapters.calle_offline import (
    CalleSdkNotConnectedError,
    InvalidProviderResponseError,
    InvalidStructuredResultError,
    OfflineCalleAdapter,
    RealCallDisabledError,
    UnknownProviderStatusError,
    convert_calle_response,
    parse_calle_response,
)
from shift_safety_call_agent.domain.enums import IncidentLevel
from shift_safety_call_agent.domain.models import SafetyInterview
from tests.fixtures.calle_responses import (
    EMPTY_EVIDENCE_RESPONSE,
    EQUIPMENT_ISSUE_RESPONSE,
    EXTRA_FIELDS_RESPONSE,
    INVALID_STRUCTURED_RESPONSE,
    MINOR_NEAR_MISS_RESPONSE,
    NO_INCIDENT_RESPONSE,
    NULL_STRUCTURED_RESPONSE,
    TASK_INCOMPLETE_RESPONSE,
    UNKNOWN_STATUS_RESPONSE,
)


class CalleResponseTests(unittest.TestCase):
    """Verify exact mappings and conservative incomplete-result behavior."""

    def test_normal_responses_map_only_confirmed_values(self) -> None:
        cases = (
            (NO_INCIDENT_RESPONSE, IncidentLevel.NONE, False, False, False),
            (MINOR_NEAR_MISS_RESPONSE, IncidentLevel.MINOR, True, False, True),
            (EQUIPMENT_ISSUE_RESPONSE, IncidentLevel.MODERATE, False, True, True),
        )
        for payload, level, near_miss, equipment, follow_up in cases:
            with self.subTest(level=level):
                result = convert_calle_response(payload)
                self.assertIs(result.incident_level, level)
                self.assertIs(result.near_miss_occurred, near_miss)
                self.assertIs(result.equipment_issue_occurred, equipment)
                self.assertIs(result.requires_follow_up, follow_up)
                self.assertIsNone(result.confidence)

    def test_null_incomplete_and_evidence_free_results_remain_unknown(self) -> None:
        for payload in (NULL_STRUCTURED_RESPONSE, TASK_INCOMPLETE_RESPONSE, EMPTY_EVIDENCE_RESPONSE):
            with self.subTest(payload=payload):
                result = convert_calle_response(payload)
                self.assertIs(result.incident_level, IncidentLevel.UNKNOWN)
                self.assertIsNone(result.near_miss_occurred)
                self.assertIsNone(result.equipment_issue_occurred)
                self.assertIsNone(result.injury_or_health_issue)
                self.assertIsNone(result.requires_follow_up)
                self.assertIsNone(result.confidence)

    def test_unknown_status_is_not_rounded_to_a_known_status(self) -> None:
        with self.assertRaisesRegex(UnknownProviderStatusError, "unknown status"):
            convert_calle_response(UNKNOWN_STATUS_RESPONSE)

    def test_invalid_structured_result_type_is_rejected(self) -> None:
        with self.assertRaisesRegex(InvalidStructuredResultError, "object or null"):
            convert_calle_response(INVALID_STRUCTURED_RESPONSE)

    def test_unknown_provider_fields_are_ignored(self) -> None:
        result = convert_calle_response(EXTRA_FIELDS_RESPONSE)
        self.assertIs(result.incident_level, IncidentLevel.MINOR)

    def test_confirmed_completion_confidence_shape_is_retained_but_not_interpreted(self) -> None:
        payload = deepcopy(NO_INCIDENT_RESPONSE)
        snapshot = parse_calle_response(payload)
        self.assertIsNotNone(snapshot.completion_confidence)
        assert snapshot.completion_confidence is not None
        self.assertEqual(snapshot.completion_confidence.score, 0.92)
        self.assertEqual(snapshot.completion_confidence.label, "high")
        result = convert_calle_response(payload)
        self.assertIsNone(result.confidence)

    def test_invalid_completion_confidence_is_rejected_safely(self) -> None:
        payload = deepcopy(NO_INCIDENT_RESPONSE)
        payload["completion_confidence"] = {"score": "private-marker", "label": "high"}
        with self.assertRaises(InvalidProviderResponseError) as context:
            convert_calle_response(payload)
        self.assertNotIn("private-marker", str(context.exception))

    def test_structured_result_extra_field_is_rejected(self) -> None:
        payload = deepcopy(NO_INCIDENT_RESPONSE)
        structured = payload["structured_result"]
        assert isinstance(structured, dict)
        structured["future_field"] = "not-accepted-by-strict-schema"
        with self.assertRaises(InvalidStructuredResultError):
            convert_calle_response(payload)

    def test_invalid_required_field_type_is_rejected_without_raw_values(self) -> None:
        payload = deepcopy(NO_INCIDENT_RESPONSE)
        payload["task_completed"] = "private-marker"
        payload["credential"] = "secret-marker"
        with self.assertRaises(InvalidProviderResponseError) as context:
            convert_calle_response(payload)
        rendered = str(context.exception)
        self.assertNotIn("private-marker", rendered)
        self.assertNotIn("secret-marker", rendered)

    def test_offline_adapter_has_hard_real_call_and_sdk_barriers(self) -> None:
        adapter = OfflineCalleAdapter(
            id_generator=lambda: "plan-fixed",
            clock=lambda: datetime(2026, 8, 4, tzinfo=timezone.utc),
        )
        interview = SafetyInterview(
            interview_id="interview-fixed",
            created_at=datetime(2026, 8, 4, tzinfo=timezone.utc),
            scenario_name="no-incident",
            recipient_alias="demo-worker",
        )
        plan = adapter.create_plan(interview)
        with self.assertRaises(RealCallDisabledError):
            adapter.start_call(plan)
        with self.assertRaises(CalleSdkNotConnectedError):
            adapter.get_status("offline-run")
        with self.assertRaises(CalleSdkNotConnectedError):
            adapter.get_result("offline-run")
        with self.assertRaises(CalleSdkNotConnectedError):
            adapter.cancel_call("offline-run")


if __name__ == "__main__":
    unittest.main()
