#!/usr/bin/env python3
"""Tests for check_evidence_schema.py.

    python3 scripts/test_check_evidence_schema.py

Standard library only. No network, no credentials, no calls.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_evidence_schema import check, parse_money, said_no  # noqa: E402


def errors(result: object) -> list[str]:
    return check(result)[0]


def notes(result: object) -> list[str]:
    return check(result)[1]


GOOD = {
    "reached": "yes",
    "verdict": "confirmed",
    "facts": ["Booked onto Thursday's van run."],
    "blockers": [],
    "referrals": [],
    "offer": {
        "what_is_offered": "500 insulated shipping boxes",
        "price": "438.00",
        "currency": "USD",
        "eta": "2026-09-10",
        "reference": "BWD-48291",
    },
}


class Money(unittest.TestCase):
    def test_reads_the_shapes_a_caller_produces(self):
        self.assertEqual(
            [parse_money(v) for v in (438, "438", "$438.00", "USD 1,438", " 612 ")],
            [438.0, 438.0, 438.0, 1438.0, 612.0],
        )

    def test_unreadable_is_none_never_zero(self):
        for value in ("about four hundred", "", None, True, {}, []):
            self.assertIsNone(parse_money(value), value)


class Required(unittest.TestCase):
    def test_a_complete_result_is_clean(self):
        self.assertEqual(check(GOOD), ([], []))

    def test_only_verdict_is_required(self):
        """CALL-E returns null for the whole result when it cannot satisfy the
        schema, so every extra required field is another way to lose the call."""
        found = errors({})
        self.assertEqual(found, ["Missing required field 'verdict'."])
        self.assertEqual(errors({"verdict": "partial"}), [])

    def test_an_unknown_verdict_is_an_error(self):
        self.assertTrue(any("verdict" in m for m in errors({**GOOD, "verdict": "maybe"})))

    def test_facts_must_be_strings(self):
        self.assertTrue(any("facts" in m for m in errors({**GOOD, "facts": "not a list"})))

    def test_a_non_object_result_is_rejected(self):
        self.assertTrue(errors(["not", "an", "object"]))


class Referrals(unittest.TestCase):
    def test_a_non_e164_number_is_flagged_as_dropped(self):
        found = notes({**GOOD, "referrals": [{"org_name": "Depot", "phone": "555-0100"}]})
        self.assertTrue(any("never be called" in m for m in found))
        self.assertNotIn("555-0100", str(found))

    def test_unicode_digits_are_not_e164(self):
        found = notes({**GOOD, "referrals": [{"org_name": "Depot", "phone": "+1555010000٣"}]})
        self.assertTrue(any("not E.164" in m for m in found))

    def test_a_referral_with_no_number_is_flagged(self):
        found = notes({**GOOD, "referrals": [{"org_name": "Head office"}]})
        self.assertTrue(any("will be dropped" in m for m in found))

    def test_a_referral_with_no_name_is_an_error(self):
        self.assertTrue(errors({**GOOD, "referrals": [{"phone": "+15550100002"}]}))

    def test_a_good_referral_is_silent(self):
        self.assertEqual(
            notes({**GOOD, "referrals": [{"org_name": "Depot", "phone": "+15550100003"}]}), []
        )


class Offers(unittest.TestCase):
    def test_an_unreadable_price_warns_that_budget_cannot_block(self):
        offer = {**GOOD["offer"], "price": "about four hundred"}
        self.assertTrue(
            any("cannot block" in m for m in notes({**GOOD, "offer": offer}))
        )

    def test_an_absent_price_warns_that_budget_reads_unknown(self):
        offer = {k: v for k, v in GOOD["offer"].items() if k != "price"}
        self.assertTrue(any("unknown" in m for m in notes({**GOOD, "offer": offer})))

    def test_a_non_iso_date_warns_the_deadline_cannot_compare(self):
        offer = {**GOOD["offer"], "eta": "next Thursday"}
        self.assertTrue(any("YYYY-MM-DD" in m for m in notes({**GOOD, "offer": offer})))

    def test_a_confirmation_without_a_reference_is_flagged(self):
        offer = {**GOOD["offer"], "reference": ""}
        self.assertTrue(any("reference" in m for m in notes({**GOOD, "offer": offer})))

    def test_an_empty_offer_reads_as_no_offer(self):
        self.assertTrue(
            any("no offer" in m for m in notes({**GOOD, "verdict": "offer", "offer": {}}))
        )

    def test_an_offer_verdict_with_no_offer_is_flagged(self):
        self.assertTrue(
            any("no offer to evaluate" in m
                for m in notes({**GOOD, "verdict": "offer", "offer": None}))
        )


class ReachedIsAnEnum(unittest.TestCase):
    """CALL-E prefers a string enum with `unknown` over a boolean, because a
    call often cannot settle the question."""

    def test_the_three_values_are_accepted(self):
        for value in ("yes", "no", "unknown"):
            self.assertEqual(errors({**GOOD, "reached": value}), [], value)

    def test_a_boolean_is_still_accepted(self):
        self.assertEqual(errors({**GOOD, "reached": False}), [])

    def test_anything_else_is_an_error(self):
        self.assertTrue(errors({**GOOD, "reached": "maybe"}))

    def test_unknown_is_not_a_no(self):
        self.assertFalse(said_no("unknown"))
        self.assertTrue(said_no("no"))
        self.assertTrue(said_no(False))


class Consistency(unittest.TestCase):
    def test_not_reached_with_a_rich_verdict_is_flagged(self):
        found = notes({**GOOD, "reached": "no"})
        self.assertTrue(any("nothing was established" in m for m in found))

    def test_unknown_fields_are_reported_as_ignored(self):
        self.assertTrue(any("Unknown field" in m for m in notes({**GOOD, "surprise": 1})))


if __name__ == "__main__":
    unittest.main()
