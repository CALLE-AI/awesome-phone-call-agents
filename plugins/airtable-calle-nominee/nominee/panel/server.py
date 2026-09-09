"""The operator's control panel.

Two PRs in this repository were blocked because a deployable surface could
start live calls without an authorization boundary and with caller-controlled
destinations. So this server is built the other way round:

  * It binds to loopback only, and refuses to start otherwise.
  * Every request needs a token printed to the console at startup.
  * **The run endpoint accepts no destination.** It takes a view name. The
    numbers come from consented rows the server reads itself, so there is no
    request shape that can introduce a phone number.

The last point is a security property expressed as an absence: you cannot ask
this server to call someone. You can only ask it to run a view that a person
already consented to.
"""

from __future__ import annotations

import json
import secrets
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from ..airtable import AirtableClient
from ..audit import AuditLog
from ..runner import RunError, execute, plan
from ..transport import Transport

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
INDEX = Path(__file__).resolve().parent / "index.html"


class PanelError(Exception):
    """The panel cannot be started safely."""


@dataclass
class RunState:
    """What a run is doing right now, for the live view."""

    running: bool = False
    view: str = ""
    started: bool = False
    finished: bool = False
    error: str = ""
    rows: dict[str, dict[str, Any]] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    elapsed: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "running": self.running,
                "finished": self.finished,
                "view": self.view,
                "error": self.error,
                "rows": list(self.rows.values()),
                "counts": dict(self.counts),
                "elapsed": round(self.elapsed, 1),
            }


def _plan_json(current) -> dict[str, Any]:
    return {
        "view": current.scope.view,
        "in_view": current.scope.in_view,
        "in_table": current.scope.in_table,
        "hidden": current.scope.hidden,
        "call_count": current.call_count,
        "estimated_cost_usd": current.estimated_cost_usd,
        "planned": [
            {
                "request_id": item.contact.request_id,
                "employer": item.contact.employer_name,
                "masked_number": item.contact.masked_number(),
                "source": item.contact.number.source.value,
                "task": item.task,
            }
            for item in current.planned
        ],
        "skipped": [
            {
                "request_id": item.row.request.request_id or item.row.record_id,
                "employer": item.row.request.employer_name,
                "reason": item.reason,
            }
            for item in current.skipped
        ],
    }


class Panel:
    """Holds the clients and the current run state."""

    def __init__(
        self,
        client: AirtableClient,
        transport: Transport | None,
        audit: AuditLog,
        *,
        table: str,
        requester_name: str,
        default_view: str,
        max_calls: int,
        token: str,
        live: bool,
    ) -> None:
        self.client = client
        self.transport = transport
        self.audit = audit
        self.table = table
        self.requester_name = requester_name
        self.default_view = default_view
        self.max_calls = max_calls
        self.token = token
        self.live = live
        self.state = RunState()

    def plan(self, view: str) -> dict[str, Any]:
        return _plan_json(
            plan(
                self.client,
                table=self.table,
                view=view,
                requester_name=self.requester_name,
            )
        )

    def start_run(self, view: str) -> dict[str, Any]:
        if self.transport is None:
            raise PanelError(
                "no CALL-E transport configured; this panel is preview-only"
            )
        with self.state.lock:
            if self.state.running:
                raise PanelError("a run is already in flight")
            self.state = RunState(running=True, view=view)
        state = self.state

        def work() -> None:
            try:
                report = execute(
                    self.client,
                    self.transport,
                    self.audit,
                    table=self.table,
                    view=view,
                    requester_name=self.requester_name,
                    max_calls=self.max_calls,
                    **({} if self.live else {"first_delay": 0, "interval": 0,
                                             "sleep": lambda _: None}),
                )
                with state.lock:
                    for outcome in report.outcomes:
                        state.rows[outcome.request_id] = {
                            "request_id": outcome.request_id,
                            "disposition": outcome.interpretation.disposition.value,
                            "reason": outcome.interpretation.reason,
                            "confidence": outcome.interpretation.confidence,
                            "evidence": list(outcome.interpretation.evidence),
                        }
                    for item in report.plan.skipped:
                        rid = item.row.request.request_id or item.row.record_id
                        state.rows[rid] = {
                            "request_id": rid,
                            "disposition": "skipped",
                            "reason": item.reason,
                            "confidence": None,
                            "evidence": [],
                        }
                    state.counts = report.by_disposition()
                    state.elapsed = report.elapsed_seconds
            except (RunError, Exception) as exc:  # noqa: BLE001 - surfaced to the operator
                with state.lock:
                    state.error = str(exc)
            finally:
                with state.lock:
                    state.running = False
                    state.finished = True

        threading.Thread(target=work, daemon=True).start()
        return {"started": True, "view": view}

    def audit_status(self) -> dict[str, Any]:
        status = self.audit.verify_chain()
        return {
            "ok": status.ok,
            "records": status.records,
            "head": status.head[:16],
            "reason": status.reason,
            "broken_at": status.broken_at,
        }


