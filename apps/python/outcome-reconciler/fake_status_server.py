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
import time
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from typing import Any

FAKE_BEARER_TOKEN = "fake-status-token"

#: How long a `plan_timeout` step holds a request open. Must exceed the
#: client's --request-timeout for the client to classify it as a timeout.
DEFAULT_HANG_SECONDS = 30.0


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


def _is_status_path(path: str) -> bool:
    """Both documented read paths are served from the same scripted sequence.

    `/v1/calls/{call_id}` is the Calls surface; `/v1/goals/{goal_id}/runs/{goal_run_id}`
    is the Goal Runs surface.
    """
    if path.startswith("/v1/calls/"):
        return True
    segments = [segment for segment in path.split("?")[0].split("/") if segment]
    return (
        len(segments) == 5
        and segments[0] == "v1"
        and segments[1] == "goals"
        and segments[3] == "runs"
    )


def build_handler(state: _State, hang_seconds: float) -> type[BaseHTTPRequestHandler]:
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
            if not _is_status_path(self.path):
                self._send(404, {"error": "not found"})
                return
            if not (self.headers.get("Authorization") or "").startswith("Bearer "):
                self._send(401, {"error": "missing bearer token"})
                return

            step = state.next_step()
            if step.get("plan_timeout"):
                # Emulate a hung request by holding the connection open past the
                # client's timeout. Closing without responding instead would
                # surface as a connection reset, which a client classifies as a
                # recoverable transport error rather than a timeout — so the
                # fixture would resolve as an exhausted budget, not plan_timeout.
                time.sleep(hang_seconds)
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


def serve(
    sequence: list[dict[str, Any]],
    host: str = "127.0.0.1",
    port: int = 0,
    hang_seconds: float = DEFAULT_HANG_SECONDS,
) -> HTTPServer:
    server = ThreadingHTTPServer((host, port), build_handler(_State(sequence), hang_seconds))
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
    parser.add_argument(
        "--hang-seconds",
        type=float,
        default=DEFAULT_HANG_SECONDS,
        help=f"How long a plan_timeout step holds a request open. Default: {DEFAULT_HANG_SECONDS}.",
    )
    args = parser.parse_args()

    raw = json.loads(args.fixture.read_text(encoding="utf-8"))
    server = serve(raw.get("sequence") or [], port=args.port, hang_seconds=args.hang_seconds)
    url = base_url(server)
    print(json.dumps({"base_url": url, "reset_url": f"{url}/__reset"}), flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
