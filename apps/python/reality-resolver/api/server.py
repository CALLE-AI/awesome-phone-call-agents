"""HTTP surface over the case catalog and resolutions, on the standard library.

No framework: this app already serves HTTP with http.server in
fake_server.py, four endpoints do not justify a dependency tree, and
CONTRIBUTING asks contributions to install without one.

Scope of this file, stated so the boundary is checkable rather than
assumed: it validates input, seeds an entry, hands the run to
pipeline.resolve() on a worker, and serves what the store holds. It
scores no rule, builds no compliance context, reconciles nothing and
constructs no provider client - resolve() is the only caller of any of
those, here as in the CLI, and a test scans this file to keep it that
way. Live execution requires an explicit per-request credential and
destination authorization.

Importing this module starts nothing: the server is created by
create_server(), the fake backend and the worker pool are started and
stopped by whoever creates them, and main() does all three in order.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from api.backend import FakeCallBackend
from api.progress import StoreObserver
from api.serialize import case_summary, cases_payload, error_payload, health_payload
from api.store import CaseNotFoundError, CaseStore, ResolutionNotFoundError, ResolutionStore
from client import (
    CallEAPIError,
    REAL_API_BASE_URL,
    build_recipient,
    parse_utc_timestamp,
)
from evidence.model import Case
from fake_server import SUBJECT_CANCELLED_PHONE, SUBJECT_VOICEMAIL_PHONE
from pipeline import ProviderCallFailedError, ResolutionRequest, resolve

# Loopback by default and on purpose. This server has no authentication,
# so binding it to every interface would be a decision an operator makes
# explicitly, never a default they inherit.
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

# Mirrors pyproject.toml's version. Reported so a client can tell which
# engine answered; it is not a build identifier and carries no path.
ENGINE_VERSION = "0.0.0"

# The server can run either the local fake backend or the explicitly
# authorized live CALL-E path. Resolution entries carry their selected
# mode; health reports the capability set.
MODE = "mixed"

# Largest declared request body this server will read and discard before
# giving up on reusing the connection. No route reads input, so this only
# bounds how much is thrown away, never how much is processed.
MAX_DRAIN_BYTES = 1 << 20  # 1 MiB
DRAIN_CHUNK_BYTES = 64 * 1024

RESOLUTIONS_PATH = "/api/resolutions"
CORS_ORIGIN_ENV = "REALITY_RESOLVER_CORS_ORIGIN"
CORS_ALLOW_METHODS = "GET, POST, OPTIONS"
CORS_ALLOW_HEADERS = "Content-Type"

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

# The fake scenarios, including the no-call clock preset, and the only way
# a fake request influences which number is dialled. It picks an outcome
# by name; the number is chosen here, from fake_server.py's own reserved
# sentinels and Ofcom's reserved drama range. Live requests use their
# separately validated destination, and "blocked" is not a bypass in the
# fake path either: it routes to a number with no jurisdiction mapping,
# and the hard gate refuses it for real.
SCENARIO_PHONES: dict[str, str | None] = {
    "no-call": None,  # the fake clock places the deadline outside R4's threshold
    "confirmed": None,  # the case file's own number: fake server's happy path
    "cancelled": SUBJECT_CANCELLED_PHONE,
    "voicemail": SUBJECT_VOICEMAIL_PHONE,
    "blocked": "+442079460123",  # Ofcom reserved 020 7946 0xxx; no jurisdiction maps to +44
}
DEFAULT_SCENARIO = "confirmed"

# The HTTP contract is split by execution mode. Values from the other
# mode are rejected explicitly instead of being silently ignored.
FAKE_REQUEST_FIELDS = frozenset({"case", "execution_mode", "scenario", "now_utc"})
LIVE_REQUEST_FIELDS = frozenset(
    {"case", "execution_mode", "destination", "authorize_destination", "gdpr_basis_documented"}
)
RESOLUTION_REQUEST_FIELDS = FAKE_REQUEST_FIELDS | LIVE_REQUEST_FIELDS

# Execution backends this build can actually drive. Both modes share the
# same pipeline; the live branch is guarded by explicit authorization and
# a process-local concurrency limit.
IMPLEMENTED_EXECUTION_MODES = frozenset({"fake", "live"})
KNOWN_EXECUTION_MODES = IMPLEMENTED_EXECUTION_MODES

# Resolutions run on a small pool rather than on the request thread.
# Four is not about throughput - a fake resolution takes about 25 ms -
# it is a bound. ThreadingHTTPServer already spawns one thread per
# connection without a ceiling; adding unbounded workers on top would
# double that problem. A saturated pool queues, which is honest here:
# `queued` is a real state the client can see.
MAX_WORKERS = 4

# Process-local safety limit for real calls. Fake runs do not use it.
MAX_LIVE_CONCURRENT = 1

# How many connections the OS may hold waiting to be accepted.
#
# socketserver's default is 5, which ThreadingHTTPServer inherits. That
# was survivable while a POST did all its work inline and clients
# arrived spread out; now that accepting is nearly instant, a client
# can burst - and a burst of 40 simultaneous connections had five of
# them refused by the kernel before this server ever saw them. Measured,
# not theorised: it made a concurrency test fail roughly one run in
# three. This is the accept queue, not a concurrency limit; work is
# still bounded by MAX_WORKERS.
REQUEST_QUEUE_SIZE = 64


class ResolverHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer with a backlog that survives a burst."""

    request_queue_size = REQUEST_QUEUE_SIZE


