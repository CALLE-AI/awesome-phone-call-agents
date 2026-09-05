"""
Unit tests for the dependency-free helper functions in
place_confirmation_calls.py: phone masking, E.164 validation, region
inference, allowlist matching, idempotency-key stability, error-body
sanitization, and terminal-result resolution.

These exercise pure logic only — no network calls, no CALL-E API key
required. Run with:

    python -m unittest scripts/test_place_confirmation_calls.py -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from place_confirmation_calls import (
    Appointment, _infer_region, _mask, _sanitize_error_text,
    _stable_idempotency_key, _validate_base_url, normalize_phone_for_match,
    resolve_result, validate_e164,
)


class TestMask(unittest.TestCase):
    def test_masks_middle_digits(self):
        self.assertEqual(_mask("+14155550101"), "+1415•••••01")

    def test_short_number_fully_masked(self):
        self.assertEqual(_mask("123"), "•••")

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(_mask("  +14155550101  "), "+1415•••••01")


class TestValidateE164(unittest.TestCase):
    def test_accepts_valid_ascii_e164(self):
        ok, _ = validate_e164("+14155550101")
        self.assertTrue(ok)

    def test_rejects_missing_plus(self):
        ok, reason = validate_e164("14155550101")
        self.assertFalse(ok)
        self.assertIn("E.164", reason)

    def test_rejects_non_ascii_digits(self):
        # Arabic-Indic digit variant of "1" smuggled into the number.
        ok, reason = validate_e164("+١4155550101")
        self.assertFalse(ok)
        self.assertIn("non-ASCII", reason)

    def test_rejects_letters(self):
        ok, _ = validate_e164("+1415555ABCD")
        self.assertFalse(ok)

    def test_rejects_too_short(self):
        ok, _ = validate_e164("+123")
        self.assertFalse(ok)

    def test_rejects_leading_zero_country_code(self):
        ok, _ = validate_e164("+0145550101")
        self.assertFalse(ok)


class TestInferRegion(unittest.TestCase):
    def test_infers_us(self):
        self.assertEqual(_infer_region("+14155550101"), "US")

    def test_infers_uk(self):
        self.assertEqual(_infer_region("+442079460101"), "GB")

    def test_prefers_longer_country_code_match(self):
        # +971 (UAE) must not be misread as +9 or +97 matching something else.
        self.assertEqual(_infer_region("+971501234567"), "AE")

    def test_unknown_code_returns_none(self):
        self.assertIsNone(_infer_region("+9999999999"))


class TestAllowlistMatching(unittest.TestCase):
    def test_exact_match(self):
        self.assertEqual(normalize_phone_for_match("+14155550101"), "+14155550101")

    def test_no_partial_match_semantics(self):
        # normalize_phone_for_match must not strip/alter digits in a way
        # that would let a near-miss number match — exact string only.
        a = normalize_phone_for_match("+14155550101")
        b = normalize_phone_for_match("+1415555010")  # one digit short
        self.assertNotEqual(a, b)


class TestStableIdempotencyKey(unittest.TestCase):
    def _appt(self, **overrides):
        base = dict(
            recipient_name="Alex Rivera", phone="+14155550101",
            appointment_time="2026-09-08T15:00:00-04:00",
            context="annual checkup", business_name="Sunrise Clinic",
        )
        base.update(overrides)
        return Appointment(**base)

    def test_same_appointment_same_key_across_calls(self):
        a1 = self._appt()
        a2 = self._appt()
        self.assertEqual(_stable_idempotency_key(a1), _stable_idempotency_key(a2))

    def test_key_is_not_random_each_time(self):
        a = self._appt()
        self.assertEqual(_stable_idempotency_key(a), _stable_idempotency_key(a))

    def test_different_appointment_different_key(self):
        a1 = self._appt()
        a2 = self._appt(appointment_time="2026-09-09T15:00:00-04:00")
        self.assertNotEqual(_stable_idempotency_key(a1), _stable_idempotency_key(a2))


class TestValidateBaseUrl(unittest.TestCase):
    def test_official_https_host_ok(self):
        ok, _ = _validate_base_url("https://api.heycall-e.com", allow_custom_host=False)
        self.assertTrue(ok)

    def test_rejects_http_scheme(self):
        ok, reason = _validate_base_url("http://api.heycall-e.com", allow_custom_host=False)
        self.assertFalse(ok)
        self.assertIn("https", reason)

    def test_rejects_unknown_host_by_default(self):
        ok, reason = _validate_base_url("https://evil.example.com", allow_custom_host=False)
        self.assertFalse(ok)
        self.assertIn("official CALL-E host", reason)

    def test_allows_unknown_host_with_explicit_override(self):
        ok, _ = _validate_base_url("https://staging.example.com", allow_custom_host=True)
        self.assertTrue(ok)


class TestSanitizeErrorText(unittest.TestCase):
    def test_redacts_api_key(self):
        text = _sanitize_error_text("auth failed for key sk_live_abc123", api_key="sk_live_abc123")
        self.assertNotIn("sk_live_abc123", text)
        self.assertIn("REDACTED_API_KEY", text)

    def test_redacts_raw_phone_number(self):
        text = _sanitize_error_text("could not reach +14155550101", api_key="")
        self.assertNotIn("+14155550101", text)
        self.assertIn("REDACTED_PHONE", text)

    def test_truncates_long_text(self):
        text = _sanitize_error_text("x" * 1000, api_key="")
        self.assertLessEqual(len(text), 500)


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
