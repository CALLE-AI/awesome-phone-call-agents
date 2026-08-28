from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

FAILURE_TO_MCP = {
    "no_answer": "NO_ANSWER",
    "voicemail": "VOICEMAIL",
    "busy": "BUSY",
    "expired": "EXPIRED",
}

MCP_TOOLS = [
    {"name": "plan_call", "description": "Create or refine a call plan. Does not place a call."},
    {"name": "run_call", "description": "Execute a plan. Places a real call."},
    {"name": "get_call_run", "description": "Read status, activity and transcript for a call run."},
    {"name": "track_ui_events", "description": "Report interface events. Ringdown never calls it."},
]

DEFAULT_TIMELINE = ("queued", "completed")

REVOKED = frozenset({"", "expired"})

CREATE_FIELDS = frozenset(
    {"task", "recipients", "result_schema", "recipient_result_schema", "metadata", "webhook_url"}
)


def turn(speaker: str, text: str) -> dict[str, Any]:
    return {"speaker": speaker, "text": text}


@dataclass(frozen=True)
class Fault:
    status: int | None = 503
    code: str = "service_unavailable"
    details: dict[str, Any] | None = None
    after_create: bool = False


@dataclass
class FakeScenario:
    timeline: tuple[str, ...] = DEFAULT_TIMELINE
    task_completed: bool = True
    confidence_score: float = 0.94
    confidence_label: str = "high"
    failure_code: str | None = None
    turns: list[dict[str, Any]] = field(default_factory=list)
    faults: dict[str, list[Fault]] = field(default_factory=dict)
    mcp_overrides: dict[str, Any] | None = field(default_factory=dict)


@dataclass
class CallRecord:
    id: str
    payload: dict[str, Any]
    scenario: FakeScenario
    created_at: datetime
    reads: int = 0

    @property
    def recipient_phone(self) -> str:
        return recipient_of(self.payload)

    @property
    def status(self) -> str:
        timeline = self.scenario.timeline
        return timeline[min(self.reads, len(timeline) - 1)]

    @property
    def settled(self) -> bool:
        return self.status not in ("queued", "in_progress")

    @property
    def completed_at(self) -> str | None:
        if not self.settled:
            return None
        return stamp(self.created_at + timedelta(seconds=self.reads))

    @property
    def mcp_status(self) -> str:
        if self.status == "failed" and self.scenario.failure_code:
            return FAILURE_TO_MCP.get(self.scenario.failure_code, "FAILED")
        return self.status.upper()


def recipient_of(payload: dict[str, Any]) -> str:
    first = (payload.get("recipients") or [{}])[0]
    return str((first.get("phones") or [""])[0])


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


