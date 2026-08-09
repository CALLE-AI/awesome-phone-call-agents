"""Tests for QuoteWake TOML configuration."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from quotewake_salesforce.config import (
    RegionalSettings,
    load_initial_follow_up_timing,
)


class TestQuoteWakeConfiguration(unittest.TestCase):
    def _config(self, content: str) -> Path:
        directory = Path(tempfile.mkdtemp(prefix="quotewake-config-test-"))
        path = directory / "quotewake.toml"
        path.write_text(content, encoding="utf-8")
        return path

    def test_loads_initial_follow_up_timing(self) -> None:
        timing = load_initial_follow_up_timing(
            self._config(
                """
[selection.initial_follow_up]
minimum_delay_hours = 4
standard_delay_hours = 48
due_soon_window_days = 3
"""
            )
        )

        self.assertEqual(timing.minimum_delay, timedelta(hours=4))
        self.assertEqual(timing.standard_delay, timedelta(hours=48))
        self.assertEqual(timing.due_soon_window, timedelta(days=3))

    def test_rejects_standard_delay_shorter_than_minimum(self) -> None:
        path = self._config(
            """
[selection.initial_follow_up]
minimum_delay_hours = 4
standard_delay_hours = 2
due_soon_window_days = 3
"""
        )

        with self.assertRaisesRegex(ValueError, "standard_delay_hours"):
            load_initial_follow_up_timing(path)

    def test_rejects_missing_timing_table(self) -> None:
        path = self._config("[selection]\n")

        with self.assertRaisesRegex(ValueError, "selection.initial_follow_up"):
            load_initial_follow_up_timing(path)

    def test_accepts_alternate_iana_timezone_and_bcp47_locale(self) -> None:
        settings = RegionalSettings.from_values("America/Los_Angeles", "en-US")

        self.assertEqual(settings.business_timezone.key, "America/Los_Angeles")
        self.assertEqual(settings.locale, "en_US")

    def test_strips_bcp47_unicode_extension_when_babel_cannot_parse_it(self) -> None:
        settings = RegionalSettings.from_values("Asia/Tokyo", "ja-JP-u-ca-japanese")

        self.assertEqual(settings.business_timezone.key, "Asia/Tokyo")
        self.assertEqual(settings.locale, "ja_JP")

    def test_normalizes_mixed_cldr_and_bcp47_unicode_extension(self) -> None:
        settings = RegionalSettings.from_values(
            "Australia/Sydney", "en_US-u-ca-gregory"
        )

        self.assertEqual(settings.business_timezone.key, "Australia/Sydney")
        self.assertEqual(settings.locale, "en_US")


if __name__ == "__main__":
    unittest.main()
