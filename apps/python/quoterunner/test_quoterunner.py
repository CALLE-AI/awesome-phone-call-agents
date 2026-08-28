"""Regression tests for QuoteRunner.

These guard the ways a call list can go wrong: calling a closed business,
calling one whose hours nobody published, reformatting an ambiguous number into
a different country, exceeding the per-run cap, and leaking a full phone number
into any output path.

No network, no telephone, no credentials.
"""

from __future__ import annotations

import json
import unittest
from datetime import datetime
from pathlib import Path

from quoterunner import (
    MAX_CANDIDATES_PER_RUN,
    Candidate,
    PlanError,
    build_plan,
    is_open,
    load_fixture,
    mask,
    render,
    screen,
    validate_e164,
    window_text,
)

FIXTURE = Path(__file__).with_name("example-candidates.json")

# Wednesday 2026-08-12, 10:00 local. Fixed so the suite is deterministic.
WED_10 = datetime(2026, 8, 12, 10, 0)
WED_14 = datetime(2026, 8, 12, 14, 0)
WED_23 = datetime(2026, 8, 12, 23, 0)
SAT_11 = datetime(2026, 8, 15, 11, 0)
SUN_11 = datetime(2026, 8, 16, 11, 0)


def hours(spec: str, phone: str = "+15550100") -> Candidate:
    return Candidate(name="Test Garage", phone=phone, opening_hours=spec)


class OpeningHours(unittest.TestCase):
    def test_inside_a_weekday_range(self):
        self.assertTrue(is_open("Mo-Fr 09:00-19:00", WED_10))

    def test_outside_a_weekday_range(self):
        self.assertFalse(is_open("Mo-Fr 09:00-19:00", WED_23))

    def test_saturday_is_not_inside_mo_fr(self):
        self.assertFalse(is_open("Mo-Fr 09:00-19:00", SAT_11))

    def test_saturday_has_its_own_span(self):
        self.assertTrue(is_open("Mo-Fr 09:00-19:00; Sa 10:00-14:00", SAT_11))

    def test_a_day_not_listed_is_closed(self):
        self.assertFalse(is_open("Mo-Fr 09:00-19:00; Sa 10:00-14:00", SUN_11))

    def test_split_hours_open_in_the_morning_span(self):
        self.assertTrue(is_open("Mo-Fr 09:00-13:00,15:00-19:00", WED_10))

    def test_split_hours_closed_during_the_gap(self):
        self.assertFalse(is_open("Mo-Fr 09:00-13:00,15:00-19:00", WED_14))

    def test_always_open(self):
        self.assertTrue(is_open("24/7", WED_23))

    def test_empty_hours_read_as_closed(self):
        self.assertFalse(is_open("", WED_10))

    def test_unparseable_hours_read_as_closed_not_open(self):
        # An optimistic parse here calls a real person at an hour nobody agreed to.
        self.assertFalse(is_open("whenever we feel like it", WED_10))

    def test_off_marker_is_respected(self):
        self.assertFalse(is_open("Mo-Fr off", WED_10))

    def test_window_text_reports_the_spans(self):
        self.assertEqual(window_text("Mo-Fr 09:00-13:00,15:00-19:00", WED_10),
                         "09:00-13:00, 15:00-19:00")

    def test_window_text_says_closed_when_there_is_none(self):
        self.assertEqual(window_text("Mo-Fr 09:00-17:00", SAT_11), "closed today")


class PhoneNumbers(unittest.TestCase):
    def test_accepts_e164(self):
        self.assertEqual(validate_e164("+15550100"), "+15550100")

    def test_strips_formatting_but_keeps_the_number(self):
        self.assertEqual(validate_e164("+1 (555) 010-0"), "+15550100")

    def test_rejects_a_local_number_instead_of_guessing_a_country(self):
        with self.assertRaises(PlanError):
            validate_e164("555 0106")

    def test_rejects_an_empty_number(self):
        with self.assertRaises(PlanError):
            validate_e164("")

    def test_mask_keeps_only_the_ends(self):
        self.assertEqual(mask("+15550100"), "+15****00")

    def test_mask_handles_a_short_string_without_leaking_it(self):
        self.assertNotIn("5550", mask("5550"))

    def test_mask_of_nothing_is_stable(self):
        self.assertEqual(mask(""), "(none)")


