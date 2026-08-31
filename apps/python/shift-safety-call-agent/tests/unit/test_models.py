"""Unit tests for domain enums and models."""

import unittest
from datetime import datetime, timezone

from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import SafetyInterview, SafetyInterviewResult


class ModelTests(unittest.TestCase):
    """Verify model creation and validation."""

    def test_enum_values_are_stable(self) -> None:
        self.assertEqual(
            [level.value for level in IncidentLevel],
            ["none", "minor", "moderate", "critical", "unknown"],
        )
        self.assertEqual(
            [status.value for status in InterviewStatus],
            ["draft", "planned", "awaiting_confirmation", "calling", "completed", "failed", "cancelled"],
        )

    def test_invalid_confidence_is_rejected(self) -> None:
        for confidence in (-0.01, 1.01, float("nan"), float("inf")):
            with self.subTest(confidence=confidence), self.assertRaisesRegex(ValueError, "confidence"):
                SafetyInterviewResult(
                    work_summary=None,
                    incident_level=IncidentLevel.UNKNOWN,
                    near_miss_occurred=None,
                    equipment_issue_occurred=None,
                    injury_or_health_issue=None,
                    handover_notes=None,
                    requires_follow_up=None,
                    confidence=confidence,
                    evidence=(),
                    summary="Unknown.",
                )

    def test_unknown_values_remain_unknown(self) -> None:
        result = SafetyInterviewResult(
            work_summary=None,
            incident_level=IncidentLevel.UNKNOWN,
            near_miss_occurred=None,
            equipment_issue_occurred=None,
            injury_or_health_issue=None,
            handover_notes=None,
            requires_follow_up=None,
            confidence=None,
            evidence=(),
            summary="Insufficient information.",
        )
        self.assertIs(result.incident_level, IncidentLevel.UNKNOWN)
        self.assertIsNone(result.near_miss_occurred)
        self.assertIsNone(result.requires_follow_up)
        self.assertIsNone(result.confidence)

    def test_interview_requires_timezone_aware_timestamps(self) -> None:
        with self.assertRaisesRegex(ValueError, "timezone"):
            SafetyInterview(
                interview_id="test-interview",
                created_at=datetime(2026, 8, 2),
                scenario_name="no-incident",
                recipient_alias="fictional-worker",
            )
        interview = SafetyInterview(
            interview_id="test-interview",
            created_at=datetime(2026, 8, 2, tzinfo=timezone.utc),
            scenario_name="no-incident",
            recipient_alias="fictional-worker",
        )
        self.assertIs(interview.status, InterviewStatus.DRAFT)


if __name__ == "__main__":
    unittest.main()
