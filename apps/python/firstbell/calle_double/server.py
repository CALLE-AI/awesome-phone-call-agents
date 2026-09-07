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

## Bind a scenario, or every call answers the same way

With nothing bound, every recipient gets this double's fallback answer, which is a
two-turn transcript and `{"ok": true}`. That is fine for a client testing plumbing and
wrong for anything with a result schema: a consumer that requires its own fields sees
every call come back missing them.

    python -m calle_double.server --outcomes examples/demo-outcomes.json

The file is `{"numbers": {"+1555...": {...}}}` with an optional `"default"`. Each entry
takes `answers_on`, `structured_result`, `transcript`, `failure_code`, `sip_code` and
`summary`, which are the fields of `Outcome`, and an unknown key is refused rather than
ignored. `firstbell` ships its demonstration scenario in that format, exported from the
same module the in-process run applies, so the two ways of running it produce the same
morning rather than two different ones.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .engine import CalleDouble, DoubleError, Outcome, ScenarioError

_CALL_EVENTS = re.compile(r"^/v1/calls/([^/]+)/events$")
_CALL = re.compile(r"^/v1/calls/([^/]+)$")


class _Handler(BaseHTTPRequestHandler):
    double: CalleDouble

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


def is_loopback(host: str) -> bool:
    """Is this address one only the machine itself can reach?

    Anything that will not parse as an address is treated as reachable from elsewhere.
    That is the safe direction to be wrong in: a hostname this cannot read is refused and
    the operator sees why, rather than opened and nobody told.
    """
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def refuse_an_open_bind(host: str, acknowledged: bool) -> None:
    """Make an open bind a decision rather than a default.

    `_authorized` accepts any non-empty bearer token, which is correct for a double: a
    double that demanded a real key would not be usable without an account, and that is
    the whole point of it. It also means the only thing keeping this server private is
    the interface it listens on. An operator reaching it from a phone or a container
    reaches for `--host 0.0.0.0` and gets a service anyone on that network can create
    calls against and read every transcript out of. So say so, once, and let them say
    they meant it.
    """
    if acknowledged or is_loopback(host):
        return
    raise SystemExit(
        f"--host {host} would put this server on an interface other machines can reach, "
        "and it accepts any bearer token at all, on purpose, so that it works without a "
        "CALL-E account. Anyone who can reach it can place calls against it and read "
        "back every transcript it holds. Nothing here dials a phone and none of the data "
        "is real, which is why this is a refusal you can override rather than a wall: "
        "add --i-know-this-is-open if a reachable double is what you want."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="A CALL-E that dials nobody.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--i-know-this-is-open", action="store_true",
        help="Permit a bind other machines can reach. See --host.",
    )
    parser.add_argument(
        "--every-call-fails", action="store_true",
        help="Make every recipient go unanswered, for exercising failure paths.",
    )
    parser.add_argument(
        "--outcomes", metavar="FILE",
        help="JSON scenario to bind, so calls answer the way a consumer's schema "
             "expects. Without it every recipient gets this double's fallback answer.",
    )
    args = parser.parse_args()
    refuse_an_open_bind(args.host, args.i_know_this_is_open)

    double = CalleDouble()
    if args.every_call_fails:
        double.set_default_outcome(Outcome.no_answer())
    bound = 0
    if args.outcomes:
        path = Path(args.outcomes)
        if not path.is_file():
            raise SystemExit(f"no outcomes file at {path}")
        try:
            bound = double.load_outcomes(
                json.loads(path.read_text(encoding="utf-8")), str(path))
        except ScenarioError as bad:
            # Printed as one line rather than a traceback.
            # A scenario that will not load is a file somebody has to edit, and a stack
            # trace is the wrong instrument for telling them which line of it.
            raise SystemExit(f"{bad}")

    server = serve(double, host=args.host, port=args.port, verbose=args.verbose)
    # The port the socket actually got, not the one asked for. `--port 0` means the
    # operating system picks, which is the sensible thing for a script to pass and used to
    # print `http://127.0.0.1:0` in both the banner and the export line: an address
    # nothing can reach, printed as though it were the address to use.
    port = server.server_address[1]
    print(f"CALL-E double listening on http://{args.host}:{port}")
    if bound:
        print(f"  {bound} number(s) bound from {args.outcomes}")
    elif not args.every_call_fails:
        print("  no scenario bound: every recipient answers with this double's fallback,")
        print("  which is {\"ok\": true} and fails a consumer that has a result schema.")
        print("  Pass --outcomes FILE to bind one.")
    print("  export CALLE_BASE_URL=http://%s:%d" % (args.host, port))
    print("  export CALLE_API_KEY=iams_test_anything")
    print("No call placed by this process will ever reach a phone. Ctrl-C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
