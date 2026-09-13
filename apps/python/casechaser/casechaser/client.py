"""CALL-E Developer API client (standard library only) and a local fake server for no-call runs.

Live mode: POST https://api.heycall-e.com/v1/calls with a bearer key, then GET /v1/calls/{id}
until the call task is terminal. Fixture mode: the same client pointed at FakeCalleServer, which
returns canned transcripts and structured results so every workflow path runs offline.
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
from urllib.parse import urlparse

TERMINAL = ("completed", "failed", "canceled")
OFFICIAL_ORIGIN = "https://api.heycall-e.com"
DEFAULT_BASE_URL = OFFICIAL_ORIGIN
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


class CalleError(RuntimeError):
    pass


def check_origin(base_url: str, allow_local_fake: bool) -> str:
    """The bearer key is only ever sent to the official HTTPS origin, or to a loopback fake in fixture mode."""
    p = urlparse(base_url)
    origin = f"{p.scheme}://{p.netloc}"
    if p.path not in ("", "/") or p.query or p.fragment or p.username or p.password:
        raise CalleError(f"CALLE_BASE_URL must be a bare origin, got {base_url!r}")
    if origin == OFFICIAL_ORIGIN:
        return origin
    if allow_local_fake and p.scheme == "http" and p.hostname in LOOPBACK_HOSTS:
        return origin
    raise CalleError(f"refusing to send the API key to {origin!r}; live calls only go to {OFFICIAL_ORIGIN}")


class CalleClient:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, timeout: int = 30, allow_local_fake: bool = False):
        if not api_key:
            raise CalleError("CALLE_API_KEY is not set. Use --mode preview or --mode fixture for a no-call run.")
        self.api_key = api_key
        self.base_url = check_origin(base_url, allow_local_fake)
        self.timeout = timeout

    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            raise CalleError(f"CALL-E API {method} {path} failed: HTTP {e.code} {detail}") from None
        except urllib.error.URLError as e:
            raise CalleError(f"CALL-E API unreachable at {self.base_url}: {e.reason}") from None

    def create_call(self, request: Dict[str, Any], idempotency_key: str) -> Dict[str, Any]:
        return self._request("POST", "/v1/calls", request, {"Idempotency-Key": idempotency_key})

    def get_call(self, call_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/v1/calls/{call_id}")

    def wait(self, call_id: str, poll_seconds: float = 5.0, max_seconds: float = 1800.0) -> Dict[str, Any]:
        deadline = time.time() + max_seconds
        while True:
            call = self.get_call(call_id)
            if call.get("status") in TERMINAL:
                return call
            if time.time() > deadline:
                raise CalleError(f"call {call_id} still {call.get('status')} after {int(max_seconds)} s")
            time.sleep(poll_seconds)


# ----------------------------------------------------------------------------------------------
# Fake server
# ----------------------------------------------------------------------------------------------

def load_fixture(fixtures_dir: str, scenario: str) -> Dict[str, Any]:
    path = os.path.join(fixtures_dir, f"{scenario}.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class FakeCalleServer:
    """Minimal stand-in for the CALL-E Calls API.

    Scenario selection: the request's metadata.fixture_scenario, else the server default.
    The first GET returns in_progress, the second returns the terminal fixture, so polling code
    is exercised the same way as against the real API.
    """

    def __init__(self, fixtures_dir: str, default_scenario: str = "first_call_commitment", host: str = "127.0.0.1", port: int = 0):
        self.fixtures_dir = fixtures_dir
        self.default_scenario = default_scenario
        self.calls: Dict[str, Dict[str, Any]] = {}
        self.polls: Dict[str, int] = {}
        self.idempotency: Dict[str, str] = {}
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # silence
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
                req = json.loads(self.rfile.read(length) or b"{}")
                key = self.headers.get("Idempotency-Key")
                if key and key in server.idempotency:
                    return self._send(200, server.calls[server.idempotency[key]])
                scenario = (req.get("metadata") or {}).get("fixture_scenario") or server.default_scenario
                fixture = load_fixture(server.fixtures_dir, scenario)
                call_id = f"call_fake_{len(server.calls) + 1:04d}"
                terminal = dict(fixture)
                terminal.update({"id": call_id, "object": "call_task", "task": req.get("task", ""), "metadata": req.get("metadata", {}),
                                 "created_at": "2026-09-02T09:00:00Z", "completed_at": "2026-09-02T09:07:00Z"})
                server.calls[call_id] = terminal
                server.polls[call_id] = 0
                if key:
                    server.idempotency[key] = call_id
                pending = {"id": call_id, "object": "call_task", "status": "queued", "task": req.get("task", ""),
                           "recipients": [], "structured_result": None, "summary": None, "task_completed": None,
                           "completion_confidence": None, "evidence": [], "metadata": req.get("metadata", {}),
                           "failure_code": None, "failure_message": None, "created_at": "2026-09-02T09:00:00Z", "completed_at": None}
                self._send(202, pending)

            def do_GET(self) -> None:
                if not self.path.startswith("/v1/calls/"):
                    return self._send(404, {"error": {"code": "not_found"}})
                call_id = self.path.split("/v1/calls/")[1].split("/")[0]
                if call_id not in server.calls:
                    return self._send(404, {"error": {"code": "not_found"}})
                server.polls[call_id] += 1
                if server.polls[call_id] == 1:
                    interim = dict(server.calls[call_id])
                    interim.update({"status": "in_progress", "structured_result": None, "summary": None, "completed_at": None})
                    return self._send(200, interim)
                self._send(200, server.calls[call_id])

        self.httpd = ThreadingHTTPServer((host, port), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        host, port = self.httpd.server_address[:2]
        return f"http://{host}:{port}"

    def start(self) -> "FakeCalleServer":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
