#!/usr/bin/env python3
"""Stdlib tests for late-hold-triage. No network. No live calls."""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from triage_late_hold import (
    HOLD_EXPIRED,
    KEEP_HOLD,
    NEEDS_HUMAN,
    RELEASE_NOW,
    Hold,
    Spoken,
    decide,
    is_reserved_fictional,
    load_holds,
    mask_phone,
    remaining_minutes,
    run,
    validate_base_url,
    validate_e164_for_region,
)

TZ = ZoneInfo("America/New_York")
NOW = datetime(2026, 9, 12, 19, 12, tzinfo=TZ)
HERE = Path(__file__).resolve().parents[1]


def hold(
    *,
    phone: str = "+12025550147",
    hold_minutes: int = 8,
    slot_minutes_ago: int = 12,
) -> Hold:
    slot_start = NOW - timedelta(minutes=slot_minutes_ago)
    return Hold(
        guest_name="Jordan Hale",
        phone=phone,
        slot_start=slot_start,
        hold_until=NOW + timedelta(minutes=hold_minutes),
        business_name="Harbour Window",
        context="table for two at the window",
        region="US",
        locale="en-US",
    )


class MaskAndPhoneTests(unittest.TestCase):
    def test_mask_keeps_country_and_last_two(self) -> None:
        self.assertEqual(mask_phone("+12025550147"), "+1202•••••47")

    def test_reserved_fictional_nanp_is_detected(self) -> None:
        self.assertTrue(is_reserved_fictional("+12025550147"))
        self.assertFalse(is_reserved_fictional("+12025551212"))

    def test_us_length_and_country_match(self) -> None:
        self.assertIsNone(validate_e164_for_region("+12025550147", "US"))
        self.assertIsNotNone(validate_e164_for_region("+12025550147", "SG"))
        self.assertIsNotNone(validate_e164_for_region("+6591234567", "US"))


class DecisionTests(unittest.TestCase):
    def test_eta_inside_hold_keeps(self) -> None:
        result = decide(
            hold(),
            NOW,
            Spoken(status="answered", still_coming=True, eta_minutes=6),
        )
        self.assertEqual(result.decision, KEEP_HOLD)
        self.assertEqual(result.remaining_minutes, 8)

    def test_eta_past_hold_releases(self) -> None:
        result = decide(
            hold(hold_minutes=3),
            NOW,
            Spoken(status="answered", still_coming=True, eta_minutes=20),
        )
        self.assertEqual(result.decision, RELEASE_NOW)
        self.assertIn("cascade", result.next_step)

    def test_guest_release_is_release_now(self) -> None:
        result = decide(
            hold(),
            NOW,
            Spoken(status="answered", still_coming=False, released=True),
        )
        self.assertEqual(result.decision, RELEASE_NOW)

    def test_no_answer_needs_human(self) -> None:
        result = decide(hold(), NOW, Spoken(status="no_answer"))
        self.assertEqual(result.decision, NEEDS_HUMAN)
        self.assertIn("do not auto-release", result.next_step)

    def test_voicemail_needs_human(self) -> None:
        result = decide(hold(), NOW, Spoken(status="voicemail"))
        self.assertEqual(result.decision, NEEDS_HUMAN)

    def test_coming_without_eta_needs_human(self) -> None:
        result = decide(
            hold(),
            NOW,
            Spoken(status="answered", still_coming=True, eta_minutes=None),
        )
        self.assertEqual(result.decision, NEEDS_HUMAN)

    def test_expired_hold_never_calls(self) -> None:
        past = hold(hold_minutes=-1)
        result = decide(past, NOW, Spoken(status="answered", still_coming=True, eta_minutes=1))
        self.assertEqual(result.decision, HOLD_EXPIRED)
        self.assertLess(remaining_minutes(past, NOW), 0)

    def test_eta_equal_to_remaining_keeps(self) -> None:
        result = decide(
            hold(hold_minutes=6),
            NOW,
            Spoken(status="answered", still_coming=True, eta_minutes=6),
        )
        self.assertEqual(result.decision, KEEP_HOLD)


class LoadAndCliTests(unittest.TestCase):
    def test_sample_csv_loads_three_rows(self) -> None:
        rows = load_holds(HERE / "assets" / "sample_holds.csv")
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(row.hold_until > row.slot_start for row in rows))

    def test_dry_run_sample_board(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "result.json"
            code = run(
                [
                    "--in", str(HERE / "assets" / "sample_holds.csv"),
                    "--now", "2026-09-12T19:12:00-04:00",
                    "--out", str(out),
                ]
            )
            self.assertEqual(code, 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
            decisions = [row["decision"] for row in payload]
            self.assertEqual(decisions, [KEEP_HOLD, RELEASE_NOW, NEEDS_HUMAN])
            self.assertTrue(all("•" in row["phone_masked"] for row in payload))
            self.assertTrue(all(row["call_id"] is None for row in payload))

    def test_live_without_allowlist_is_refused(self) -> None:
        with self.assertRaises(SystemExit):
            run(
                [
                    "--in", str(HERE / "assets" / "sample_holds.csv"),
                    "--guest-phone", "+12025550147",
                    "--confirm",
                ]
            )

    def test_live_fictional_number_is_refused(self) -> None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
            handle.write("+12025550147\n")
            allow = handle.name
        with self.assertRaises(SystemExit) as raised:
            run(
                [
                    "--in", str(HERE / "assets" / "sample_holds.csv"),
                    "--guest-phone", "+12025550147",
                    "--authorized-numbers", allow,
                    "--confirm",
                ]
            )
        self.assertIn("fictional", str(raised.exception).lower())

    def test_foreign_origin_is_refused(self) -> None:
        with self.assertRaises(SystemExit):
            validate_base_url("https://evil.example.com")
        with self.assertRaises(SystemExit):
            validate_base_url("http://api.heycall-e.com")
        self.assertEqual(
            validate_base_url("https://api.heycall-e.com/"),
            "https://api.heycall-e.com",
        )


if __name__ == "__main__":
    unittest.main()
