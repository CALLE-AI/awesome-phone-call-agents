"""Tests for QuoteWake's standard-library logging configuration and event contract."""

from __future__ import annotations

import io
import logging
from pathlib import Path
import tempfile
from unittest import TestCase
from unittest.mock import Mock, patch

from quotewake_salesforce.calle.client import CallEPlanningClient
from quotewake_salesforce.cli import salesforce_dry_run_main
from quotewake_salesforce.salesforce.client import SalesforceClient
from quotewake_salesforce.structured_logging import (
    configure_logging,
    log_context,
    log_event,
    log_exception,
    logger,
)


class TestStructuredLogging(TestCase):
    def test_uses_standard_library_logger_and_readable_timestamp(self) -> None:
        self.assertIsInstance(logger(), logging.Logger)
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(log_format="text", log_directory=directory)
            log_event("quote_selected", quote_id="Q-001")

        self.assertRegex(
            output.getvalue(),
            r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[INFO\] quote_selected: ",
        )
        self.assertNotIn("=", output.getvalue())

    def test_text_event_has_correlation_and_keeps_authorized_phone(self) -> None:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(
                level="INFO",
                log_format="text",
                log_directory=directory,
            )
            log_event(
                "quote_processing_started",
                run_id="run-123",
                quote_id="0Q0000000000001",
                phone="+14155550101",
            )

        rendered = output.getvalue()
        self.assertIn("quote_processing_started", rendered)
        self.assertRegex(rendered, r"^.+ \[INFO\] quote_processing_started: ")
        self.assertIn("run run-123", rendered)
        self.assertIn("quote 0Q0000000000001", rendered)
        self.assertIn("phone +14155550101", rendered)
        self.assertNotIn("run_id=", rendered)

    def test_exception_text_with_secret_is_not_serialized(self) -> None:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(log_format="text", log_directory=directory)
            log_exception(
                "call_e_failed",
                RuntimeError("access_token=TOPSECRET raw_response={'phone': '+14155550101'}"),
            )

        rendered = output.getvalue()
        self.assertIn("error type RuntimeError", rendered)
        self.assertNotIn("TOPSECRET", rendered)
        self.assertNotIn("raw_response", rendered)
        self.assertNotIn("+14155550101", rendered)

    def test_context_provides_run_and_quote_correlation(self) -> None:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(log_format="text", log_directory=directory)
            with log_context(run_id="run-456", quote_id="0Q0000000000002"):
                log_event("quote_selection_evaluated", decision="READY")

        rendered = output.getvalue()
        self.assertIn("run run-456", rendered)
        self.assertIn("quote 0Q0000000000002", rendered)
        self.assertIn("decision READY", rendered)

    def test_log_level_filters_events(self) -> None:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(level="WARNING", log_format="text", log_directory=directory)
            log_event("debug_detail", level=logging.INFO)
            log_event("failure", level=logging.ERROR)

        self.assertNotIn("debug_detail", output.getvalue())
        self.assertIn("failure", output.getvalue())

    def test_rotating_file_is_project_configurable(self) -> None:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(
                log_format="text",
                log_directory=directory,
                max_bytes=256,
                backup_count=1,
            )
            for index in range(20):
                log_event("rotation_probe", index=index, payload="x" * 80)
            log_files = list(Path(directory).glob("quotewake.log*"))
            self.assertTrue(log_files)
            self.assertTrue((Path(directory) / "quotewake.log").exists())

    def test_default_cli_failure_stream_is_readable_text(self) -> None:
        output = io.StringIO()
        with patch("sys.stderr", output):
            exit_code = salesforce_dry_run_main(["--dry-run", "--plan-calls"])

        self.assertEqual(exit_code, 1)
        self.assertIn("run_failed", output.getvalue())

    def test_external_boundary_events_keep_quote_correlation(self) -> None:
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, patch("sys.stderr", output):
            configure_logging(log_format="text", log_directory=directory)
            with patch(
                "subprocess.run",
                return_value=Mock(returncode=0, stdout='{"ok": true}', stderr=""),
            ):
                CallEPlanningClient()._run(
                    ("mcp", "call", "plan_call"),
                    expect_json=True,
                    quote_id="0Q0000000000003",
                )
            with patch(
                "subprocess.run",
                return_value=Mock(
                    returncode=0,
                    stdout='{"compositeResponse": []}',
                    stderr="",
                ),
            ):
                SalesforceClient()._run_api_json(
                    [
                        "sf",
                        "api",
                        "request",
                        "rest",
                        "/services/data/v64.0/composite",
                    ],
                    quote_id="0Q0000000000003",
                )

        rendered = output.getvalue()
        self.assertIn("quote 0Q0000000000003", rendered)
        self.assertIn("call_e_cli_command_started", rendered)
        self.assertIn("salesforce_rest_request_started", rendered)


if __name__ == "__main__":
    import unittest

    unittest.main()
