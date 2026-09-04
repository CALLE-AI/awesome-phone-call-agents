"""Run the double as a real HTTP server.

    python -m calle_double.server --port 8787

Then point anything at it:

    export CALLE_BASE_URL=http://127.0.0.1:8787
    export CALLE_API_KEY=iams_test_anything

The in-process transport is faster and is what the test suite uses. This exists for the
cases the transport cannot cover: a client in another language, a judge who wants to
curl the API by hand, or an integration test that runs the application as a subprocess.

Standard library only, so `python -m calle_double.server` works on a clean checkout with
nothing installed.
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .engine import CalleDouble, DoubleError, Outcome

_CALL_EVENTS = re.compile(r"^/v1/calls/([^/]+)/events$")
_CALL = re.compile(r"^/v1/calls/([^/]+)$")


class _Handler(BaseHTTPRequestHandler):
    double: CalleDouble
    require_auth: bool = True

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:  # quieter than the default
        if self.server.verbose:  # type: ignore[attr-defined]
            super().log_message(fmt, *args)

    # -- helpers ---------------------------------------------------------

    def _send(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, err: DoubleError) -> None:
        self._send(err.status_code, err.body())

    def _authorized(self) -> bool:
        if not self.require_auth:
            return True
        header = self.headers.get("Authorization", "")
        return header.startswith("Bearer ") and len(header) > len("Bearer ")

    def _unauthorized(self) -> None:
        self._send(401, {"error": {"code": "unauthorized",
                                   "message": "Invalid or missing API key.",
                                   "details": {}}})

    # -- routes ----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        if not self._authorized():
            return self._unauthorized()
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)

        if path == "/v1/goals":
            return self._send(200, {"object": "list", "data": [], "next_cursor": None})

        match = _CALL_EVENTS.match(path)
        if match:
            try:
                limit = query.get("limit", [None])[0]
                return self._send(200, self.double.list_events(
                    match.group(1),
                    cursor=query.get("cursor", [None])[0],
                    limit=int(limit) if limit else None,
                ))
            except DoubleError as err:
                return self._error(err)

        match = _CALL.match(path)
        if match:
            try:
                return self._send(200, self.double.get_call(match.group(1)))
            except DoubleError as err:
                return self._error(err)

        self._send(404, {"error": {"code": "not_found",
                                   "message": f"No route for GET {path}.",
                                   "details": {}}})

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            return self._unauthorized()
        parsed = urlparse(self.path)
        if parsed.path != "/v1/calls":
            return self._send(404, {"error": {"code": "not_found",
                                              "message": f"No route for POST {parsed.path}.",
                                              "details": {}}})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._error(DoubleError("invalid_request", "Body is not valid JSON."))

        try:
            created = self.double.create_call(
                task=body.get("task", ""),
                recipients=body.get("recipients"),
                result_schema=body.get("result_schema"),
                recipient_result_schema=body.get("recipient_result_schema"),
                metadata=body.get("metadata"),
                webhook_url=body.get("webhook_url"),
                idempotency_key=self.headers.get("Idempotency-Key"),
            )
        except DoubleError as err:
            return self._error(err)
        self._send(201, created)


def deliver_webhooks(double: CalleDouble, *, timeout: float = 3.0) -> list[str]:
    """POST any queued webhooks to their URLs and return the ones delivered.

    Deliveries are unsigned, matching CALL-E today: the SDK's own docstrings say
    "current CALL-E webhooks are unsigned" and that `verify`/`unwrap` are deprecated. The
    double reproduces that rather than the nicer behaviour, because code written against
    this should be forced to handle the world as it is and re-fetch before acting.
    """
    delivered: list[str] = []
    pending, double.delivered_webhooks = double.delivered_webhooks, []
    for hook in pending:
        payload = json.dumps({"type": hook["type"], "data": hook["data"]}).encode("utf-8")
        request = urllib.request.Request(
            hook["url"], data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout):
                delivered.append(hook["type"])
        except Exception:  # a receiver being down is not the double's problem
            double.delivered_webhooks.append(hook)
    return delivered


def serve(double: CalleDouble | None = None, *, host: str = "127.0.0.1",
          port: int = 8787, verbose: bool = False) -> ThreadingHTTPServer:
    """Start the server and return it. Caller owns shutdown()."""
    engine = double or CalleDouble()
    handler = type("_Bound", (_Handler,), {"double": engine})
    server = ThreadingHTTPServer((host, port), handler)
    server.verbose = verbose  # type: ignore[attr-defined]
    server.double = engine  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="A CALL-E that dials nobody.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--every-call-fails", action="store_true",
        help="Make every recipient go unanswered, for exercising failure paths.",
    )
    args = parser.parse_args()

    double = CalleDouble()
    if args.every_call_fails:
        double.set_default_outcome(Outcome.no_answer())

    server = serve(double, host=args.host, port=args.port, verbose=args.verbose)
    print(f"CALL-E double listening on http://{args.host}:{args.port}")
    print("  export CALLE_BASE_URL=http://%s:%d" % (args.host, args.port))
    print("  export CALLE_API_KEY=iams_test_anything")
    print("No call placed by this process will ever reach a phone. Ctrl-C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
