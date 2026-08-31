"""Tests for explicit localhost-only server composition without a live socket."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import Mock, patch


WEB_AVAILABLE = all(
    importlib.util.find_spec(package) is not None
    for package in ("fastapi", "uvicorn", "httpx")
)

if WEB_AVAILABLE:
    from shift_safety_call_agent.adapters.sqlite_repository import (
        SqliteInterviewRepository,
    )
    from shift_safety_call_agent.adapters.web.server import (
        DEFAULT_API_PORT,
        LOCAL_API_HOST,
        serve_local_api,
    )
    from shift_safety_call_agent.adapters.web.static_files import (
        StaticAssetUnavailableError,
    )

from shift_safety_call_agent.cli import build_parser, main


@unittest.skipUnless(WEB_AVAILABLE, "optional web dependencies are not installed")
class ServerCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.database_path = Path(self.temporary_directory.name) / "server.db"

    def test_server_initializes_database_and_binds_one_local_worker(self) -> None:
        runner = Mock()
        output = StringIO()
        code = serve_local_api(
            repository=SqliteInterviewRepository(self.database_path),
            database_label="<custom-database>",
            port=DEFAULT_API_PORT,
            app_version="0.9.0-dev",
            output=output,
            runner=runner,
        )
        self.assertEqual(code, 0)
        self.assertTrue(self.database_path.exists())
        runner.assert_called_once()
        kwargs = runner.call_args.kwargs
        self.assertEqual(kwargs["host"], LOCAL_API_HOST)
        self.assertEqual(kwargs["port"], 8765)
        self.assertIs(kwargs["reload"], False)
        self.assertEqual(kwargs["workers"], 1)
        self.assertIs(kwargs["access_log"], False)
        rendered = output.getvalue()
        self.assertIn("http://127.0.0.1:8765", rendered)
        self.assertIn("Provider: fake", rendered)
        self.assertIn("Real calls enabled: false", rendered)
        self.assertIn("External access: disabled", rendered)
        self.assertNotIn(str(self.database_path.parent), rendered)

    def test_port_failure_returns_only_a_safe_message(self) -> None:
        output = StringIO()
        code = serve_local_api(
            repository=SqliteInterviewRepository(self.database_path),
            database_label="<custom-database>",
            port=8765,
            app_version="0.9.0-dev",
            output=output,
            runner=Mock(side_effect=OSError("synthetic socket details")),
        )
        self.assertEqual(code, 2)
        self.assertIn("local port may be unavailable", output.getvalue())
        self.assertNotIn("synthetic socket details", output.getvalue())

    def test_missing_static_asset_fails_safely_before_database_creation(self) -> None:
        output = StringIO()
        runner = Mock()
        with patch(
            "shift_safety_call_agent.adapters.web.server.create_app",
            side_effect=StaticAssetUnavailableError("synthetic private path"),
        ):
            code = serve_local_api(
                repository=SqliteInterviewRepository(self.database_path),
                database_label="<custom-database>",
                port=8765,
                app_version="0.9.0-dev",
                output=output,
                runner=runner,
            )
        self.assertEqual(code, 2)
        self.assertIn("could not load its packaged UI assets", output.getvalue())
        self.assertNotIn("synthetic private path", output.getvalue())
        self.assertFalse(self.database_path.exists())
        runner.assert_not_called()

    def test_cli_has_no_host_option_and_validates_port_before_server_import(self) -> None:
        action = next(item for item in build_parser()._actions if item.dest == "command")
        serve_parser = action.choices["serve-api"]
        options = {option for item in serve_parser._actions for option in item.option_strings}
        self.assertNotIn("--host", options)
        self.assertIn("--port", options)
        for invalid in ("text", "1023", "65536"):
            with self.subTest(invalid=invalid), self.assertRaises(SystemExit):
                build_parser().parse_args(["serve-api", "--port", invalid])

    def test_cli_delegates_without_starting_a_real_server(self) -> None:
        output = StringIO()
        with patch(
            "shift_safety_call_agent.adapters.web.server.serve_local_api",
            return_value=0,
        ) as serve:
            code = main(
                [
                    "serve-api",
                    "--db-path",
                    str(self.database_path),
                    "--port",
                    "9000",
                ],
                output=output,
            )
        self.assertEqual(code, 0)
        kwargs = serve.call_args.kwargs
        self.assertEqual(kwargs["port"], 9000)
        self.assertEqual(kwargs["database_label"], "<custom-database>")
        self.assertEqual(kwargs["app_version"], "0.9.0-dev")
        self.assertFalse(self.database_path.exists())


if __name__ == "__main__":
    unittest.main()