def queued_entry(resolution_id: str, case: Case, mode: str) -> dict[str, Any]:
    """The entry a resolution starts life as: every key of the public
    contract present, and everything not yet known set to null.

    The nulls are the job's own seed, not something StoreObserver
    invented - it still publishes a field only once the pipeline has made
    it true. What this buys is a stable shape from the very first
    response, so a client is never reading a payload whose keys appear
    one at a time.

    The key set is asserted against resolution_payload's in the tests:
    two places build this contract, and they must not drift.
    """
    return {
        "id": resolution_id,
        "state": "queued",
        "mode": mode,
        "case": case_summary(case),
        "evidence": None,
        "reasoning": None,
        "call_decision": None,
        "compliance": None,
        # An object rather than null, unlike the fields above, because
        # this one is already known: nothing has been placed yet, and
        # `placed: false` says so. It also keeps the shape identical to
        # what resolution_payload produces on the branches that never
        # call - a client reading call.placed must not have to check
        # whether `call` is an object first.
        "call": {"placed": False, "provider_status": None, "result": None},
        "verdict": None,
        "error": None,
    }


def _run_resolution(
    resolutions: ResolutionStore,
    resolution_id: str,
    request: ResolutionRequest,
    live_capacity: threading.BoundedSemaphore | None = None,
) -> None:
    """Run one resolution to completion, off the request thread.

    Module-level rather than a Handler method on purpose: by the time
    this runs, the request that started it has been answered and its
    handler is gone.

    It decides nothing. resolve() is called exactly as the CLI calls it,
    with a StoreObserver attached; the only thing added here is turning
    an exception into a transport state. Every exception becomes
    `failed` with a null verdict - a technical failure is never an engine
    outcome, so a timeout, a provider error or a bug cannot surface as a
    cancellation. BaseException is deliberately not caught: a
    KeyboardInterrupt or a SystemExit is the interpreter going down, not
    a resolution failing.

    The reply carries this module's own text, never str(exc): provider
    error bodies and pipeline messages can quote back a number, a task,
    or an input, and none of that belongs in a stored payload.
    """
    try:
        try:
            resolve(request, StoreObserver(resolutions, resolution_id))
        except Exception as exc:
            if isinstance(exc, ProviderCallFailedError):
                code = "provider_failed"
            elif isinstance(exc, TimeoutError):
                code = "calle_timeout"
            elif isinstance(exc, CallEAPIError):
                code = "calle_auth_error" if exc.status_code in {401, 403} else "calle_api_error"
            elif request.allow_live:
                code = "calle_network_error"
            else:
                code = "resolution_failed"
            try:
                resolutions.update(
                    resolution_id,
                    {
                        "state": "failed",
                        "verdict": None,
                        "error": {
                            "code": code,
                            "message": "the resolution could not be completed",
                        },
                    },
                )
            except ResolutionNotFoundError:
                # Evicted while running; there is nothing left to mark.
                return
    finally:
        if live_capacity is not None:
            live_capacity.release()


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

    @property
    def executor(self) -> ThreadPoolExecutor:
        return self.server.executor  # type: ignore[attr-defined]

    @property
    def live_capacity(self) -> threading.BoundedSemaphore:
        return self.server.live_capacity  # type: ignore[attr-defined]

    def log_message(self, *args: Any) -> None:
        """Silent, same as fake_server.py. The default writes the request
        line to stderr, which would put every requested path into
        whatever collects that stream.
        """
        return

    def _cors_headers(self) -> dict[str, str]:
        configured_origin = os.environ.get(CORS_ORIGIN_ENV)
        request_origin = self.headers.get("Origin")
        if configured_origin and configured_origin != "*" and request_origin == configured_origin:
            return {
                "Access-Control-Allow-Origin": configured_origin,
                "Vary": "Origin",
            }
        return {}

    def _send(self, status: int, body: dict[str, Any], extra_headers: dict[str, str] | None = None) -> None:
        raw = b"" if status == 204 else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        if self.close_connection:
            # Something upstream decided this connection cannot be reused
            # - a body that could not be drained, typically. Say so:
            # closing without the header leaves the client believing it
            # may send another request down a socket that is going away.
            self.send_header("Connection", "close")
        headers = self._cors_headers()
        headers.update(extra_headers or {})
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        if raw:
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

        Other routes do not read input, and skipping this was a real defect
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

    def do_OPTIONS(self) -> None:
        self.body = self._read_request_body()
        path = self._path()
        if path not in ROUTES and not path.startswith(f"{RESOLUTIONS_PATH}/"):
            self._not_found()
            return

        if self._cors_headers():
            self._send(
                204,
                {},
                {
                    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
                    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
                },
            )
            return
        self._send(204, {})

    # --- route handlers ------------------------------------------------

    def handle_health(self) -> tuple[int, dict[str, Any]]:
        return 200, health_payload(MODE, ENGINE_VERSION)

    def handle_cases(self) -> tuple[int, dict[str, Any]]:
        return 200, cases_payload(self.store.all())

    def handle_create_resolution(self) -> tuple[int, dict[str, Any]]:
        """Validate, seed an entry, hand the run to a worker, answer 202.

        This method makes no decision about the case. It does not score
        R1-R4, build a PreCallContext, run or filter compliance checks,
        or reconcile anything - resolve() is the only caller of any of
        those, here as in the CLI. Everything below is either input
        validation, transport, or handing work to _run_resolution.
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

        # Check the mode before loading a case so the request contract is
        # deterministic and unsupported values cannot steer execution.
        execution_mode = payload.get("execution_mode")
        if not isinstance(execution_mode, str) or execution_mode not in KNOWN_EXECUTION_MODES:
            return 422, error_payload(
                "invalid_execution_mode",
                f"execution_mode is required and must be one of {sorted(KNOWN_EXECUTION_MODES)}",
            )
        case_name = payload.get("case")
        if not isinstance(case_name, str) or not case_name:
            return 422, error_payload("invalid_case", "case must be a non-empty string")

        now_utc = None
        if execution_mode == "fake":
            forbidden = sorted(set(payload) - FAKE_REQUEST_FIELDS)
            if forbidden:
                return 422, error_payload(
                    "field_not_allowed", f"fields are not allowed in fake mode: {forbidden}"
                )
            scenario = payload.get("scenario", DEFAULT_SCENARIO)
            if not isinstance(scenario, str) or scenario not in SCENARIO_PHONES:
                return 422, error_payload(
                    "invalid_scenario", f"scenario must be one of {sorted(SCENARIO_PHONES)}"
                )
        else:
            forbidden = sorted(set(payload) - LIVE_REQUEST_FIELDS)
            if forbidden:
                return 422, error_payload(
                    "field_not_allowed", f"fields are not allowed in live mode: {forbidden}"
                )
            scenario = None
            api_key_header = self.headers.get("X-Calle-Api-Key")
            api_key = api_key_header if api_key_header is not None else ""
            if not api_key.strip():
                return 401, error_payload("missing_api_key", "X-Calle-Api-Key is required for live execution")
            if "gdpr_basis_documented" in payload and type(payload["gdpr_basis_documented"]) is not bool:
                return 422, error_payload(
                    "invalid_gdpr_basis_documented", "gdpr_basis_documented must be a boolean"
                )
            destination = payload.get("destination")
            authorize_destination = payload.get("authorize_destination")
            if not isinstance(destination, str) or not destination:
                return 422, error_payload("missing_destination", "destination is required in live mode")
            if not isinstance(authorize_destination, str) or not authorize_destination:
                return 422, error_payload(
                    "missing_authorize_destination", "authorize_destination is required in live mode"
                )
            try:
                build_recipient(destination, None, None)
            except (TypeError, ValueError):
                return 422, error_payload("invalid_destination", "destination must be strict ASCII E.164")
            try:
                build_recipient(authorize_destination, None, None)
            except (TypeError, ValueError):
                return 422, error_payload(
                    "invalid_authorize_destination", "authorize_destination must be strict ASCII E.164"
                )
            if destination != authorize_destination:
                return 422, error_payload(
                    "destination_authorization_mismatch",
                    "destination and authorize_destination must match exactly",
                )

        if execution_mode == "fake" and self.headers.get("X-Calle-Api-Key") is not None:
            return 422, error_payload("api_key_not_allowed", "X-Calle-Api-Key is only accepted in live mode")

        if execution_mode == "fake" and "now_utc" in payload:
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
            case = self.store.get(case_name)
        except CaseNotFoundError:
            return 404, error_payload("case_not_found", "no such case")

        # Fake demonstration time is relative to the fixture, not today's
        # clock. Explicit test times remain supported; no-call always
        # prepares R4=false, even when a frontend also sends now_utc.
        if execution_mode == "fake" and scenario == "no-call":
            now_utc = case.deadline - case.decision_deadline_threshold - timedelta(seconds=1)
        elif execution_mode == "fake" and now_utc is None:
            now_utc = case.deadline - case.decision_deadline_threshold / 2

        live = execution_mode == "live"
        request = ResolutionRequest(
            case_path=str(case_path),
            base_url=REAL_API_BASE_URL if live else self.backend.base_url,
            execute=True,
            allow_live=live,
            authorize_destination=authorize_destination if live else None,
            api_key=api_key if live else None,
            phone_override=destination if live else SCENARIO_PHONES[scenario],
            now_utc=now_utc,
            gdpr_basis_documented=(payload.get("gdpr_basis_documented", False) if live else False),
            poll_interval_seconds=0.01,
            poll_timeout_seconds=MAX_POLL_SECONDS,
        )

        live_capacity = None
        if live:
            if not self.live_capacity.acquire(blocking=False):
                return 429, error_payload(
                    "live_capacity_reached", "one live resolution is already in progress"
                )
            live_capacity = self.live_capacity

        # Seeded before the work is submitted, never after. The observer
        # publishes through store.update(), which requires the entry to
        # exist; a worker that started first could reach on_start before
        # this line ran and lose the whole run's progress.
        #
        # The store gets a copy, and this reply keeps its own. Handing
        # over the same object would leave the response being serialized
        # while a worker mutates it - a 202 that sometimes says "running",
        # or worse, a torn mixture of two states.
        try:
            resolution_id = self.resolutions.new_id()
            seed = queued_entry(resolution_id, case, execution_mode)
            self.resolutions.put(resolution_id, dict(seed))
            self.executor.submit(_run_resolution, self.resolutions, resolution_id, request, live_capacity)
        except Exception:
            if live_capacity is not None:
                live_capacity.release()
            return 503, error_payload(
                "resolution_submit_failed", "the resolution could not be accepted"
            )
        return 202, seed

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
    executor: ThreadPoolExecutor | None = None,
) -> ResolverHTTPServer:
    """Build a server without starting it, and without starting the
    backend either.

    The lifecycles stay separate deliberately: whoever starts the fake
    backend stops it, and whoever submits work to the executor shuts it
    down. Wiring either into this function would make a forgotten
    teardown invisible, and would tie threads nobody named to the
    lifetime of an HTTP server that may outlive them. A default executor
    is built for convenience; a caller that actually submits resolutions
    should own one and shut it down.
    """
    server = ResolverHTTPServer((host, port), Handler)
    # `is None` rather than `or`, and not as a style preference:
    # ResolutionStore defines __len__, so an empty one is falsy and
    # `resolutions or ResolutionStore()` silently threw away the store a
    # caller had passed in. Anything given here is used, empty or not.
    server.store = store if store is not None else CaseStore()  # type: ignore[attr-defined]
    server.backend = backend if backend is not None else FakeCallBackend()  # type: ignore[attr-defined]
    server.resolutions = (  # type: ignore[attr-defined]
        resolutions if resolutions is not None else ResolutionStore()
    )
    server.executor = (  # type: ignore[attr-defined]
        executor if executor is not None else ThreadPoolExecutor(max_workers=MAX_WORKERS)
    )
    server.live_capacity = threading.BoundedSemaphore(MAX_LIVE_CONCURRENT)  # type: ignore[attr-defined]
    return server


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="HTTP surface for Reality Resolver, with fake and explicitly authorized live CALL-E modes."
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)

    backend = FakeCallBackend()
    backend.start()
    executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)
    server = create_server(args.host, args.port, backend=backend, executor=executor)
    host, port = server.server_address[:2]
    print(f"Reality Resolver API on http://{host}:{port} (mode={MODE})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    finally:
        # Order matters. Stop accepting, let in-flight resolutions finish,
        # and only then take the backend away - a worker still polling
        # would otherwise find its provider gone mid-run. MAX_POLL_SECONDS
        # is what makes wait=True safe: it bounds how long a resolution
        # can hold the shutdown, and these are not daemon threads.
        server.server_close()
        executor.shutdown(wait=True)
        backend.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
