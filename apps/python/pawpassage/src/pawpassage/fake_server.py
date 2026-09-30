from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Self
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class FakeServerSnapshot:
    create_requests: int
    read_requests: int
    unique_calls: int


class FakeCalleServer:
    """Loopback CALL-E-shaped server used only for credential-free demonstrations."""

    def __init__(self, scripts: dict[str, dict[str, Any]]) -> None:
        self._scripts = scripts
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._calls: dict[str, dict[str, Any]] = {}
        self._fingerprints: dict[str, str] = {}
        self._create_requests = 0
        self._read_requests = 0

    @property
    def base_url(self) -> str:
        if self._server is None:
            raise RuntimeError("Fake server is not running")
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    def snapshot(self) -> FakeServerSnapshot:
        with self._lock:
            return FakeServerSnapshot(
                create_requests=self._create_requests,
                read_requests=self._read_requests,
                unique_calls=len(self._calls),
            )

    def __enter__(self) -> Self:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "PawPassageFakeCALL-E/1.0"

            def do_POST(self) -> None:
                if self.path != "/v1/calls":
                    return self._send(
                        404, {"error": {"code": "not_found", "message": "not found"}}
                    )
                if self.headers.get("Authorization") != "Bearer demo-fake-key":
                    return self._send(
                        401, {"error": {"code": "unauthorized", "message": "fake auth"}}
                    )
                key = self.headers.get("Idempotency-Key")
                if not key:
                    return self._send(
                        400,
                        {
                            "error": {
                                "code": "invalid_request",
                                "message": "missing key",
                            }
                        },
                    )
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    payload = json.loads(self.rfile.read(length).decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    return self._send(
                        400,
                        {"error": {"code": "invalid_request", "message": "bad json"}},
                    )
                checkpoint_id = payload.get("metadata", {}).get("checkpointId")
                script = owner._scripts.get(checkpoint_id)
                if not script:
                    return self._send(
                        400,
                        {
                            "error": {
                                "code": "invalid_request",
                                "message": "unknown fixture",
                            }
                        },
                    )
                with owner._lock:
                    owner._create_requests += 1
                if script.get("kind") == "submission_unknown":
                    return self._send(
                        503,
                        {
                            "error": {
                                "code": "provider_unavailable",
                                "message": "scripted fake ambiguity",
                            }
                        },
                    )
                fingerprint = _fingerprint(payload)
                with owner._lock:
                    previous_fingerprint = owner._fingerprints.get(key)
                    if (
                        previous_fingerprint is not None
                        and previous_fingerprint != fingerprint
                    ):
                        return self._send(
                            409,
                            {
                                "error": {
                                    "code": "idempotency_conflict",
                                    "message": "fake conflict",
                                }
                            },
                        )
                    call_id = f"fake-{hashlib.sha256(key.encode()).hexdigest()[:16]}"
                    owner._fingerprints[key] = fingerprint
                    owner._calls.setdefault(
                        call_id, _call_payload(call_id, payload, script, terminal=False)
                    )
                    created = owner._calls[call_id]
                return self._send(200, created)

            def do_GET(self) -> None:
                parsed = urlparse(self.path)
                prefix = "/v1/calls/"
                if not parsed.path.startswith(prefix):
                    return self._send(
                        404, {"error": {"code": "not_found", "message": "not found"}}
                    )
                call_id = parsed.path[len(prefix) :]
                with owner._lock:
                    owner._read_requests += 1
                    created = owner._calls.get(call_id)
                if created is None:
                    return self._send(
                        404, {"error": {"code": "not_found", "message": "unknown call"}}
                    )
                checkpoint_id = created["metadata"]["checkpointId"]
                terminal = _call_payload(
                    call_id,
                    created["_request"],
                    owner._scripts[checkpoint_id],
                    terminal=True,
                )
                terminal.pop("_request", None)
                return self._send(200, terminal)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _send(self, status: int, payload: dict[str, Any]) -> None:
                safe_payload = dict(payload)
                safe_payload.pop("_request", None)
                body = json.dumps(safe_payload, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._server = None
        self._thread = None


def _call_payload(
    call_id: str,
    request: dict[str, Any],
    script: dict[str, Any],
    *,
    terminal: bool,
) -> dict[str, Any]:
    recipients = request["recipients"]
    phone = recipients[0]["phones"][0]
    recipient = {
        "id": f"recipient-{call_id}",
        "phones": [phone],
        "region": recipients[0].get("region"),
        "locale": recipients[0].get("locale"),
        "status": "completed" if terminal else "pending",
        "structured_result": script.get("result") if terminal else None,
        "attempts": (
            [
                {
                    "id": f"attempt-{call_id}",
                    "phone": phone,
                    "status": "completed",
                    "failure_code": None,
                    "summary": "Fictional fixture result.",
                    "transcript_turns": [],
                }
            ]
            if terminal
            else []
        ),
    }
    return {
        "id": call_id,
        "object": "call_task",
        "status": "completed" if terminal else "queued",
        "task": request["task"],
        "task_completed": True if terminal else None,
        "recipients": [recipient],
        "metadata": request.get("metadata", {}),
        "structured_result": None,
        "failure_code": None,
        "evidence": ["Fictional fixture evidence."] if terminal else [],
        "_request": request,
    }


def _fingerprint(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
