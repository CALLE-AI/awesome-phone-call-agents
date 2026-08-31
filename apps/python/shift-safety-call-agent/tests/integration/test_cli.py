"""Offline integration tests for the CLI and application service."""

import unittest
from datetime import datetime, timezone
from io import StringIO

from shift_safety_call_agent.adapters.memory_repository import MemoryInterviewRepository
from shift_safety_call_agent.cli import main


FIXED_TIME = datetime(2026, 8, 2, 12, 0, tzinfo=timezone.utc)


class CliIntegrationTests(unittest.TestCase):
    """Verify commands using injected in-process dependencies."""

    def test_cli_lists_scenarios(self) -> None:
        output = StringIO()
        self.assertEqual(main(["scenarios"], output=output), 0)
        self.assertEqual(
            output.getvalue().splitlines(),
            ["no-incident", "minor-near-miss", "equipment-follow-up", "incomplete-answers"],
        )

    def test_cli_runs_fake_scenario_and_separates_fact_from_assessment(self) -> None:
        output = StringIO()
        repository = MemoryInterviewRepository()
        code = main(
            ["run-fake", "--scenario", "minor-near-miss"],
            output=output,
            repository=repository,
            clock=lambda: FIXED_TIME,
            id_generator=lambda: "interview-1",
        )
        rendered = output.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("FACT\n", rendered)
        self.assertIn("Near miss reported: true", rendered)
        self.assertIn("ASSESSMENT\n", rendered)
        self.assertIn("Incident level: minor", rendered)
        stored = repository.get("interview-1")
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertIsNotNone(stored.result)

    def test_repeated_cli_runs_add_records_instead_of_overwriting(self) -> None:
        repository = MemoryInterviewRepository()
        identifiers = iter(("interview-1", "interview-2"))
        for scenario in ("no-incident", "equipment-follow-up"):
            self.assertEqual(
                main(
                    ["run-fake", "--scenario", scenario],
                    output=StringIO(),
                    repository=repository,
                    clock=lambda: FIXED_TIME,
                    id_generator=lambda: next(identifiers),
                ),
                0,
            )
        output = StringIO()
        self.assertEqual(main(["list"], output=output, repository=repository), 0)
        self.assertEqual(len(repository.list()), 2)
        self.assertIn("interview-1\tcompleted\tno-incident", output.getvalue())
        self.assertIn("interview-2\tcompleted\tequipment-follow-up", output.getvalue())


if __name__ == "__main__":
    unittest.main()
