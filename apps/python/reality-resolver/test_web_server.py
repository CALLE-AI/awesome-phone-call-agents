"""End-to-end tests for web_server.py against fake_server.py only.

No test in this file ever targets api.heycall-e.com or sets
--allow-live to True with a real base_url - every WebServerHandle here
is pointed at a FakeCalleServer's base_url.
"""

from __future__ import annotations

import threading
from http.client import HTTPConnection
from urllib.parse import urlencode

from client import MAX_BUSINESS_CONTEXT_CHARS
from fake_server import FakeCalleServer
from web_server import Handler, parse_server_args

from http.server import ThreadingHTTPServer

US_PHONE = "+12025550123"  # NANP reserved block NPA-555-01XX
FR_PHONE = "+33639980456"  # ARCEP Numbering Plan Art. 2.5.12 reserved mobile block "06 39 98"
OPERATOR_TASK = "Call the recipient and find out why they are calling in."

US_COMPLIANT_FIELDS = {
    "consent_obtained": "1",
    "consent_timestamp": "2026-08-20T12:00:00Z",
    "dnc_checked": "1",
    "recipient_timezone": "America/New_York",
    "now_utc": "2026-08-25T14:00:00Z",  # 10:00 local NY, Tuesday, within 8-21
}
FR_COMPLIANT_FIELDS = {
    "consent_obtained": "1",
    "dnc_checked": "1",
    "gdpr_basis_documented": "1",
    "recipient_timezone": "Europe/Paris",
    "now_utc": "2026-08-25T09:00:00Z",  # 11:00 local Paris, Tuesday morning window
}


class WebServerHandle:
    """Context manager running web_server.py's Handler on a random
    localhost port, pointed at a given base_url, for the test's lifetime.
    """

    def __init__(self, base_url: str, allow_live: bool = False) -> None:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.web_base_url = base_url  # type: ignore[attr-defined]
        self._server.web_allow_live = allow_live  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True)

    @property
    def host_port(self) -> tuple[str, int]:
        host, port = self._server.server_address[:2]
        return host, port

    def __enter__(self) -> "WebServerHandle":
        self._thread.start()
        return self

    def __exit__(self, *args) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2)

    def get(self, path: str = "/") -> tuple[int, str]:
        host, port = self.host_port
        conn = HTTPConnection(host, port, timeout=30)
        try:
            conn.request("GET", path)
            response = conn.getresponse()
            return response.status, response.read().decode("utf-8")
        finally:
            conn.close()

    def post_form(self, fields: dict[str, str]) -> tuple[int, str]:
        host, port = self.host_port
        body = urlencode(fields).encode("utf-8")
        conn = HTTPConnection(host, port, timeout=30)
        try:
            conn.request(
                "POST",
                "/",
                body=body,
                headers={"Content-Type": "application/x-www-form-urlencoded", "Content-Length": str(len(body))},
            )
            response = conn.getresponse()
            return response.status, response.read().decode("utf-8")
        finally:
            conn.close()


def test_get_form_page_lists_expected_fields() -> None:
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        status, body = web.get("/")
        assert status == 200
        for field in (
            'name="phone"',
            'name="task"',
            'name="consent_obtained"',
            'name="consent_timestamp"',
            'name="dnc_checked"',
            'name="gdpr_basis_documented"',
            'name="recipient_timezone"',
            'name="intends_to_record"',
            'name="business_context"',
            'name="entity_name"',
            'name="agent_name"',
            'name="mode"',
        ):
            assert field in body


def test_post_blocked_context_shows_reasons_and_sends_nothing() -> None:
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        status, body = web.post_form({"phone": FR_PHONE, "task": OPERATOR_TASK, "mode": "dry_run"})
        assert status == 200
        assert "Allowed: False" in body
        assert "eu_common -&gt; fr" in body or "eu_common -> fr" in body
        assert server.creates == 0


def test_post_us_compliant_dry_run_shows_region_us() -> None:
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        fields = {"phone": US_PHONE, "task": OPERATOR_TASK, "mode": "dry_run", **US_COMPLIANT_FIELDS}
        status, body = web.post_form(fields)
        assert status == 200
        assert "Allowed: True" in body
        assert '&quot;region&quot;: &quot;US&quot;' in body
        assert server.creates == 0


def test_post_fr_compliant_execute_places_call_and_shows_result() -> None:
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        fields = {"phone": FR_PHONE, "task": OPERATOR_TASK, "mode": "execute", **FR_COMPLIANT_FIELDS}
        status, body = web.post_form(fields)

        assert status == 200
        assert "Allowed: True" in body
        assert server.creates == 1
        assert "fake dev key, not a real credential" in body
        # Masked phone present, full number absent, everywhere in the page.
        assert FR_PHONE not in body
        assert "+...0456" in body
        assert "has no cancel endpoint" in body
        assert "C31" in body
        assert "manipulation_attempt_detected" in body


def test_post_with_business_context_appears_in_request_body() -> None:
    business_context = "Bright Smile Dental is open Monday-Friday 8am-5pm."
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        fields = {"phone": FR_PHONE, "task": OPERATOR_TASK, "mode": "dry_run", "business_context": business_context}
        status, body = web.post_form(fields)
        assert status == 200
        assert business_context in body


def test_post_business_context_over_limit_returns_400() -> None:
    oversized = "a" * (MAX_BUSINESS_CONTEXT_CHARS + 1)
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        fields = {"phone": FR_PHONE, "task": OPERATOR_TASK, "mode": "dry_run", "business_context": oversized}
        status, body = web.post_form(fields)
        assert status == 400
        assert str(MAX_BUSINESS_CONTEXT_CHARS + 1) in body
        assert server.creates == 0


def test_post_escapes_html_in_task_field() -> None:
    with FakeCalleServer() as server, WebServerHandle(server.base_url) as web:
        malicious_task = "<script>alert(1)</script>"
        status, body = web.post_form({"phone": FR_PHONE, "task": malicious_task, "mode": "dry_run"})
        assert status == 200
        assert "<script>alert(1)</script>" not in body
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in body


def test_server_without_allow_live_still_executes_against_fake_base_url() -> None:
    """--allow-live only matters when base_url is the real API - a server
    started without it must still execute fully against a fake base_url,
    matching the CLI's own resolve_api_key behavior.
    """
    with FakeCalleServer() as server, WebServerHandle(server.base_url, allow_live=False) as web:
        fields = {"phone": FR_PHONE, "task": OPERATOR_TASK, "mode": "execute", **FR_COMPLIANT_FIELDS}
        status, body = web.post_form(fields)
        assert status == 200
        assert "Created call" in body
        assert server.creates == 1


def test_parse_server_args_port_defaults_from_env(monkeypatch) -> None:
    monkeypatch.setenv("PORT", "9999")
    args = parse_server_args([])
    assert args.port == 9999


def test_parse_server_args_port_defaults_to_8000_without_env(monkeypatch) -> None:
    monkeypatch.delenv("PORT", raising=False)
    args = parse_server_args([])
    assert args.port == 8000