def make_handler(panel: Panel):
    class Handler(BaseHTTPRequestHandler):
        server_version = "nominee-panel"

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter console
            return

        def _send(self, code: int, payload: Any, content_type="application/json") -> None:
            body = (
                payload.encode("utf-8")
                if isinstance(payload, str)
                else json.dumps(payload).encode("utf-8")
            )
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self, query: dict[str, list[str]]) -> bool:
            presented = (
                self.headers.get("X-Nominee-Token") or (query.get("token") or [""])[0]
            )
            return secrets.compare_digest(presented or "", panel.token)

        def do_GET(self) -> None:  # noqa: N802 - stdlib naming
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)
            if parts.path == "/":
                return self._send(200, INDEX.read_text(encoding="utf-8"), "text/html; charset=utf-8")
            if not self._authorized(query):
                return self._send(401, {"error": "token required"})
            view = (query.get("view") or [panel.default_view])[0]
            try:
                if parts.path == "/api/plan":
                    return self._send(200, panel.plan(view))
                if parts.path == "/api/status":
                    return self._send(200, panel.state.snapshot())
                if parts.path == "/api/audit":
                    return self._send(200, panel.audit_status())
                if parts.path == "/api/config":
                    return self._send(200, {"view": panel.default_view, "live": panel.live})
            except Exception as exc:  # noqa: BLE001 - reported to the operator
                return self._send(400, {"error": str(exc)})
            return self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802 - stdlib naming
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)
            if not self._authorized(query):
                return self._send(401, {"error": "token required"})
            if parts.path != "/api/run":
                return self._send(404, {"error": "not found"})

            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, {"error": "body must be JSON"})

            # A destination cannot be introduced through this endpoint. Only a
            # view name is accepted; numbers come from consented rows.
            unexpected = set(body) - {"view", "confirm"}
            if unexpected:
                return self._send(
                    400,
                    {
                        "error": (
                            "this endpoint accepts only a view name and a "
                            f"confirmation; rejected: {sorted(unexpected)}"
                        )
                    },
                )
            if body.get("confirm") is not True:
                return self._send(400, {"error": "confirm must be true"})

            try:
                return self._send(
                    202, panel.start_run(str(body.get("view") or panel.default_view))
                )
            except PanelError as exc:
                return self._send(409, {"error": str(exc)})

    return Handler


def serve(
    panel_kwargs: dict[str, Any],
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
) -> None:
    """Start the panel. Refuses any bind address that is not loopback."""
    if host not in LOOPBACK:
        raise PanelError(
            f"refusing to bind {host!r}. This panel can start real phone calls "
            "and is loopback-only by design; put it behind your own "
            "authenticated proxy if it must be reachable."
        )
    panel = Panel(**panel_kwargs)
    server = ThreadingHTTPServer((host, port), make_handler(panel))
    # flush: the operator cannot reach the panel without this line, and stdout
    # is block-buffered whenever it is redirected or piped.
    print(f"  nominee panel  http://{host}:{port}/?token={panel.token}", flush=True)
    print(
        "  mode: "
        + ("LIVE — this can place real calls" if panel.live else "fixtures — no calls"),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
