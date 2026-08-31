"""Network-blocked CLI tests for the one-shot live CALL-E boundary."""

from __future__ import annotations

import tempfile
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch

from shift_safety_call_agent.adapters.calle_live import LiveCallGateError, LiveCallOutcome
from shift_safety_call_agent.adapters.calle_offline import map_calle_response
from shift_safety_call_agent.adapters.calle_sdk_adapter import normalize_calle_sdk_response
from shift_safety_call_agent.adapters.sqlite_repository import SqliteInterviewRepository
from shift_safety_call_agent.cli import build_parser, main
from tests.fixtures.calle_responses import NO_INCIDENT_RESPONSE
from tests.fixtures.calle_sdk_contract import network_blocked


def _synthetic_e164() -> str:
    """Return synthetic +81 shape only; never a supplied or verified real number."""

    return "+81" + ("9" * 10)


class _TerminalInput(StringIO):
    """In-memory interactive-input double, never a real terminal or credential."""

    def isatty(self) -> bool:
        return True


def _outcome() -> LiveCallOutcome:
    payload = deepcopy(NO_INCIDENT_RESPONSE)
    payload["id"] = "call_synthetic_cli"
    payload["summary"] = "The fictional self-check was completed."
    payload["transcript"] = "must never be selected or persisted"
    snapshot = normalize_calle_sdk_response(payload)
    return LiveCallOutcome(
        snapshot=snapshot,
        normalized_result=map_calle_response(snapshot),
    )


