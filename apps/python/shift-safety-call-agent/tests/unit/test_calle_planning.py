"""Tests for provider-neutral CALL-E plan and schema construction."""

import re
import unittest
from datetime import datetime, timezone

from shift_safety_call_agent.application.calle_planning import (
    ENGLISH_SAFETY_TASK_VERSION,
    SAFETY_RESULT_SCHEMA_VERSION,
    build_english_safety_task,
    build_safety_result_schema,
    create_calle_preview_plan,
)

FIXED_TIME = datetime(2026, 8, 4, 9, 0, tzinfo=timezone.utc)


class CallePlanningTests(unittest.TestCase):
    """Verify that every plan is fictional, explicit, and injectable."""

    def test_call_plan_uses_safe_fixed_region_and_language(self) -> None:
        plan = create_calle_preview_plan(
            "no-incident",
            id_generator=lambda: "plan-fixed",
            clock=lambda: FIXED_TIME,
        )
        self.assertEqual(plan.plan_id, "plan-fixed")
        self.assertEqual(plan.created_at, FIXED_TIME)
        self.assertEqual(plan.region, "JP")
        self.assertEqual(plan.language, "English")
        self.assertIs(plan.requires_human_confirmation, True)
        self.assertIs(plan.contains_real_phone_number, False)
        self.assertFalse(hasattr(plan, "phone"))
        self.assertFalse(hasattr(plan, "phone_number"))

    def test_task_and_schema_versions_are_fixed_for_live_evidence(self) -> None:
        self.assertEqual(ENGLISH_SAFETY_TASK_VERSION, "en-safety-v2")
        self.assertEqual(SAFETY_RESULT_SCHEMA_VERSION, "safety-result-v1")

    def test_english_task_contains_every_required_safety_instruction(self) -> None:
        task = build_english_safety_task()
        required_phrases = (
            "AI phone call",
            "fictional safety-check demo",
            "agrees to continue",
            "If consent is refused, end the call immediately",
            "six checks one at a time",
            "never multiple checks at once",
            "Wait for the person's answer",
            "overview of today's fictional work",
            "safety concern",
            "near miss",
            "equipment or tool abnormality",
            "injury or anyone felt unwell",
            "handover notes for the next shift",
            "additional follow-up",
            "interrupts a question",
            "do not infer a definite answer",
            "briefly rephrase the question",
            "confirm the answer before continuing",
            "It's fine",
            "I'm okay",
            "No thanks",
            "Do not interpret ambiguous short replies",
            "Do you mean there is no problem",
            "you want to end the call",
            "end early only for explicit termination intent",
            "Please hang up",
            "I will not answer any more",
            "Do not end merely",
            "After all six checks",
            "the check is complete",
            "additional handover notes before ending",
            "Do not infer unknown information",
            "unknown, not as No",
            "Do not ask about real companies, equipment, coworkers, incidents, or personal information",
            "emergency calls",
            "medical judgments",
            "legal judgments",
        )
        for phrase in required_phrases:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, task)
        for item_number in range(1, 7):
            with self.subTest(item_number=item_number):
                self.assertEqual(task.count(f"{item_number}. "), 1)
        self.assertIsNone(re.search(r"(?<!\d)\+?[1-9]\d{7,14}(?!\d)", task))
        self.assertTrue(task.isascii())

    def test_result_schema_has_required_fields_and_safe_enums(self) -> None:
        schema = build_safety_result_schema()
        required = set(schema["required"])
        self.assertEqual(
            required,
            {
                "work_summary",
                "incident_level",
                "near_miss_status",
                "equipment_issue_status",
                "injury_or_health_status",
                "handover_notes",
                "requires_follow_up_status",
                "evidence",
                "summary",
            },
        )
        properties = schema["properties"]
        assert isinstance(properties, dict)
        self.assertEqual(
            properties["incident_level"]["enum"],
            ["none", "minor", "moderate", "critical", "unknown"],
        )
        for field_name in (
            "near_miss_status",
            "equipment_issue_status",
            "injury_or_health_status",
            "requires_follow_up_status",
        ):
            self.assertEqual(properties[field_name]["enum"], ["yes", "no", "unknown"])
        self.assertIs(schema["additionalProperties"], False)
        self.assertNotIn("$ref", repr(schema))

    def test_unknown_preview_scenario_is_rejected_without_echoing_input(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown CALL-E preview scenario") as context:
            create_calle_preview_plan("private-scenario")
        self.assertNotIn("private-scenario", str(context.exception))


if __name__ == "__main__":
    unittest.main()
