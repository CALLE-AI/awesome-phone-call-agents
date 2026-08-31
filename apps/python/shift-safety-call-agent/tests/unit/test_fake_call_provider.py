"""Unit tests for the offline fake provider."""

import unittest
from datetime import datetime, timezone

from shift_safety_call_agent.adapters.fake_call_provider import FakeCallProvider
from shift_safety_call_agent.domain.enums import IncidentLevel, InterviewStatus
from shift_safety_call_agent.domain.models import SafetyInterview


def _interview(scenario: str) -> SafetyInterview:
    return SafetyInterview(
        interview_id=f"interview-{scenario}",
        created_at=datetime(2026, 8, 2, tzinfo=timezone.utc),
        scenario_name=scenario,
        recipient_alias="fictional-worker",
    )


class FakeCallProviderTests(unittest.TestCase):
    """Verify every fake scenario and provider operation."""

    def test_all_four_scenarios_return_expected_facts(self) -> None:
        cases = (
            ("no-incident", IncidentLevel.NONE, False, False, False),
            ("minor-near-miss", IncidentLevel.MINOR, True, False, True),
            ("equipment-follow-up", IncidentLevel.MODERATE, False, True, True),
            ("incomplete-answers", IncidentLevel.UNKNOWN, None, None, None),
        )
        for scenario, level, near_miss, equipment_issue, follow_up in cases:
            with self.subTest(scenario=scenario):
                identifiers = iter(("plan-id", "run-id"))
                provider = FakeCallProvider(lambda: next(identifiers))
                plan = provider.create_plan(_interview(scenario))
                run_id = provider.start_call(plan)
                result = provider.get_result(run_id)
                self.assertIs(provider.get_status(run_id), InterviewStatus.COMPLETED)
                self.assertIsNotNone(result)
                assert result is not None
                self.assertIs(result.incident_level, level)
                self.assertIs(result.near_miss_occurred, near_miss)
                self.assertIs(result.equipment_issue_occurred, equipment_issue)
                self.assertIs(result.requires_follow_up, follow_up)

    def test_unknown_scenario_is_rejected_without_echoing_input(self) -> None:
        provider = FakeCallProvider()
        with self.assertRaisesRegex(ValueError, "Unknown fake scenario") as context:
            provider.create_plan(_interview("private-input"))
        self.assertNotIn("private-input", str(context.exception))

    def test_fake_call_can_be_cancelled(self) -> None:
        identifiers = iter(("plan-id", "run-id"))
        provider = FakeCallProvider(lambda: next(identifiers))
        plan = provider.create_plan(_interview("no-incident"))
        run_id = provider.start_call(plan)
        provider.cancel_call(run_id)
        self.assertIs(provider.get_status(run_id), InterviewStatus.CANCELLED)
        self.assertIsNone(provider.get_result(run_id))


if __name__ == "__main__":
    unittest.main()
