"""CALL-E Developer API client, and a local fake of it for no-call runs.

Live mode posts to ``https://api.heycall-e.com/v1/calls`` with a bearer key and
polls ``GET /v1/calls/{id}`` until the task is terminal. Fixture mode points the
same client at ``FakeCalleServer``, so the parsing, polling, idempotency, and
verification paths that run offline are the paths that run against the real API.

The bearer key is only ever sent to the official origin, or to a loopback
address in fixture mode. A ``TRUNKLINE_BASE_URL`` pointing anywhere else is
refused rather than honoured.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import quote, urlparse

OFFICIAL_ORIGIN = "https://api.heycall-e.com"
TERMINAL_STATUSES = ("completed", "failed", "canceled", "cancelled")
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")

# CALL-E recommends waiting about 60 seconds after a call starts before the
# first poll, then every 5 to 10 seconds until the status is terminal.
FIRST_POLL_DELAY_SECONDS = 60.0
POLL_INTERVAL_SECONDS = 8.0


class CalleError(RuntimeError):
    pass


class _OriginLockedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Allow redirects only while the bearer credential stays on its origin."""

    def __init__(self, allowed_origin: str) -> None:
        super().__init__()
        self.allowed_origin = allowed_origin

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        redirect_origin = "%s://%s" % (parsed.scheme, parsed.netloc)
        if redirect_origin != self.allowed_origin:
            raise CalleError("refusing a CALL-E redirect beyond the approved origin")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def check_origin(base_url: str, allow_local_fake: bool) -> str:
    parsed = urlparse(base_url)
    origin = "%s://%s" % (parsed.scheme, parsed.netloc)
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise CalleError("base url must be a bare origin, got %r" % base_url)
    if parsed.username or parsed.password:
        raise CalleError("base url must not carry credentials")
    if origin == OFFICIAL_ORIGIN:
        return origin
    if allow_local_fake and parsed.scheme == "http" and parsed.hostname in LOOPBACK_HOSTS:
        return origin
    raise CalleError(
        "refusing to send the CALL-E key to %r; live calls only go to %s" % (origin, OFFICIAL_ORIGIN)
    )


class CalleClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = OFFICIAL_ORIGIN,
        timeout: int = 30,
        allow_local_fake: bool = False,
    ) -> None:
        if not api_key:
            raise CalleError(
                "CALLE_API_KEY is not set. Use --mode preview or --mode fixture for a no-call run."
            )
        self.api_key = api_key
        self.base_url = check_origin(base_url, allow_local_fake)
        self.timeout = timeout
        self._opener = urllib.request.build_opener(_OriginLockedRedirectHandler(self.base_url))

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(self.base_url + path, data=data, method=method)
        request.add_header("Authorization", "Bearer %s" % self.api_key)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                try:
                    payload = json.loads(response.read().decode("utf-8") or "{}")
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise CalleError("CALL-E returned an invalid JSON response") from None
                if not isinstance(payload, dict):
                    raise CalleError("CALL-E returned an invalid JSON object")
                return payload
        except urllib.error.HTTPError as error:
            error.close()
            raise CalleError("CALL-E request failed with HTTP %s" % error.code) from None
        except urllib.error.URLError:
            raise CalleError("CALL-E request failed before a response was received") from None
        except (TimeoutError, OSError):
            raise CalleError("CALL-E request failed before a response was received") from None

    def create_call(self, request: Dict[str, Any], idempotency_key: str) -> Dict[str, Any]:
        return self._request("POST", "/v1/calls", request, {"Idempotency-Key": idempotency_key})

    def get_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("GET", "/v1/calls/%s" % quote(str(call_id), safe=""))

    def wait(
        self,
        call_id: str,
        first_delay: float = FIRST_POLL_DELAY_SECONDS,
        poll_seconds: float = POLL_INTERVAL_SECONDS,
        max_seconds: float = 2700.0,
        sleep=time.sleep,
    ) -> Dict[str, Any]:
        """Poll until terminal. A payer call including hold can run past 40 minutes."""
        deadline = time.time() + max_seconds
        if first_delay > 0:
            sleep(min(first_delay, max_seconds))
        while True:
            call = self.get_call(call_id)
            if str(call.get("status", "")).lower() in TERMINAL_STATUSES:
                return call
            if time.time() > deadline:
                raise CalleError(
                    "CALL-E call has not reached a terminal status after %d seconds; "
                    "resume with `trunkline reconcile`" % int(max_seconds)
                )
            sleep(poll_seconds)


