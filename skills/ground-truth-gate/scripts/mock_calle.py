#!/usr/bin/env python3
"""A local stand-in for the CALL-E call-task API, for testing without a credential.

Why this exists: the interesting failures in this skill are all about what comes
BACK from a call - a hedge recorded as `unknown`, a refusal, a call that never
reaches a terminal state at all. Those are the paths that must not release a
claim as fact, and they are exactly the paths you cannot rehearse against the
real API without ringing a real person and asking them to be unhelpful in a
specific way.

So this serves the same contract on localhost and lets any outcome be selected:

    POST /v1/calls          -> {"id", "status": "queued", ...}
    GET  /v1/calls/{id}     -> the call, terminal after --delay polls

It is a test double, not a simulator. It does not model telephony; it models the
response shapes `place_call.py` has to survive. Run it, point --base-url at it,
and the whole triage -> send -> poll -> release loop runs end to end.

    python3 scripts/mock_calle.py --outcome unknown &
    CALLE_API_KEY=test python3 scripts/place_call.py \\
        --input assets/sample-claim.json --base-url http://127.0.0.1:8787 \\
        --send --poll --abstain false
"""

from __future__ import annotations

import argparse
import json
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

CALL_PATH = re.compile(r"^/v1/calls/([A-Za-z0-9_\-]+)$")

# Every terminal shape place_call.py must survive. The first four are the ones
# that must NOT release a claim as fact.
OUTCOMES: dict[str, dict[str, Any]] = {
    "unknown": {
        "status": "completed",
        "verdict": "unknown",
        "quoted_answer": "I think so but you'd have to check with the floor team.",
    },
    "refused": {
        "status": "completed",
        "verdict": "refused_to_answer",
        "quoted_answer": "We don't give stock information over the phone.",
    },
    "voicemail": {"status": "failed", "verdict": "unknown", "quoted_answer": ""},
    "never_completes": {"status": "in_progress", "verdict": "unknown", "quoted_answer": ""},
    "confirmed_false": {
        "status": "completed",
        "verdict": "confirmed_false",
        "quoted_answer": "Not at this branch, no. We're out until Thursday.",
        "valid_until_note": "They expect a delivery Thursday.",
    },
    "confirmed_true": {
        "status": "completed",
        "verdict": "confirmed_true",
        "quoted_answer": "Yes, we have two on the floor right now.",
    },
}


class State:
    """Calls created so far, and how many times each has been polled."""

    def __init__(self, outcome: str, delay: int) -> None:
        self.outcome = outcome
        self.delay = delay
        self.calls: dict[str, dict[str, Any]] = {}
        self.idempotency: dict[str, str] = {}
        self.polls: dict[str, int] = {}
        self.lock = threading.Lock()

    def create(self, body: dict[str, Any], key: str | None) -> tuple[dict[str, Any], bool]:
        with self.lock:
            # The whole point of the key: the same request must never produce a
            # second call. place_call.py derives it from the body, so a retry
            # after a timeout lands here and gets the original call back.
            if key and key in self.idempotency:
                return self.calls[self.idempotency[key]], True
            call_id = f"call_{uuid.uuid4().hex[:12]}"
            call = {
                "id": call_id,
                "object": "call_task",
                "status": "queued",
                "task": body.get("task", ""),
                "metadata": body.get("metadata", {}),
                "recipients": body.get("recipients", []),
                "structured_result": None,
                "task_completed": None,
                "completion_confidence": None,
            }
            self.calls[call_id] = call
            self.polls[call_id] = 0
            if key:
                self.idempotency[key] = call_id
            return call, False

    def fetch(self, call_id: str) -> dict[str, Any] | None:
        with self.lock:
            call = self.calls.get(call_id)
            if call is None:
                return None
            self.polls[call_id] += 1
            if self.polls[call_id] <= self.delay:
                call["status"] = "in_progress"
                return json.loads(json.dumps(call))
            shape = OUTCOMES[self.outcome]
            call["status"] = shape["status"]
            if shape["status"] == "in_progress":
                # never_completes: the dangerous one. The claim stays unresolved
                # and the caller has to notice the silence itself.
                return json.loads(json.dumps(call))
            result = {
                "verdict": shape["verdict"],
                "quoted_answer": shape["quoted_answer"],
                "valid_until_note": shape.get("valid_until_note", ""),
            }
            # A failed call carries no result at all, which is a different thing
            # from a completed call that returned `unknown`.
            call["structured_result"] = None if shape["status"] == "failed" else result
            call["task_completed"] = shape["status"] == "completed"
            call["completion_confidence"] = (
                {"score": 0.93, "label": "high"} if shape["status"] == "completed" else None
            )
            return json.loads(json.dumps(call))


def make_handler(state: State, api_key: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"  [mock] {fmt % args}")

        def _send(self, status: int, payload: dict[str, Any]) -> None:
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def _authorized(self) -> bool:
            # Checked so the client's auth path is actually exercised: a client
            # that forgets the header should fail here, not silently pass.
            if self.headers.get("Authorization", "") == f"Bearer {api_key}":
                return True
            self._send(401, {"error": "missing or invalid Authorization header"})
            return False

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's naming
            if self.path != "/v1/calls":
                self._send(404, {"error": "not found"})
                return
            if not self._authorized():
                return
            length = int(self.headers.get("Content-Length", "0"))
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send(400, {"error": "body is not JSON"})
                return
            missing = [name for name in ("task", "recipients") if not body.get(name)]
            if missing:
                self._send(422, {"error": f"missing required fields: {', '.join(missing)}"})
                return
            call, replayed = state.create(body, self.headers.get("Idempotency-Key"))
            if replayed:
                print(f"  [mock] idempotent replay -> {call['id']}, no second call placed")
            self._send(201, call)

        def do_GET(self) -> None:  # noqa: N802
            match = CALL_PATH.match(self.path)
            if not match:
                self._send(404, {"error": "not found"})
                return
            if not self._authorized():
                return
            call = state.fetch(match.group(1))
            if call is None:
                self._send(404, {"error": "no such call"})
                return
            self._send(200, call)

    return Handler


def serve(outcome: str, delay: int, port: int, api_key: str) -> ThreadingHTTPServer:
    """Start the mock on a background thread and return it, for use in tests."""
    state = State(outcome, delay)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(state, api_key))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--outcome",
        choices=sorted(OUTCOMES),
        default="confirmed_false",
        help="which terminal result to serve",
    )
    parser.add_argument(
        "--delay", type=int, default=1, help="polls to spend in_progress before going terminal"
    )
    parser.add_argument("--api-key", default="test", help="the bearer token this mock accepts")
    args = parser.parse_args(argv)

    state = State(args.outcome, args.delay)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state, args.api_key))
    print(
        f"mock CALL-E on http://127.0.0.1:{args.port}  "
        f"outcome={args.outcome} delay={args.delay}"
    )
    print(f"  CALLE_API_KEY={args.api_key}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
