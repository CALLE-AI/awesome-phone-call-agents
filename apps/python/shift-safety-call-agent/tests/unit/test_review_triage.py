"""Deterministic review-triage tests with no network or provider inference."""

import unittest
from datetime import datetime, timezone

from shift_safety_call_agent.adapters.fake_call_provider import FakeCallProvider
from shift_safety_call_agent.application.review_triage import (
    build_review_basis,
    build_suggested_human_actions,
    derive_interview_review_disposition,
    derive_review_disposition,
)
from shift_safety_call_agent.domain.enums import InterviewStatus, ReviewDisposition
from shift_safety_call_agent.domain.models import SafetyInterview


FIXED_TIME = datetime(2026, 8, 25, tzinfo=timezone.utc)


class ReviewTriageTests(unittest.TestCase):
    def _fake_interview(self, scenario: str) -> SafetyInterview:
        provider = FakeCallProvider(
            id_generator=iter(("plan-id", "run-id")).__next__,
            clock=lambda: FIXED_TIME,
        )
        interview = SafetyInterview(
            interview_id=f"interview-{scenario}",
            created_at=FIXED_TIME,
            scenario_name=scenario,
            recipient_alias="demo-worker",
            status=InterviewStatus.COMPLETED,
        )
        plan = provider.create_plan(interview)
        run_id = provider.start_call(plan)
        interview.result = provider.get_result(run_id)
        return interview

    def test_four_fake_scenarios_have_expected_review_dispositions(self) -> None:
        expected = {
            "no-incident": ReviewDisposition.NO_IMMEDIATE_ACTION,
            "minor-near-miss": ReviewDisposition.ACTION_REQUIRED,
            "equipment-follow-up": ReviewDisposition.ACTION_REQUIRED,
            "incomplete-answers": ReviewDisposition.NEEDS_CLARIFICATION,
        }
        for scenario, disposition in expected.items():
            with self.subTest(scenario=scenario):
                self.assertIs(
                    derive_interview_review_disposition(
                        self._fake_interview(scenario)
                    ),
                    disposition,
                )

    def test_incomplete_failure_and_consent_decline_are_not_safely_defaulted(self) -> None:
        complete_result = self._fake_interview("no-incident").result
        self.assertIs(
            derive_review_disposition(
                task_completed=False,
                result=complete_result,
            ),
            ReviewDisposition.NOT_ASSESSED,
        )
        for status in (InterviewStatus.FAILED, InterviewStatus.CANCELLED):
            interview = SafetyInterview(
                interview_id=f"interview-{status.value}",
                created_at=FIXED_TIME,
                scenario_name="generic-incomplete",
                recipient_alias="demo-worker",
                status=status,
            )
            self.assertIs(
                derive_interview_review_disposition(interview),
                ReviewDisposition.NOT_ASSESSED,
            )

    def test_review_basis_and_actions_use_structured_fields_only(self) -> None:
        equipment = self._fake_interview("equipment-follow-up")
        disposition = derive_interview_review_disposition(equipment)
        self.assertIn("Equipment issue reported: Yes.", build_review_basis(disposition, equipment.result))
        self.assertEqual(
            build_suggested_human_actions(disposition, equipment.result),
            (
                "Human review required.",
                "Keep the fictional tool out of service.",
                "Arrange human inspection before reuse.",
            ),
        )
        near_miss = self._fake_interview("minor-near-miss")
        self.assertEqual(
            build_suggested_human_actions(
                derive_interview_review_disposition(near_miss), near_miss.result
            ),
            ("Human review required.",),
        )
        incomplete = self._fake_interview("incomplete-answers")
        self.assertEqual(
            build_suggested_human_actions(
                derive_interview_review_disposition(incomplete), incomplete.result
            ),
            (
                "Contact the worker for the missing required answers.",
                "Do not treat this record as safety clearance.",
                "Complete human review after clarification.",
            ),
        )
        no_incident = self._fake_interview("no-incident")
        for disposition, result in (
            (derive_interview_review_disposition(no_incident), no_incident.result),
            (ReviewDisposition.NOT_ASSESSED, None),
            (ReviewDisposition.NOT_ASSESSED, no_incident.result),
        ):
            with self.subTest(disposition=disposition, result_present=result is not None):
                self.assertEqual(build_suggested_human_actions(disposition, result), ())


if __name__ == "__main__":
    unittest.main()