class LiveCallCliTests(unittest.TestCase):
    def setUp(self) -> None:
        terminal_patch = patch("sys.stdin", _TerminalInput())
        terminal_patch.start()
        self.addCleanup(terminal_patch.stop)
        self.environment = {
            "CALL_PROVIDER": "calle",
            "ALLOW_REAL_CALLS": "true",
            "CALLE_API_KEY": "synthetic-runtime-credential",
            "CALLE_RECIPIENT_E164": _synthetic_e164(),
            "CALLE_HUMAN_CONFIRMATION": "I CONFIRM THIS CALL IS TO MY OWN PHONE",
        }

    def test_command_has_no_recipient_batch_schedule_or_retry_arguments(self) -> None:
        parser = build_parser()
        command_action = next(item for item in parser._actions if item.dest == "command")
        self.assertIn("live-call-self", command_action.choices)
        live_parser = command_action.choices["live-call-self"]
        argument_names = {item.dest for item in live_parser._actions}
        self.assertEqual(argument_names, {"help", "save", "db_path"})

    def test_invalid_or_noninteractive_input_stops_before_runner(self) -> None:
        readers = (
            lambda: "",
            lambda: "not confirmed",
            lambda: " PLACE ONE CALL NOW",
            lambda: "PLACE ONE CALL NOW ",
            Mock(side_effect=EOFError),
            Mock(side_effect=KeyboardInterrupt),
        )
        for reader in readers:
            runner = Mock()
            output = StringIO()
            with self.subTest(reader=reader), network_blocked():
                exit_code = main(
                    ["live-call-self"],
                    output=output,
                    environment=self.environment,
                    input_reader=reader,
                    live_call_runner=runner,
                    live_readiness_checker=lambda _: None,
                )
            self.assertEqual(exit_code, 2)
            runner.assert_not_called()
        exact = "PLACE ONE CALL NOW\n"
        noninteractive_inputs = (
            ("pipe", Mock(isatty=Mock(return_value=False), readline=Mock(return_value=exact))),
            ("redirected-file", Mock(isatty=Mock(return_value=False), readline=Mock(return_value=exact))),
            ("memory-stream", StringIO(exact)),
            ("missing-stdin", None),
            ("missing-isatty", object()),
            ("isatty-failure", Mock(isatty=Mock(side_effect=OSError("private-input-marker")))),
            ("closed-stream", Mock(isatty=Mock(side_effect=ValueError("private-input-marker")))),
            ("indeterminate-isatty", Mock(isatty=Mock(return_value=None))),
            ("non-boolean-isatty", Mock(isatty=Mock(return_value=1))),
        )
        for label, source in noninteractive_inputs:
            reader = Mock(return_value=exact.rstrip("\n"))
            runner = Mock()
            output = StringIO()
            with (
                self.subTest(source=label),
                network_blocked(),
                patch("sys.stdin", source),
                patch("shift_safety_call_agent.adapters.calle_live.ProductionCalleClientFactory.create") as create_client,
            ):
                exit_code = main(
                    ["live-call-self"],
                    output=output,
                    environment=self.environment,
                    input_reader=reader,
                    live_call_runner=runner,
                    live_readiness_checker=lambda _: None,
                )
                self.assertEqual(exit_code, 2)
                reader.assert_not_called()
                runner.assert_not_called()
                create_client.assert_not_called()
                self.assertIn("requires an interactive terminal", output.getvalue())
                self.assertNotIn("FINAL EXECUTION PERMIT", output.getvalue())
                self.assertNotIn("private-input-marker", output.getvalue())

    def test_closed_readiness_gate_stops_before_final_permit_prompt(self) -> None:
        reader = Mock()
        runner = Mock()
        output = StringIO()
        with network_blocked():
            exit_code = main(
                ["live-call-self"],
                output=output,
                environment=self.environment,
                input_reader=reader,
                live_call_runner=runner,
                live_readiness_checker=Mock(
                    side_effect=LiveCallGateError("safe gate failure")
                ),
            )
        self.assertEqual(exit_code, 2)
        reader.assert_not_called()
        runner.assert_not_called()
        self.assertNotIn("PLACE ONE CALL NOW", output.getvalue())
        for recipient in ("+" + ("9" * 11), "+810" + ("9" * 9)):
            environment = dict(self.environment, CALLE_RECIPIENT_E164=recipient)
            output = StringIO()
            with network_blocked(), patch(
                "shift_safety_call_agent.adapters.calle_live.ProductionCalleClientFactory.create"
            ) as create_client:
                exit_code = main(
                    ["live-call-self"],
                    output=output,
                    environment=environment,
                    input_reader=reader,
                    live_call_runner=runner,
                )
                self.assertEqual(exit_code, 2)
                reader.assert_not_called()
                runner.assert_not_called()
                create_client.assert_not_called()
                self.assertNotIn(recipient, output.getvalue())
                self.assertNotIn("FINAL EXECUTION PERMIT", output.getvalue())

    def test_exact_permit_runs_once_without_rendering_key_phone_or_raw_data(self) -> None:
        runner = Mock(return_value=_outcome())
        output = StringIO()
        with network_blocked(), patch("sys.stdin", _TerminalInput("PLACE ONE CALL NOW\n")):
            exit_code = main(
                ["live-call-self"],
                output=output,
                environment=self.environment,
                live_call_runner=runner,
                live_readiness_checker=lambda _: None,
                id_generator=iter(("interview-synthetic", "plan-synthetic")).__next__,
            )
        self.assertEqual(exit_code, 0)
        runner.assert_called_once()
        rendered = output.getvalue()
        self.assertIn("Provider identifiers: withheld", rendered)
        self.assertNotIn("call_synthetic_cli", rendered)
        self.assertIn("Structured result: safely normalized", rendered)
        self.assertIn("Evidence count: 1", rendered)
        self.assertIn("Transcript persisted: false", rendered)
        self.assertNotIn(self.environment["CALLE_API_KEY"], rendered)
        self.assertNotIn(self.environment["CALLE_RECIPIENT_E164"], rendered)
        self.assertNotIn("must never be selected", rendered)

    def test_save_persists_only_normalized_fields_and_no_transcript(self) -> None:
        runner = Mock(return_value=_outcome())
        fixed_time = datetime(2026, 8, 22, 3, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "live-result.db"
            output = StringIO()
            with network_blocked(), patch.object(
                SqliteInterviewRepository, "save", autospec=True,
                side_effect=SqliteInterviewRepository.save,
            ) as save_record:
                exit_code = main(
                    ["live-call-self", "--save", "--db-path", str(database_path)],
                    output=output,
                    environment=self.environment,
                    input_reader=lambda: "PLACE ONE CALL NOW",
                    live_call_runner=runner,
                    live_readiness_checker=lambda _: None,
                    clock=lambda: fixed_time,
                    id_generator=iter(("interview-live-safe", "plan-live-safe")).__next__,
                )
            self.assertEqual(exit_code, 0)
            self.assertIsNone(save_record.call_args.args[1].call_provider_run_id)
            self.assertNotIn("call_synthetic_cli", output.getvalue())
            record = SqliteInterviewRepository(database_path).get("interview-live-safe")
            self.assertIsNotNone(record)
            assert record is not None
            self.assertEqual(record.call_provider, "calle")
            self.assertIsNone(record.call_provider_run_id)
            self.assertIsNotNone(record.result)
            database_bytes = database_path.read_bytes()
            self.assertNotIn(b"call_synthetic_cli", database_bytes)
            self.assertNotIn(b"transcript", database_bytes.lower())
            self.assertNotIn(self.environment["CALLE_API_KEY"].encode(), database_bytes)
            self.assertNotIn(self.environment["CALLE_RECIPIENT_E164"].encode(), database_bytes)

            # Older/injected records must not leak an identifier through db-show.
            record.call_provider_run_id = "call_synthetic_cli"
            detail_output = StringIO()
            with network_blocked(), patch.object(
                SqliteInterviewRepository, "get", return_value=record
            ):
                self.assertEqual(main(
                    ["db-show", "--id", record.interview_id, "--db-path", str(database_path)],
                    output=detail_output,
                ), 0)
            self.assertNotIn("call_synthetic_cli", detail_output.getvalue())
            self.assertIn("Provider run ID: withheld", detail_output.getvalue())


if __name__ == "__main__":
    unittest.main()
