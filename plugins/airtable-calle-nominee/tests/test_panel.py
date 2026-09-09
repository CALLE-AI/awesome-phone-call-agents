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

from nominee.airtable import FixtureAirtable
from nominee.audit import AuditLog
from nominee.panel.server import LOOPBACK, Panel, PanelError, make_handler, serve
from nominee.transport import FixtureTransport

from tests.test_airtable import SCHEMA
from tests.test_runner import VIEW, consented, scenario


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
        self.panel = Panel(
            FixtureAirtable(SCHEMA, [consented()]),
            FixtureTransport(scenario()),
            AuditLog(Path(self._tmp.name) / "audit.jsonl", fsync=False),
            table="Verification Requests",
            requester_name="Meridian Lending",
            default_view=VIEW,
            max_calls=5,
            token="test-token",
            live=False,
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
            headers={"Content-Type": "application/json", "X-Nominee-Token": token},
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
        self.assertEqual(json.loads(body)["call_count"], 1)

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

    def test_index_is_served_without_a_token(self):
        status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("<title>Nominee</title>", body)

    def test_index_contains_no_secret(self):
        _, body = self.get("/")
        self.assertNotIn("test-token", body)

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


if __name__ == "__main__":
    unittest.main()