class Screening(unittest.TestCase):
    def test_open_business_is_callable(self):
        callable_now, excluded = screen([hours("Mo-Fr 09:00-19:00")], WED_10)
        self.assertEqual(len(callable_now), 1)
        self.assertEqual(excluded, [])

    def test_closed_business_is_excluded_with_a_reason(self):
        callable_now, excluded = screen([hours("Mo-Fr 09:00-19:00")], WED_23)
        self.assertEqual(callable_now, [])
        self.assertIn("closed now", excluded[0].reason)

    def test_missing_hours_is_excluded_rather_than_assumed_open(self):
        callable_now, excluded = screen([hours("")], WED_10)
        self.assertEqual(callable_now, [])
        self.assertIn("do not call blind", excluded[0].reason)

    def test_bad_number_is_excluded_not_reformatted(self):
        callable_now, excluded = screen(
            [hours("Mo-Fr 09:00-19:00", phone="555 0106")], WED_10
        )
        self.assertEqual(callable_now, [])
        self.assertIn("E.164", excluded[0].reason)

    def test_cap_applies_and_the_overflow_says_why(self):
        many = [
            Candidate(name=f"Garage {i}", phone=f"+1555010{i:02d}",
                      opening_hours="Mo-Fr 09:00-19:00")
            for i in range(MAX_CANDIDATES_PER_RUN + 4)
        ]
        callable_now, excluded = screen(many, WED_10)
        self.assertEqual(len(callable_now), MAX_CANDIDATES_PER_RUN)
        self.assertEqual(len(excluded), 4)
        self.assertIn("cap", excluded[0].reason)

    def test_every_candidate_appears_in_exactly_one_bucket(self):
        candidates = load_fixture(FIXTURE)
        callable_now, excluded = screen(candidates, WED_10)
        self.assertEqual(len(callable_now) + len(excluded), len(candidates))


class Plan(unittest.TestCase):
    def test_plan_marks_that_no_call_was_placed(self):
        plan = build_plan(load_fixture(FIXTURE), "Replace a windscreen", "Sam", WED_10)
        self.assertTrue(plan["no_call_placed"])

    def test_plan_refuses_when_nobody_is_reachable(self):
        with self.assertRaises(PlanError):
            build_plan([hours("")], "Replace a windscreen", "Sam", WED_10)

    def test_script_names_the_requester_and_the_job(self):
        plan = build_plan(load_fixture(FIXTURE), "Replace a windscreen", "Sam", WED_10)
        script = plan["calls"][0]["script"]
        self.assertIn("Sam", script)
        self.assertIn("Replace a windscreen", script)

    def test_script_tells_the_agent_to_admit_being_an_ai(self):
        plan = build_plan(load_fixture(FIXTURE), "Replace a windscreen", "Sam", WED_10)
        self.assertIn("say yes, plainly", plan["calls"][0]["script"])

    def test_excluded_candidates_are_reported_not_silently_dropped(self):
        plan = build_plan(load_fixture(FIXTURE), "Replace a windscreen", "Sam", WED_10)
        self.assertTrue(plan["excluded"])
        for item in plan["excluded"]:
            self.assertTrue(item["reason"])


class NoNumberLeaks(unittest.TestCase):
    """The one test that matters most: a full number must not reach any output."""

    def _full_numbers(self) -> list[str]:
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
        return [
            c["phone"].replace(" ", "")
            for c in payload["candidates"]
            if c["phone"].startswith("+")
        ]

    def test_no_full_number_in_the_rendered_report(self):
        plan = build_plan(load_fixture(FIXTURE), "Replace a windscreen", "Sam", WED_10)
        text = render(plan)
        for number in self._full_numbers():
            self.assertNotIn(number, text)

    def test_no_full_number_in_the_json_plan(self):
        plan = build_plan(load_fixture(FIXTURE), "Replace a windscreen", "Sam", WED_10)
        text = json.dumps(plan)
        for number in self._full_numbers():
            self.assertNotIn(number, text)

    def test_no_full_number_in_an_error_message(self):
        try:
            validate_e164("+1555010999999999999")
        except PlanError as error:
            self.assertNotIn("555010999999999999", str(error))
        else:
            self.fail("expected PlanError")


if __name__ == "__main__":
    unittest.main(verbosity=2)