class FakeCalle:
    def __init__(self, scenarios: dict[str, FakeScenario]) -> None:
        self.scenarios = scenarios
        self.calls: dict[str, CallRecord] = {}
        self.by_key: dict[str, str] = {}
        self.requests = 0
        self.creates = 0
        self._faults = {
            phone: {route: list(faults) for route, faults in scenario.faults.items()}
            for phone, scenario in scenarios.items()
        }
        self._lock = threading.Lock()

    @property
    def created(self) -> list[CallRecord]:
        return list(self.calls.values())

    def take_fault(self, phone: str, route: str) -> Fault | None:
        with self._lock:
            pending = self._faults.get(phone, {}).get(route)
            return pending.pop(0) if pending else None

    def place(self, payload: dict[str, Any], key: str) -> tuple[CallRecord, bool] | Fault:
        phone = recipient_of(payload)
        with self._lock:
            existing_id = self.by_key.get(key)
            if existing_id is not None:
                existing = self.calls[existing_id]
                if existing.payload != payload:
                    return Fault(409, "idempotency_conflict")
                return existing, True
            record = CallRecord(
                id=f"call_fake{len(self.calls) + 1}",
                payload=payload,
                scenario=self.scenarios[phone],
                created_at=datetime.now(UTC),
            )
            self.calls[record.id] = record
            self.by_key[key] = record.id
            return record, False

    def read(self, call_id: str) -> CallRecord | None:
        with self._lock:
            record = self.calls.get(call_id)
            if record is not None:
                record.reads += 1
            return record

    def rest_view(self, record: CallRecord) -> dict[str, Any]:
        scenario = record.scenario
        settled = record.settled
        phone = record.recipient_phone
        return {
            "id": record.id,
            "status": record.status,
            "task_completed": scenario.task_completed if settled else None,
            "completion_confidence": {
                "score": scenario.confidence_score,
                "label": scenario.confidence_label,
            }
            if settled
            else None,
            "failure_code": scenario.failure_code if settled else None,
            "completed_at": record.completed_at,
            "metadata": record.payload.get("metadata", {}),
            "recipients": [
                {
                    "phones": [phone],
                    "structured_result": None,
                    "attempts": [
                        {
                            "phone": phone,
                            "transcript_turns": scenario.turns if settled else [],
                        }
                    ],
                }
            ],
        }

    def mcp_view(self, record: CallRecord) -> dict[str, Any] | None:
        overrides = record.scenario.mcp_overrides
        if overrides is None:
            return None
        view = {
            "call_id": record.id,
            "status": record.mcp_status,
            "recipient_phone": record.recipient_phone,
            "completed_at": record.completed_at,
            "metadata": record.payload.get("metadata", {}),
            "transcript_turns": record.scenario.turns if record.settled else [],
        }
        return view | overrides


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def fake(self) -> FakeCalle:
        return self.server.fake

    def log_message(self, *args: Any) -> None:
        return

    def _send(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _fail(self, fault: Fault) -> None:
        if fault.status is None:
            self.close_connection = True
            return
        error: dict[str, Any] = {"code": fault.code, "message": "the fake provider refused"}
        if fault.details is not None:
            error["details"] = fault.details
        self._send(fault.status, {"error": error})

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer ") and header[7:].strip() not in REVOKED:
            return True
        self._send(401, {"error": {"code": "invalid_token", "message": "the token was refused"}})
        return False

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def _not_found(self, what: str) -> None:
        self._send(404, {"error": {"code": "not_found", "message": f"no {what}"}})

    def _route(self) -> list[str]:
        self.fake.requests += 1
        return urlparse(self.path).path.strip("/").split("/")

    def do_GET(self) -> None:
        if not self._authorized():
            return
        parts = self._route()
        if parts[:2] != ["v1", "calls"] or len(parts) < 3:
            self._not_found(f"route for {self.path}")
            return
        record = self.fake.calls.get(parts[2])
        if record is None:
            self._not_found(f"call {parts[2]}")
            return
        fault = self.fake.take_fault(record.recipient_phone, "get")
        if fault is not None:
            self._fail(fault)
            return
        self._send(200, self.fake.rest_view(self.fake.read(parts[2])))

    def do_POST(self) -> None:
        if not self._authorized():
            return
        parts = self._route()
        if parts == ["mcp"]:
            self._handle_mcp()
            return
        if parts == ["v1", "calls"]:
            self._handle_create()
            return
        self._not_found(f"route for {self.path}")

    def _handle_create(self) -> None:
        self.fake.creates += 1
        payload = self._read_json()
        unknown = sorted(set(payload) - CREATE_FIELDS)
        if unknown:
            self._fail(Fault(400, "invalid_request", {"unknown_fields": unknown}))
            return
        key = self.headers.get("Idempotency-Key", "")
        if not key:
            self._send(
                400,
                {"error": {"code": "missing_idempotency_key", "message": "header is required"}},
            )
            return
        phone = recipient_of(payload)
        if phone not in self.fake.scenarios:
            self._send(
                400,
                {"error": {"code": "unknown_recipient", "message": f"no scenario for {phone}"}},
            )
            return

        pending = self.fake.take_fault(phone, "create")
        if pending is not None and not pending.after_create:
            self._fail(pending)
            return

        outcome = self.fake.place(payload, key)
        if isinstance(outcome, Fault):
            self._fail(outcome)
            return

        if pending is not None:
            self._fail(pending)
            return

        record, replayed = outcome
        self._send(200 if replayed else 201, self.fake.rest_view(record))

    def _rpc(self, request_id: Any, body: dict[str, Any]) -> None:
        self._send(200, {"jsonrpc": "2.0", "id": request_id, **body})

    def _handle_mcp(self) -> None:
        request = self._read_json()
        rid, method = request.get("id"), request.get("method")
        if method == "tools/list":
            self._rpc(rid, {"result": {"tools": MCP_TOOLS}})
            return
        if method != "tools/call":
            self._rpc(rid, {"error": {"code": -32601, "message": f"unknown method {method}"}})
            return
        params = request.get("params", {})
        if params.get("name") != "get_call_run":
            self._rpc(rid, {"error": {"code": -32602, "message": "ringdown reads get_call_run"}})
            return
        call_id = params.get("arguments", {}).get("run_id")
        record = self.fake.calls.get(call_id)
        if record is None:
            self._rpc(rid, {"error": {"code": -32004, "message": f"no call run for {call_id}"}})
            return
        fault = self.fake.take_fault(record.recipient_phone, "mcp")
        if fault is not None:
            self._fail(fault)
            return
        view = self.fake.mcp_view(self.fake.read(call_id))
        if view is None:
            self._rpc(rid, {"error": {"code": -32004, "message": f"no call run for {call_id}"}})
            return
        self._rpc(rid, {"result": {"content": [{"type": "text", "text": json.dumps(view)}]}})


class FakeCalleServer:
    def __init__(self, scenarios: dict[str, FakeScenario]) -> None:
        self.fake = FakeCalle(scenarios)
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.fake = self.fake
        self._thread = threading.Thread(
            target=self._server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True
        )

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

    @property
    def mcp_url(self) -> str:
        return f"{self.base_url}/mcp"

    @property
    def created(self) -> list[CallRecord]:
        return self.fake.created

    @property
    def requests(self) -> int:
        return self.fake.requests

    @property
    def creates(self) -> int:
        return self.fake.creates

    def __enter__(self) -> "FakeCalleServer":
        self._thread.start()
        return self

    def __exit__(self, *args: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=2)
