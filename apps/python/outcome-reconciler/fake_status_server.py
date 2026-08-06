"""A local fake CALL-E status server for tests and demos.

Serves scripted status sequences over real HTTP so the REST client path can be
exercised without credentials, a network, or a real call. It places no calls and
knows nothing about telephony.

Started as a subprocess, it prints one JSON line on stdout describing where it
is listening, matching the convention used by `apps/shared/fake-mcp-broker-server.mjs`:

    {"base_url": "http://127.0.0.1:54321", "reset_url": "..."}

Run directly to serve a fixture:

    python fake_status_server.py --fixture fixtures/happy.json
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

FAKE_BEARER_TOKEN = "fake-status-token"


class _State:
    def __init__(self, sequence: list[dict[str, Any]]) -> None:
        self.sequence = sequence
        self.cursor = 0
        self.lock = threading.Lock()

    def next_step(self) -> dict[str, Any]:
        with self.lock:
            index = min(self.cursor, len(self.sequence) - 1)
            self.cursor += 1
            return self.sequence[index]

    def reset(self) -> None:
        with self.lock:
            self.cursor = 0


def build_handler(state: _State) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:
            """Silence request logging; test output stays readable."""

        def _send(self, code: int, body: dict[str, Any]) -> None:
            encoded = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            if self.path == "/__reset":
                state.reset()
                self._send(200, {"ok": True})
                return
            self._send(404, {"error": "not found"})

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            if not self.path.startswith("/v1/calls/"):
                self._send(404, {"error": "not found"})
                return
            if not (self.headers.get("Authorization") or "").startswith("Bearer "):
                self._send(401, {"error": "missing bearer token"})
                return

            step = state.next_step()
            if step.get("plan_timeout"):
                # Emulate a hung request: close without responding.
                self.close_connection = True
                return
            if step.get("transport_error"):
                self._send(502, {"error": str(step["transport_error"])})
                return
            payload = step.get("payload")
            if payload is None:
                self._send(500, {"error": "fixture step declared no payload"})
                return
            self._send(200, payload)

    return Handler


def serve(sequence: list[dict[str, Any]], host: str = "127.0.0.1", port: int = 0) -> HTTPServer:
    server = HTTPServer((host, port), build_handler(_State(sequence)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def base_url(server: HTTPServer) -> str:
    host, port = server.server_address[0], server.server_address[1]
    return f"http://{host}:{port}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Local fake CALL-E status server. Places no calls.")
    parser.add_argument("--fixture", type=Path, required=True, help="Fixture JSON to serve.")
    parser.add_argument("--port", type=int, default=0, help="Port to bind. Default: an ephemeral port.")
    args = parser.parse_args()

    raw = json.loads(args.fixture.read_text(encoding="utf-8"))
    server = serve(raw.get("sequence") or [], port=args.port)
    url = base_url(server)
    print(json.dumps({"base_url": url, "reset_url": f"{url}/__reset"}), flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
