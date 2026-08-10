"""Tests for the public QuoteWake Salesforce-oriented CLI entry point."""

from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from quotewake_salesforce.cli import main


class TestQuoteWakeCli(unittest.TestCase):
    def test_no_arguments_show_current_workflow_help(self) -> None:
        with patch("sys.stdout", new=io.StringIO()) as fake_out:
            exit_code = main([])

        self.assertEqual(exit_code, 0)
        captured = fake_out.getvalue()
        self.assertIn("QuoteWake Salesforce selection", captured)
        self.assertIn("--dry-run", captured)
        self.assertIn("--simulate-call", captured)

    def test_help_lists_current_workflow_modes_and_options(self) -> None:
        with patch("sys.stdout", new=io.StringIO()) as fake_out:
            exit_code = main(["--help"])

        self.assertEqual(exit_code, 0)
        captured = fake_out.getvalue()
        for option in (
            "--plan-calls",
            "--simulate-call",
            "--quote-id",
            "--simulation-outcome",
            "--next-follow-up-at",
            "--confirm-demo-write",
            "--config",
        ):
            with self.subTest(option=option):
                self.assertIn(option, captured)
        self.assertNotIn("Invoice", captured)


if __name__ == "__main__":
    unittest.main()
