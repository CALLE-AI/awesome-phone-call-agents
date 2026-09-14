from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pawpassage.cli import _verify_live_window
from pawpassage.demo import run_demo
from tests.helpers import EXAMPLE, ROOT


class DemoAndCliTests(unittest.TestCase):
    def test_demo_is_complete_credential_free_and_privacy_minimized(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pawpassage-report-test-") as temporary:
            packet, json_path, html_path = run_demo(EXAMPLE, temporary)
            rendered = json_path.read_text(encoding="utf-8") + html_path.read_text(
                encoding="utf-8"
            )
        self.assertEqual(packet["providerBoundary"]["realCalls"], 0)
        self.assertEqual(packet["providerBoundary"]["fakeServerCreateRequests"], 3)
        self.assertEqual(packet["providerBoundary"]["fakeServerUniqueCalls"], 2)
        self.assertEqual(len(packet["duplicateChecks"]), 2)
        self.assertTrue(
            all(item["duplicate_prevented"] for item in packet["duplicateChecks"])
        )
        for phone in ("+15550101001", "+15550101002", "+15550101003"):
            self.assertNotIn(phone, rendered)
        self.assertNotIn("demo-fake-key", rendered)
        self.assertIn("HUMAN_REVIEW_REQUIRED", rendered)

    def test_module_cli_runs_the_fake_demo(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pawpassage-cli-test-") as temporary:
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pawpassage",
                    "demo",
                    "--case",
                    str(EXAMPLE),
                    "--output-dir",
                    temporary,
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=20,
                env={**os.environ, "CALLE_API_KEY": "must-not-be-used"},
                check=False,
            )
            report = json.loads(
                (Path(temporary) / "pawpassage-demo-report.json").read_text()
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Real calls: 0", result.stdout)
        self.assertEqual(report["providerBoundary"]["realCalls"], 0)

    def test_live_window_requires_timezone_current_time_and_four_hour_cap(self) -> None:
        now = datetime(2026, 9, 4, 1, 0, tzinfo=UTC)
        _verify_live_window("2026-09-04T00:00:00Z", "2026-09-04T02:00:00Z", now)
        with self.assertRaisesRegex(ValueError, "timezone"):
            _verify_live_window("2026-09-04T00:00:00", "2026-09-04T02:00:00Z", now)
        with self.assertRaisesRegex(ValueError, "four hours"):
            _verify_live_window("2026-09-03T22:00:00Z", "2026-09-04T03:00:00Z", now)
        with self.assertRaisesRegex(ValueError, "outside"):
            _verify_live_window("2026-09-04T02:00:00Z", "2026-09-04T03:00:00Z", now)

    def test_default_demo_finds_packaged_case_from_an_unrelated_directory(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="pawpassage-default-demo-"
        ) as temporary:
            result = subprocess.run(
                [sys.executable, "-m", "pawpassage", "demo"],
                cwd=temporary,
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(
                (
                    Path(temporary) / "artifacts" / "pawpassage-demo-report.json"
                ).read_text()
            )
            self.assertEqual(report["providerBoundary"]["realCalls"], 0)

    def test_live_command_fails_before_sdk_when_kill_switch_is_off(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pawpassage",
                "execute-live",
                "--case",
                str(EXAMPLE),
                "--checkpoint",
                "AIRLINE_DESK",
                "--approval",
                str(ROOT / "missing-approval.json"),
                "--ledger",
                str(ROOT / "never-created.sqlite3"),
                "--window-start",
                datetime.now(UTC).isoformat(),
                "--window-end",
                (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
                "--confirm-real-call",
                "I_APPROVE_ONE_REAL_CALL",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=10,
            env={
                key: value
                for key, value in os.environ.items()
                if key != "PAWPASSAGE_LIVE_CALLS"
            },
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("PAWPASSAGE_LIVE_CALLS", result.stderr)
        self.assertFalse((ROOT / "never-created.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