# ---------------------------------------------------------------------------
# Local fake
# ---------------------------------------------------------------------------

def load_fixture(fixtures_dir: str, scenario: str) -> Dict[str, Any]:
    path = os.path.join(fixtures_dir, "%s.json" % scenario)
    if not os.path.exists(path):
        raise CalleError("no fixture named %r in %s" % (scenario, fixtures_dir))
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def available_fixtures(fixtures_dir: str) -> list:
    if not os.path.isdir(fixtures_dir):
        return []
    return sorted(
        name[:-5] for name in os.listdir(fixtures_dir) if name.endswith(".json")
    )


class FakeCalleServer:
    """A stand-in for the CALL-E Calls API backed by committed fixtures.

    The scenario comes from the request's ``metadata.fixture_scenario``, else the
    server default. The first poll returns ``in_progress`` and the second returns
    the terminal payload, so polling behaves as it does against the real service.
    """

    def __init__(
        self,
        fixtures_dir: str,
        default_scenario: str = "claim_status_paid",
        host: str = "127.0.0.1",
        port: int = 0,
    ) -> None:
        self.fixtures_dir = fixtures_dir
        self.default_scenario = default_scenario
        self.calls: Dict[str, Dict[str, Any]] = {}
        self.polls: Dict[str, int] = {}
        self.idempotency: Dict[str, str] = {}
        self.received_tasks: Dict[str, str] = {}
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def _send(self, code: int, payload: Dict[str, Any]) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                if self.path != "/v1/calls":
                    return self._send(404, {"error": {"code": "not_found"}})
                if not self.headers.get("Authorization", "").startswith("Bearer "):
                    return self._send(401, {"error": {"code": "unauthorized"}})
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                key = self.headers.get("Idempotency-Key")
                if key and key in server.idempotency:
                    return self._send(200, server.calls[server.idempotency[key]])
                metadata = payload.get("metadata") or {}
                scenario = metadata.get("fixture_scenario") or server.default_scenario
                fixture = load_fixture(server.fixtures_dir, scenario)
                call_id = "call_fixture_%04d" % (len(server.calls) + 1)
                terminal = dict(fixture)
                terminal.update({
                    "id": call_id,
                    "object": "call_task",
                    "metadata": metadata,
                    "created_at": "2026-09-09T13:00:00Z",
                    "completed_at": "2026-09-09T13:41:00Z",
                })
                server.calls[call_id] = terminal
                server.polls[call_id] = 0
                server.received_tasks[call_id] = payload.get("task", "")
                if key:
                    server.idempotency[key] = call_id
                self._send(202, {
                    "id": call_id,
                    "object": "call_task",
                    "status": "queued",
                    "structured_result": None,
                    "recipients": [],
                    "metadata": metadata,
                    "created_at": "2026-09-09T13:00:00Z",
                    "completed_at": None,
                })

            def do_GET(self) -> None:
                if not self.path.startswith("/v1/calls/"):
                    return self._send(404, {"error": {"code": "not_found"}})
                call_id = self.path.split("/v1/calls/", 1)[1].split("/")[0]
                if call_id not in server.calls:
                    return self._send(404, {"error": {"code": "not_found"}})
                server.polls[call_id] += 1
                if server.polls[call_id] == 1:
                    interim = dict(server.calls[call_id])
                    interim.update({
                        "status": "in_progress",
                        "structured_result": None,
                        "completed_at": None,
                    })
                    return self._send(200, interim)
                self._send(200, server.calls[call_id])

        self.httpd = ThreadingHTTPServer((host, port), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        host, port = self.httpd.server_address[:2]
        return "http://%s:%s" % (host, port)

    def start(self) -> "FakeCalleServer":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def __enter__(self) -> "FakeCalleServer":
        return self.start()

    def __exit__(self, *exc: Any) -> None:
        self.stop()
