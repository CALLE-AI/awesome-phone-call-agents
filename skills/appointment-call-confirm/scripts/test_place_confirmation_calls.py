"""
Unit tests for the dependency-free helper functions in
place_confirmation_calls.py: phone masking, region inference, and
terminal-result resolution.

These exercise pure logic only — no network calls, no CALL-E API key
required. Run with:

    python -m unittest scripts/test_place_confirmation_calls.py -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from place_confirmation_calls import _mask, _infer_region, resolve_result


class TestMask(unittest.TestCase):
    def test_masks_middle_digits(self):
        self.assertEqual(_mask("+14155550101"), "+1415•••••01")

    def test_short_number_fully_masked(self):
        self.assertEqual(_mask("123"), "•••")

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(_mask("  +14155550101  "), "+1415•••••01")


class TestInferRegion(unittest.TestCase):
    def test_infers_us(self):
        self.assertEqual(_infer_region("+14155550101"), "US")

    def test_infers_singapore(self):
        self.assertEqual(_infer_region("+6591234567"), "SG")

    def test_infers_india(self):
        self.assertEqual(_infer_region("+919812345670"), "IN")

    def test_prefers_longer_country_code_match(self):
        # +971 (UAE) must not be misread as +9 or +97 matching something else.
        self.assertEqual(_infer_region("+971501234567"), "AE")

    def test_unknown_code_returns_none(self):
        self.assertIsNone(_infer_region("+9999999999"))


class TestResolveResult(unittest.TestCase):
    def test_timed_out_call_is_pending(self):
        status, structured = resolve_result({"_timed_out": True, "status": "in_progress"})
        self.assertEqual(status, "pending")
        self.assertEqual(structured, {})

    def test_failed_status_overrides_any_structured_result(self):
        call = {
            "status": "failed",
            "structured_result": {"status": "confirmed"},
        }
        status, _ = resolve_result(call)
        self.assertEqual(status, "failed")

    def test_recognized_structured_status_passes_through(self):
        call = {
            "status": "completed",
            "structured_result": {"status": "needs_reschedule"},
        }
        status, structured = resolve_result(call)
        self.assertEqual(status, "needs_reschedule")
        self.assertEqual(structured["status"], "needs_reschedule")

    def test_unrecognized_structured_status_is_unclear(self):
        call = {
            "status": "completed",
            "structured_result": {"status": "maybe_confirmed_not_sure"},
        }
        status, _ = resolve_result(call)
        self.assertEqual(status, "unclear")

    def test_missing_structured_result_is_unclear(self):
        call = {"status": "completed"}
        status, _ = resolve_result(call)
        self.assertEqual(status, "unclear")


if __name__ == "__main__":
    unittest.main()
