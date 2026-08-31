"""Integration tests for the SQLite CLI using temporary database files."""

import tempfile
import unittest
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

from shift_safety_call_agent.cli import main


FIXED_TIME = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)
FORBIDDEN_OUTPUT = ("API_KEY", "Authorization", "transcript", "TASK\n")


class SqliteCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.path = Path(self.temporary_directory.name) / "cli.db"

    def run_cli(self, arguments: list[str], identifier: str = "interview-cli") -> tuple[int, str]:
        output = StringIO()
        code = main(
            arguments,
            output=output,
            clock=lambda: FIXED_TIME,
            id_generator=lambda: identifier,
        )
        rendered = output.getvalue()
        for forbidden in FORBIDDEN_OUTPUT:
            self.assertNotIn(forbidden, rendered)
        self.assertNotIn(str(self.path.parent), rendered)
        return code, rendered

    def test_init_empty_list_save_list_and_show(self) -> None:
        code, initialized = self.run_cli(["db-init", "--db-path", str(self.path)])
        self.assertEqual(code, 0)
        self.assertIn("Schema version: 1", initialized)
        self.assertIn("Initialized: true", initialized)

        code, empty = self.run_cli(["db-list", "--db-path", str(self.path)])
        self.assertEqual(code, 0)
        self.assertEqual(empty, "No persisted interviews.\n")

        code, unsaved = self.run_cli(["run-fake", "--scenario", "no-incident"])
        self.assertEqual(code, 0)
        self.assertNotIn("PERSISTENCE", unsaved)

        code, saved = self.run_cli(
            ["run-fake", "--scenario", "no-incident", "--save", "--db-path", str(self.path)]
        )
        self.assertEqual(code, 0)
        self.assertIn("PERSISTENCE", saved)
        self.assertIn("Saved: true", saved)

        code, listed = self.run_cli(["db-list", "--db-path", str(self.path)])
        self.assertEqual(code, 0)
        self.assertIn("interview-cli", listed)
        self.assertIn("no-incident", listed)
        self.assertIn("fake", listed)

        code, shown = self.run_cli(
            ["db-show", "--id", "interview-cli", "--db-path", str(self.path)]
        )
        self.assertEqual(code, 0)
        self.assertIn("FACT\n", shown)
        self.assertIn("ASSESSMENT\n", shown)
        self.assertIn("PROVENANCE\n", shown)
        self.assertIn("Evidence count: 1", shown)
        self.assertNotIn("fictional respondent", shown)

    def test_show_missing_identifier_is_safe(self) -> None:
        code, output = self.run_cli(
            ["db-show", "--id", "missing", "--db-path", str(self.path)]
        )
        self.assertEqual(code, 2)
        self.assertEqual(output, "Persisted interview was not found.\n")


if __name__ == "__main__":
    unittest.main()
