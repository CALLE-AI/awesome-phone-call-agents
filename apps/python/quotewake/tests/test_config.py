"""Tests for QuoteWake TOML configuration."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from quotewake_salesforce.config import (
    LoggingSettings,
    RegionalSettings,
    load_initial_follow_up_timing,
    load_logging_settings,
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

    def test_loads_logging_settings(self) -> None:
        settings = load_logging_settings(
            self._config(
                """
[logging]
directory = "var/logs"
format = "text"
level = "DEBUG"
max_bytes = 1024
backup_count = 2
"""
            )
        )

        self.assertEqual(
            settings,
            LoggingSettings("var/logs", "text", "DEBUG", 1024, 2),
        )

    def test_logging_defaults_are_production_safe(self) -> None:
        settings = load_logging_settings(self._config("[regional]\n"))

        self.assertEqual(settings.directory, "logs")
        self.assertEqual(settings.format, "text")
        self.assertEqual(settings.level, "INFO")
        self.assertGreater(settings.max_bytes, 0)
        self.assertGreaterEqual(settings.backup_count, 0)

    def test_rejects_invalid_logging_values(self) -> None:
        invalid_documents = (
            '[logging]\nmax_bytes = 0\n',
            '[logging]\nbackup_count = -1\n',
            '[logging]\nformat = "json"\n',
            '[logging]\nlevel = "TRACE"\n',
            '[logging]\nmax_bytes = "1024"\n',
        )
        for document in invalid_documents:
            with self.subTest(document=document):
                with self.assertRaises(ValueError):
                    load_logging_settings(self._config(document))

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
