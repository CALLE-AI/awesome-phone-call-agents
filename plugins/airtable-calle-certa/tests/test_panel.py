"""Tests for the control panel's authorization boundary.

Two PRs in this repository were blocked for exposing a surface that could
start live calls without authentication and with caller-controlled
destinations. These assert neither is possible here.
"""

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from certa.audit import AuditLog
from certa.panel.server import (
    FIXTURES_MODE,
    LOOPBACK,
    Panel,
    PanelError,
    make_handler,
    serve,
)

from tests.test_runner import VIEW


class BindBoundary(unittest.TestCase):
    def test_non_loopback_bind_is_refused(self):
        for host in ("0.0.0.0", "192.168.1.10", "example.com"):
            with self.assertRaises(PanelError, msg=host):
                serve({}, host=host)

    def test_loopback_set_is_only_loopback(self):
        self.assertEqual(LOOPBACK, {"127.0.0.1", "::1", "localhost"})


class PanelServer(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.env = Path(self._tmp.name) / ".env"
        self.panel = Panel(
            AuditLog(Path(self._tmp.name) / "audit.jsonl", fsync=False),
            table="Verification Requests",
            default_view=VIEW,
            max_calls=5,
            token="test-token",
            env_path=self.env,
            force_fixtures=True,
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.panel))
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self._tmp.cleanup()

    def expect_error(self, code, fn, *args, **kwargs):
        """Assert an HTTP error and close its body, so no ResourceWarning."""
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            fn(*args, **kwargs)
        body = ctx.exception.read().decode()
        ctx.exception.close()
        self.assertEqual(ctx.exception.code, code)
        return body

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def get(self, path):
        with urllib.request.urlopen(self.url(path), timeout=5) as r:
            return r.status, r.read().decode()

    def post(self, path, body, token="test-token"):
        request = urllib.request.Request(
            self.url(path),
            data=json.dumps(body).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "X-Certa-Token": token},
        )
        with urllib.request.urlopen(request, timeout=5) as r:
            return r.status, json.loads(r.read())

    # -- authorization -------------------------------------------------

    def test_api_without_a_token_is_rejected(self):
        self.expect_error(401, self.get, "/api/plan")

    def test_api_with_a_wrong_token_is_rejected(self):
        self.expect_error(401, self.get, "/api/plan?token=wrong")

    def test_run_without_a_token_is_rejected(self):
        self.expect_error(
            401, self.post, "/api/run", {"view": VIEW, "confirm": True}, token="wrong"
        )

    def test_plan_with_the_token_works(self):
        status, body = self.get("/api/plan?token=test-token")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["call_count"], 3)

    # -- no destination can be introduced ------------------------------

    def test_run_rejects_any_destination_field(self):
        """The security property, expressed as an absence."""
        for injected in ("phone", "phones", "to", "recipients", "number", "e164"):
            body = self.expect_error(
                400, self.post, "/api/run",
                {"view": VIEW, "confirm": True, injected: "+15550100000"},
            )
            self.assertIn("only a view name", body, msg=injected)

    def test_run_requires_explicit_confirmation(self):
        for body in ({"view": VIEW}, {"view": VIEW, "confirm": False},
                     {"view": VIEW, "confirm": "yes"}):
            self.expect_error(400, self.post, "/api/run", body)

    def test_confirmed_run_is_accepted(self):
        status, body = self.post("/api/run", {"view": VIEW, "confirm": True})
        self.assertEqual(status, 202)
        self.assertTrue(body["started"])

    # -- surface -------------------------------------------------------

    def test_landing_is_served_without_a_token(self):
        status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("Certa", body)

    def test_console_shell_is_served_at_app(self):
        status, body = self.get("/app")
        self.assertEqual(status, 200)
        self.assertIn("<title>Certa</title>", body)

    def test_unauthenticated_landing_never_carries_the_token(self):
        """A request without the token must never be handed one."""
        for path in ("/", "/app", "/?token=wrong"):
            _, body = self.get(path)
            self.assertNotIn("test-token", body, msg=path)

    def test_authorised_landing_gets_a_console_link(self):
        _, body = self.get("/?token=test-token")
        self.assertIn("__CERTA__", body)
        self.assertIn("/app?token=test-token", body)

    def test_unknown_paths_are_not_found(self):
        self.expect_error(404, self.get, "/api/anything?token=test-token")

    def test_audit_endpoint_reports_the_chain(self):
        status, body = self.get("/api/audit?token=test-token")
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["ok"])

    def test_preview_only_panel_refuses_to_run(self):
        self.panel.transport = None
        with self.assertRaises(PanelError):
            self.panel.start_run(VIEW)

    # -- zero-configuration start --------------------------------------

    def test_panel_starts_useful_with_no_credentials(self):
        """First run shows the product working rather than a config error."""
        self.assertEqual(self.panel.mode, FIXTURES_MODE)
        self.assertEqual(json.loads(self.get("/api/plan?token=test-token")[1])["call_count"], 3)

    def test_config_never_returns_a_secret(self):
        from certa import config as cfg

        cfg.save(
            cfg.Config(
                airtable_token="pat_super_secret_value",
                airtable_base_id="appABC",
                calle_api_key="iams_live_secret_value",
                requester_name="Example Lending",
            ),
            self.env,
        )
        self.panel.reconfigure()
        body = self.get("/api/config?token=test-token")[1]
        self.assertNotIn("pat_super_secret_value", body)
        self.assertNotIn("iams_live_secret_value", body)
        self.assertIn("alue", body)  # last four only

    # -- setup ---------------------------------------------------------

    def test_setup_rejects_unknown_fields(self):
        body = self.expect_error(
            400, self.post, "/api/setup", {"airtable_token": "pat_x", "sneaky": "1"}
        )
        self.assertIn("unknown fields", body)

    def test_a_token_without_a_base_saves_and_reports_what_is_missing(self):
        """The base is created from the token, so requiring both would deadlock."""
        _, body = self.post("/api/setup", {"airtable_token": "pat_x"})
        self.assertIn("AIRTABLE_BASE_ID", body["missing"])
        self.assertFalse(body["can_read_table"])
        self.assertTrue(body["airtable_token"].startswith("set ("))

    def test_an_empty_setup_is_refused(self):
        self.expect_error(400, self.post, "/api/setup", {})

    def test_create_base_needs_a_token_first(self):
        body = self.expect_error(
            400, self.post, "/api/create-base", {"workspace_id": "wspAbc123"}
        )
        self.assertIn("token first", body)

    def test_create_base_rejects_unknown_fields(self):
        body = self.expect_error(
            400, self.post, "/api/create-base",
            {"workspace_id": "wspAbc123", "tables": []},
        )
        self.assertIn("unknown fields", body)

    def test_create_base_refuses_a_bad_workspace_before_any_request(self):
        self.post("/api/setup", {"airtable_token": "pat_x"})
        body = self.expect_error(
            400, self.post, "/api/create-base", {"workspace_id": "appNotAWorkspace"}
        )
        self.assertIn("workspace id", body)

    def test_setup_writes_an_owner_only_file(self):
        import stat as stat_mod

        self.post(
            "/api/setup",
            {
                "airtable_token": "pat_written",
                "airtable_base_id": "appWritten",
                "requester_name": "Example Lending",
            },
        )
        self.assertTrue(self.env.exists())
        mode = stat_mod.S_IMODE(self.env.stat().st_mode)
        self.assertEqual(mode, 0o600, f"credentials file is mode {mode:04o}")

    def test_setup_response_carries_no_secret(self):
        _, body = self.post(
            "/api/setup",
            {
                "airtable_token": "pat_response_secret",
                "airtable_base_id": "appR",
                "requester_name": "Example Lending",
            },
        )
        self.assertNotIn("pat_response_secret", json.dumps(body))
        self.assertTrue(body["airtable_token"].startswith("set ("))


if __name__ == "__main__":
    unittest.main()
