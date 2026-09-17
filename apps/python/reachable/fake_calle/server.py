"""The fake CALL-E: an in-process client and a loopback HTTP server.

``FakeCalleClient`` satisfies ``reachable.calls.client.CallClient`` with no
sockets at all, which is what tests use. ``serve()`` puts the same behaviour
behind loopback HTTP, so the real SDK can be pointed somewhere harmless and the
credential allowlist has something legitimate to accept.

It reproduces the one provider behaviour that matters for correctness: reusing
an idempotency key with the same request returns the original call rather than
creating a second one.
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from reachable.calls.client import (
    CallError,
    CallHandle,
    CallRequest,
    CallSubmissionUnknown,
)

from .scripts import DEFERRED, SCRIPTS

MAX_BODY_BYTES = 1_048_576

#: The script an unscripted call gets, chosen so the result shape matches the
#: task that was actually sent.
DEFAULT_BY_WORKFLOW = {
    "contact_check": "clean_identity",
    "pattern_followup": "pattern_support",
}


@dataclass
class FakeCalleState:
    """Shared, lock-guarded state."""

    #: Script name applied to the next create, or a per-key mapping.
    #:
    #: ``None`` means "pick one that matches the workflow being called", which
    #: is what an unscripted run wants: a contact-check task answered with a
    #: pattern-shaped result is a schema mismatch the app will rightly refuse,
    #: and that is noise rather than a finding. Set it to a name to pin every
    #: call to one script.
    default_script: str | None = None
    by_key: dict[str, str] = field(default_factory=dict)
    scripts_for_key: dict[str, str] = field(default_factory=dict)
    calls: dict[str, dict[str, Any]] = field(default_factory=dict)
    reads: dict[str, int] = field(default_factory=dict)
    deferred: dict[str, bool] = field(default_factory=dict)
    requests: list[CallRequest] = field(default_factory=list)
    #: Set to "unknown" or "error" to make the next submission fail.
    fail_submission: str | None = None
    lock: threading.RLock = field(default_factory=threading.RLock)

    def script_for(self, key: str, workflow: str = "") -> str:
        pinned = self.scripts_for_key.get(key) or self.default_script
        if pinned is not None:
            return pinned
        return DEFAULT_BY_WORKFLOW.get(workflow, "clean_identity")

    def queue(self, idempotency_key: str, script: str) -> None:
        """Bind a script to the call that a given idempotency key will create."""
        if script not in SCRIPTS:
            raise KeyError(f"unknown script {script!r}")
        with self.lock:
            self.scripts_for_key[idempotency_key] = script


class FakeCalleClient:
    """In-process transport. No sockets, no network, no credentials."""

    def __init__(self, state: FakeCalleState | None = None) -> None:
        self.state = state or FakeCalleState()

    # ------------------------------------------------------------ CallClient

    def create(self, request: CallRequest) -> CallHandle:
        state = self.state
        if state.fail_submission == "unknown":
            # The request "left the client" and its fate is unknown. A call may
            # already exist, so the caller must reconcile rather than redial.
            raise CallSubmissionUnknown("fake: submission outcome unknown")
        if state.fail_submission == "error":
            raise CallError("fake: submission refused")

        with state.lock:
            existing = state.by_key.get(request.idempotency_key)
            if existing is not None:
                # Reusing the key returns the original call, as the real API does.
                return CallHandle(existing, "queued")

            script_name = state.script_for(
                request.idempotency_key, str(request.metadata.get("workflow", ""))
            )
            builder = SCRIPTS[script_name]
            call_id = f"call_{uuid.uuid4().hex[:12]}"
            metadata = {**request.metadata, "idempotency_key": request.idempotency_key}
            snapshot = builder(request.destination, metadata)
            snapshot["id"] = call_id
            snapshot["task"] = request.task

            state.calls[call_id] = snapshot
            state.by_key[request.idempotency_key] = call_id
            state.reads[call_id] = 0
            state.deferred[call_id] = script_name in DEFERRED
            state.requests.append(request)
            return CallHandle(call_id, "queued")

    def get(self, call_id: str) -> dict[str, Any]:
        state = self.state
        with state.lock:
            if call_id not in state.calls:
                raise CallError(f"fake: unknown call {call_id}")
            reads = state.reads.get(call_id, 0)
            state.reads[call_id] = reads + 1
            snapshot = dict(state.calls[call_id])
            if state.deferred.get(call_id) and reads == 0:
                # CALL-E's in_progress includes post-call result finalisation, so
                # a call that has hung up can still legitimately read as
                # non-terminal. Not ready is not a failure.
                snapshot.update(
                    status="in_progress",
                    structured_result=None,
                    task_completed=None,
                    completion_confidence=None,
                    completed_at=None,
                )
            return snapshot


# --------------------------------------------------------------- HTTP server


def make_handler(state: FakeCalleState) -> type[BaseHTTPRequestHandler]:
    client = FakeCalleClient(state)

    class Handler(BaseHTTPRequestHandler):
        server_version = "reachable-fake-calle"

        def log_message(self, *args: Any) -> None:  # noqa: D102 - quiet
            return

        def _send(self, code: int, body: dict[str, Any]) -> None:
            encoded = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)

        def _read_json(self) -> dict[str, Any] | None:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except (TypeError, ValueError):
                return None
            if length <= 0 or length > MAX_BODY_BYTES:
                return None
            try:
                return json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return None

        def do_POST(self) -> None:  # noqa: N802
            if self.path == "/_fake/script":
                payload = self._read_json() or {}
                name = payload.get("script")
                key = payload.get("idempotency_key")
                if name not in SCRIPTS:
                    self._send(400, {"error": {"code": "unknown_script"}})
                    return
                if key:
                    state.queue(key, name)
                else:
                    state.default_script = name
                self._send(200, {"ok": True})
                return

            if self.path != "/v1/calls":
                self._send(404, {"error": {"code": "not_found"}})
                return

            payload = self._read_json()
            if payload is None or not isinstance(payload.get("task"), str) or not payload["task"]:
                self._send(400, {"error": {"code": "invalid_request"}})
                return

            recipients = payload.get("recipients") or []
            destination = ""
            if recipients and isinstance(recipients[0], dict):
                phones = recipients[0].get("phones") or []
                destination = phones[0] if phones else ""

            request = CallRequest(
                task=payload["task"],
                result_schema=payload.get("result_schema") or {},
                destination=destination,
                idempotency_key=self.headers.get("Idempotency-Key", ""),
                metadata=payload.get("metadata") or {},
            )
            try:
                handle = client.create(request)
            except CallError:
                self._send(500, {"error": {"code": "internal_error"}})
                return
            self._send(201, {"id": handle.call_id, "object": "call_task", "status": handle.status})

        def do_GET(self) -> None:  # noqa: N802
            parts = self.path.strip("/").split("/")
            if len(parts) >= 3 and parts[0] == "v1" and parts[1] == "calls":
                try:
                    snapshot = client.get(parts[2])
                except CallError:
                    self._send(404, {"error": {"code": "not_found"}})
                    return
                if len(parts) == 4 and parts[3] == "events":
                    self._send(200, {"object": "list", "data": []})
                    return
                self._send(200, snapshot)
                return
            self._send(404, {"error": {"code": "not_found"}})

    return Handler


def serve(host: str = "127.0.0.1", port: int = 8787) -> tuple[ThreadingHTTPServer, FakeCalleState]:
    """Start the fake on a background thread. Loopback only, by construction."""
    state = FakeCalleState()
    server = ThreadingHTTPServer((host, port), make_handler(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, state


def main() -> int:  # pragma: no cover - operator entry point
    import argparse

    parser = argparse.ArgumentParser(
        description="Local fake CALL-E. Places no calls and needs no credentials."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server, _ = serve(args.host, args.port)
    print(f"fake CALL-E on http://{args.host}:{args.port} (no call can be placed from here)")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
