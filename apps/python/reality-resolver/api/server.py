"""Read-only HTTP surface over the case catalog, on the standard library.

No framework: this app already serves HTTP with http.server in
fake_server.py, four endpoints do not justify a dependency tree, and
CONTRIBUTING asks contributions to install without one.

Scope of this file today, stated so the boundary is checkable rather
than assumed: it imports the case store and the serializers, and nothing
else from the app. It does not import pipeline, client, or any CALL-E
code path; it cannot place a call, cannot start a resolution, and needs
no credential to run. Importing this module starts nothing - the server
is created by create_server() and run by main().
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from api.backend import FakeCallBackend
from api.serialize import cases_payload, error_payload, health_payload, resolution_payload
from api.store import CaseNotFoundError, CaseStore, ResolutionNotFoundError, ResolutionStore
from client import CallEAPIError, parse_utc_timestamp
from fake_server import SUBJECT_CANCELLED_PHONE, SUBJECT_VOICEMAIL_PHONE
from pipeline import ResolutionRefused, ResolutionRequest, resolve

# Loopback by default and on purpose. This server has no authentication,
# so binding it to every interface would be a decision an operator makes
# explicitly, never a default they inherit.
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

# Mirrors pyproject.toml's version. Reported so a client can tell which
# engine answered; it is not a build identifier and carries no path.
ENGINE_VERSION = "0.0.0"

# There is no live mode to report yet: nothing in this server can reach a
# provider, so anything other than "fake" would be a claim the code does
# not back. The configuration seam belongs with the phase that can
# actually place a call.
MODE = "fake"

# Largest declared request body this server will read and discard before
# giving up on reusing the connection. No route reads input, so this only
# bounds how much is thrown away, never how much is processed.
MAX_DRAIN_BYTES = 1 << 20  # 1 MiB
DRAIN_CHUNK_BYTES = 64 * 1024

RESOLUTIONS_PATH = "/api/resolutions"

# Upper bound on the polling loop of one HTTP-driven resolution.
#
# Calibrated from measurement rather than preference: the slowest observed
# POST on the call-placing branch is 827 ms, under 16 concurrent requests
# against the in-process fake backend (median 379 ms loaded, 40 ms not).
# Ten seconds is roughly twelve times that worst case - room for a loaded
# machine, while still releasing a wedged request thread promptly. It also
# stays far below poll_until_terminal's 300 s warning threshold, so the
# operator-facing "still watching" path never fires on this route.
#
# Honest limit: this bounds the polling loop, not a single hung HTTP
# request. poll_until_terminal checks its deadline only between polls, and
# CallEClient retries a GET up to MAX_ATTEMPTS times with a 30 s socket
# timeout and 1+2+4 s of backoff, so one wedged socket can still cost
# about two minutes on top of this. Bounding that would mean threading a
# client timeout through ResolutionRequest - a change to pipeline.py this
# does not justify. The ceiling is lowered here, not removed.
MAX_POLL_SECONDS = 10.0

# The four outcomes the fake backend can be steered to, and the only way
# a client influences which number is dialled. It picks an outcome by
# name; the number is chosen here, from fake_server.py's own reserved
# sentinels and Ofcom's reserved drama range. A client never sends a
# phone number, so there is no request shape that reaches an arbitrary
# one - and "blocked" is not a bypass in the other direction either: it
# routes to a number with no jurisdiction mapping, and the hard gate
# refuses it for real.
SCENARIO_PHONES: dict[str, str | None] = {
    "confirmed": None,  # the case file's own number: fake server's happy path
    "cancelled": SUBJECT_CANCELLED_PHONE,
    "voicemail": SUBJECT_VOICEMAIL_PHONE,
    "blocked": "+442079460123",  # Ofcom reserved 020 7946 0xxx; no jurisdiction maps to +44
}
DEFAULT_SCENARIO = "confirmed"

# Exactly the keys a resolution request may carry. Anything else is a
# client trying to reach a knob this API does not expose - base_url,
# execute, allow_live, authorize_destination, phone - and is refused
# rather than ignored, so a mistaken client hears about it.
RESOLUTION_REQUEST_FIELDS = frozenset({"case", "scenario", "now_utc"})


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def store(self) -> CaseStore:
        return self.server.store  # type: ignore[attr-defined]

    @property
    def resolutions(self) -> ResolutionStore:
        return self.server.resolutions  # type: ignore[attr-defined]

    @property
    def backend(self) -> FakeCallBackend:
        return self.server.backend  # type: ignore[attr-defined]

    def log_message(self, *args: Any) -> None:
        """Silent, same as fake_server.py. The default writes the request
        line to stderr, which would put every requested path into
        whatever collects that stream.
        """
        return

    def _send(self, status: int, body: dict[str, Any], extra_headers: dict[str, str] | None = None) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        if self.close_connection:
            # Something upstream decided this connection cannot be reused
            # - a body that could not be drained, typically. Say so:
            # closing without the header leaves the client believing it
            # may send another request down a socket that is going away.
            self.send_header("Connection", "close")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(raw)

    def _path(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def _not_found(self) -> None:
        # Deliberately does not echo the requested path back: reflecting
        # client-controlled text into a response body is a habit worth
        # not starting, and the client already knows what it asked for.
        self._send(404, error_payload("not_found", "no route for this path"))

    def _method_not_allowed(self, allowed: str) -> None:
        self._send(
            405,
            error_payload("method_not_allowed", f"this endpoint accepts {allowed}"),
            {"Allow": allowed},
        )

    def _read_request_body(self) -> bytes:
        """Read the request body so the next request on a keep-alive
        connection is parsed from a request line rather than from
        leftover body bytes, and hand it to the route that wants it.

        Reading and draining are the same operation here, which is why
        this replaced the earlier discard-only version: POST
        /api/resolutions needs the bytes, and every other route needs
        them gone. Doing both in one place means no route can forget the
        half it does not care about.

        Neither route reads input, and skipping this was a real defect
        rather than a theoretical one: under protocol_version HTTP/1.1
        the bytes stayed in the socket, and the following request on the
        same connection was parsed starting from them - answering with
        the stdlib's HTML 501 page, with the previous body quoted back
        inside it, instead of JSON.

        Only a declared Content-Length is read. With no Content-Length
        there is nothing to drain, and reading anyway would block until
        the peer gave up. A chunked body, an unparseable length, an
        oversized one, or a client that stops sending early all close
        the connection instead - correct, and cheaper than decoding a
        transfer encoding for input no route wants.
        """
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            self.close_connection = True
            return b""
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return b""
        try:
            remaining = int(raw_length)
        except ValueError:
            self.close_connection = True
            return b""
        if remaining <= 0:
            return b""
        if remaining > MAX_DRAIN_BYTES:
            self.close_connection = True
            return b""
        chunks: list[bytes] = []
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, DRAIN_CHUNK_BYTES))
            if not chunk:
                self.close_connection = True
                return b""
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _dispatch(self, method: str) -> None:
        # Before anything else, and on every path - 200, 404, 405 and
        # 500 all leave the connection reusable only if the body is gone.
        self.body = self._read_request_body()
        path = self._path()

        # One dynamic route: /api/resolutions/{id}. Matched here rather
        # than by a pattern table, because there is exactly one and a
        # router would be more machinery than routes.
        if path.startswith(f"{RESOLUTIONS_PATH}/"):
            if method != "GET":
                self._method_not_allowed("GET")
                return
            resolution_id = path[len(RESOLUTIONS_PATH) + 1 :]
            self._respond(lambda: self.handle_get_resolution(resolution_id))
            return

        if path not in ROUTES:
            # Route first, then method: an unknown path is 404 whatever
            # the verb, and 405 is reserved for a real endpoint.
            self._not_found()
            return
        handler = ROUTES[path].get(method)
        if handler is None:
            self._method_not_allowed(", ".join(sorted(ROUTES[path])))
            return
        self._respond(lambda: handler(self))

    def _respond(self, produce: Any) -> None:
        try:
            status, body = produce() if callable(produce) else produce
        except Exception:
            # Nothing internal crosses the wire: no exception text, no
            # traceback, no file path. The operator's own logs are where
            # a failure gets diagnosed.
            self._send(500, error_payload("internal_error", "the server failed to handle this request"))
            return
        self._send(status, body)

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    # --- route handlers ------------------------------------------------

    def handle_health(self) -> tuple[int, dict[str, Any]]:
        return 200, health_payload(MODE, ENGINE_VERSION)

    def handle_cases(self) -> tuple[int, dict[str, Any]]:
        return 200, cases_payload(self.store.all())

    def handle_create_resolution(self) -> tuple[int, dict[str, Any]]:
        """Validate, hand the whole run to pipeline.resolve(), serialize
        what came back.

        This method makes no decision about the case. It does not score
        R1-R4, build a PreCallContext, run or filter compliance checks,
        or reconcile anything - resolve() is the only caller of any of
        those, here as in the CLI. Everything below is either input
        validation or translation.
        """
        try:
            payload = json.loads(self.body or b"")
        except (ValueError, UnicodeDecodeError):
            return 400, error_payload("invalid_json", "the request body is not valid JSON")
        if not isinstance(payload, dict):
            return 400, error_payload("invalid_json", "the request body must be a JSON object")

        unknown = sorted(set(payload) - RESOLUTION_REQUEST_FIELDS)
        if unknown:
            # Named rather than dropped: a client sending base_url or
            # allow_live is trying to steer something this API does not
            # steer, and silently ignoring it would hide that.
            return 422, error_payload(
                "unknown_field", f"this endpoint accepts only {sorted(RESOLUTION_REQUEST_FIELDS)}"
            )

        case_name = payload.get("case")
        if not isinstance(case_name, str) or not case_name:
            return 422, error_payload("invalid_case", "case must be a non-empty string")

        scenario = payload.get("scenario", DEFAULT_SCENARIO)
        if scenario not in SCENARIO_PHONES:
            return 422, error_payload(
                "invalid_scenario", f"scenario must be one of {sorted(SCENARIO_PHONES)}"
            )

        now_utc = None
        if "now_utc" in payload:
            if not isinstance(payload["now_utc"], str):
                return 422, error_payload("invalid_now_utc", "now_utc must be an ISO 8601 UTC string")
            try:
                # parse_utc_timestamp raises argparse.ArgumentTypeError,
                # not ValueError - it was written for an argparse type=.
                # Its message quotes the offending input back, which is
                # why the reply below is this module's own text and not
                # str(exc): nothing a client sent is echoed to it.
                now_utc = parse_utc_timestamp(payload["now_utc"])
            except (ValueError, argparse.ArgumentTypeError):
                return 422, error_payload("invalid_now_utc", "now_utc must be an ISO 8601 UTC string")

        try:
            case_path = self.store.path_for(case_name)
        except CaseNotFoundError:
            return 404, error_payload("case_not_found", "no such case")

        # Everything a client cannot influence is fixed here. base_url
        # comes from the backend this process started, allow_live is
        # False and there is no code path that sets it otherwise, and
        # execute targets that same fake backend - the alternative,
        # dry-run, stops before a verdict exists and would leave the
        # cockpit with nothing to show.
        request = ResolutionRequest(
            case_path=str(case_path),
            base_url=self.backend.base_url,
            execute=True,
            allow_live=False,
            authorize_destination=None,
            phone_override=SCENARIO_PHONES[scenario],
            now_utc=now_utc,
            poll_interval_seconds=0.01,
            poll_timeout_seconds=MAX_POLL_SECONDS,
        )

        resolution_id = self.resolutions.new_id()
        try:
            resolution = resolve(request)
        except (CallEAPIError, TimeoutError, RuntimeError, ResolutionRefused):
            # A technical failure, and it stays one: no Resolution means
            # no verdict, and the client is told the run failed rather
            # than handed an outcome nobody computed.
            return 502, error_payload("resolution_failed", "the resolution could not be completed")

        body = resolution_payload(resolution, resolution_id, "completed", MODE)
        self.resolutions.put(resolution_id, body)
        return 201, body

    def handle_get_resolution(self, resolution_id: str) -> tuple[int, dict[str, Any]]:
        try:
            return 200, self.resolutions.get(resolution_id)
        except ResolutionNotFoundError:
            return 404, error_payload("resolution_not_found", "no such resolution")


ROUTES: dict[str, dict[str, Any]] = {
    "/api/health": {"GET": Handler.handle_health},
    "/api/cases": {"GET": Handler.handle_cases},
    RESOLUTIONS_PATH: {"POST": Handler.handle_create_resolution},
}


def create_server(
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    store: CaseStore | None = None,
    backend: FakeCallBackend | None = None,
    resolutions: ResolutionStore | None = None,
) -> ThreadingHTTPServer:
    """Build a server without starting it, and without starting the
    backend either.

    The two lifecycles stay separate deliberately: whoever starts the
    fake backend stops it. Wiring its start into this function would
    make a forgotten stop invisible, and would tie a listener nobody
    named to the lifetime of an HTTP server that may outlive it.
    """
    server = ThreadingHTTPServer((host, port), Handler)
    server.store = store or CaseStore()  # type: ignore[attr-defined]
    server.backend = backend or FakeCallBackend()  # type: ignore[attr-defined]
    server.resolutions = resolutions or ResolutionStore()  # type: ignore[attr-defined]
    return server


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="HTTP surface for Reality Resolver, against an in-process fake CALL-E "
        "backend. Places no real calls: there is no live mode to select."
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)

    backend = FakeCallBackend()
    backend.start()
    server = create_server(args.host, args.port, backend=backend)
    host, port = server.server_address[:2]
    print(f"Reality Resolver API on http://{host}:{port} (mode={MODE}, no real call can be placed)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        server.server_close()
        backend.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
