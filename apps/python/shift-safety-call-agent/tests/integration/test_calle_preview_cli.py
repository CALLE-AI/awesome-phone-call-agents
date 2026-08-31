"""Safety tests for the CALL-E dry-run CLI surface."""

import socket
import sys
import unittest
from datetime import datetime, timezone
from io import StringIO
from unittest.mock import patch

from shift_safety_call_agent.cli import build_parser, main

FIXED_TIME = datetime(2026, 8, 4, 9, 0, tzinfo=timezone.utc)


class CallePreviewCliTests(unittest.TestCase):
    """Verify the preview cannot load CALL-E or reach a phone/network path."""

    def test_all_preview_scenarios_are_explicit_dry_runs(self) -> None:
        for scenario in ("no-incident", "minor-near-miss", "equipment-issue", "incomplete"):
            with self.subTest(scenario=scenario):
                output = StringIO()
                self.assertEqual(
                    main(
                        ["preview-calle", "--scenario", scenario],
                        output=output,
                        clock=lambda: FIXED_TIME,
                        id_generator=lambda: "plan-fixed",
                    ),
                    0,
                )
                rendered = output.getvalue()
                self.assertIn("Dry run only", rendered)
                self.assertIn("No CALL-E request will be sent", rendered)
                self.assertIn("No phone call will be placed", rendered)
                self.assertIn("Region: JP", rendered)
                self.assertIn("Language: English", rendered)
                self.assertIn("Real phone number included: false", rendered)
                self.assertNotIn("This is an AI phone call", rendered)

    def test_show_task_displays_only_the_fictional_phone_free_task(self) -> None:
        output = StringIO()
        self.assertEqual(
            main(
                ["preview-calle", "--scenario", "no-incident", "--show-task"],
                output=output,
                clock=lambda: FIXED_TIME,
                id_generator=lambda: "plan-fixed",
            ),
            0,
        )
        rendered = output.getvalue()
        self.assertIn("TASK\nThis is an AI phone call", rendered)
        self.assertTrue(rendered.isascii())
        self.assertNotIn("CALLE_API_KEY", rendered)

    def test_preview_imports_no_calle_sdk_and_attempts_no_network(self) -> None:
        sys.modules.pop("calle", None)
        with patch.object(socket.socket, "connect", side_effect=AssertionError("network attempted")):
            self.assertEqual(
                main(
                    ["preview-calle", "--scenario", "incomplete"],
                    output=StringIO(),
                    clock=lambda: FIXED_TIME,
                    id_generator=lambda: "plan-fixed",
                ),
                0,
            )
        self.assertNotIn("calle", sys.modules)

    def test_cli_exposes_only_the_named_one_shot_live_call_command(self) -> None:
        parser = build_parser()
        action = next(item for item in parser._actions if item.dest == "command")
        commands = set(action.choices)
        self.assertTrue({"scenarios", "run-fake", "preview-calle", "list"}.issubset(commands))
        self.assertIn("live-call-self", commands)
        self.assertTrue(
            commands.isdisjoint(
                {"run-calle", "call", "dial", "start-call", "execute-calle", "send-call", "place-call"}
            )
        )


if __name__ == "__main__":
    unittest.main()
