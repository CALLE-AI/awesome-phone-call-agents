"""Local fake server simulating POST /v1/calls and GET /v1/calls/{call_id}.

REST-only, stdlib only. Modeled on the style of
apps/python/ringdown/fake/calle_server.py, but scoped to the REST call
lifecycle only (no MCP surface), matching this app's client.py.

Simulates the queued -> in_progress -> completed lifecycle and returns a
structured_result shaped by the CreateCallRequest.result_schema field of the
create request, so client.py can be proven end to end without ever
reaching api.heycall-e.com. This is the default and only target for
test_e2e.py; a real call requires the client's --allow-live flag plus the
compliance gate allowing it (see compliance/), neither of which this fake
server participates in.

Fault injection (used to exercise the client's error handling, matching
components.schemas.APIError.code in calle.openapi.yaml):
  - Authorization header missing/empty -> 401 unauthorized
  - recipient region == "ZZ"           -> 400 unsupported_region
  - recipient locale == "zz-ZZ"        -> 400 unsupported_language
  - recipient phone == "+10000000001"  -> 402 insufficient_balance
  - recipient phone == "+10000000002"  -> 429 rate_limit_exceeded, once,
                                           then succeeds on retry

For Reality Resolver's patient_intent result_schema specifically (see
verdict.patient_intent_result_schema), the completed structured_result
is selected by recipient phone instead of always the happy path:
  - recipient phone == "+10000000004"  -> patient_intent=cancelled,
                                           answered_by=human
  - recipient phone == "+10000000005"  -> patient_intent=unknown,
                                           answered_by=voicemail
  - any other phone                    -> patient_intent=confirmed,
                                           answered_by=human
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

CREATE_CALL_FIELDS = frozenset(
    {"task", "recipients", "result_schema", "recipient_result_schema", "metadata", "webhook_url"}
)
RECIPIENT_FIELDS = frozenset({"phones", "locale", "region"})

INSUFFICIENT_BALANCE_PHONE = "+10000000001"
RATE_LIMITED_ONCE_PHONE = "+10000000002"

# Reserved phones selecting a canned patient_intent/answered_by pair for
# Reality Resolver's result_schema (see verdict.patient_intent_result_schema),
# same convention as the two constants above. Any other phone stays the
# default confirmed/human happy path.
PATIENT_CANCELLED_PHONE = "+10000000004"
PATIENT_VOICEMAIL_PHONE = "+10000000005"

READS_TO_IN_PROGRESS = 1
READS_TO_COMPLETED = 2


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def api_error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


@dataclass
class CallRecord:
    id: str
    payload: dict[str, Any]
    created_at: datetime
    reads: int = 0

    @property
    def status(self) -> str:
        if self.reads < READS_TO_IN_PROGRESS:
            return "queued"
        if self.reads < READS_TO_COMPLETED:
            return "in_progress"
        return "completed"

    @property
    def settled(self) -> bool:
        return self.status == "completed"

    @property
    def completed_at(self) -> str | None:
        if not self.settled:
            return None
        return stamp(self.created_at + timedelta(seconds=self.reads))


def _patient_intent_result_for(properties: dict[str, Any], phone: str | None) -> dict[str, Any]:
    """Canned patient_intent/answered_by pair, selected by which of the
    3 reserved phone numbers is on the request - same fault-injection
    style as INSUFFICIENT_BALANCE_PHONE/RATE_LIMITED_ONCE_PHONE. Any
    other phone is the default confirmed/human happy path.
    """
    if phone == PATIENT_CANCELLED_PHONE:
        patient_intent, answered_by = "cancelled", "human"
    elif phone == PATIENT_VOICEMAIL_PHONE:
        patient_intent, answered_by = "unknown", "voicemail"
    else:
        patient_intent, answered_by = "confirmed", "human"

    result: dict[str, Any] = {"patient_intent": patient_intent}
    if "answered_by" in properties:
        result["answered_by"] = answered_by
    if "confidence_note" in properties:
        result["confidence_note"] = (
            "Fake server: deterministic canned result, not extracted from real call evidence."
        )
    if "manipulation_attempt_detected" in properties:
        result["manipulation_attempt_detected"] = False
    return result


def structured_result_for(result_schema: dict[str, Any] | None, phone: str | None = None) -> dict[str, Any] | None:
    """Return a schema-plausible structured_result for this fake server.

    Real CALL-E extracts this from call evidence with a model. The fake
    server has no call evidence, so it returns a fixed value taken from the
    schema's own enums when the shape matches a schema this app knows about,
    and None otherwise (matching the documented "null when no result_schema
    was provided or extraction failed" behavior). Fills next_action,
    confidence_note, and manipulation_attempt_detected too, when the
    schema declares them, so the fake server exercises the full result
    shape end to end.
    """
    if not result_schema:
        return None
    properties = result_schema.get("properties", {})

    if "patient_intent" in properties:
        return _patient_intent_result_for(properties, phone)

    intent_property = properties.get("intent")
    if not (isinstance(intent_property, dict) and "enum" in intent_property):
        return None

    enum_values = intent_property["enum"]
    result: dict[str, Any] = {"intent": "appointment" if "appointment" in enum_values else enum_values[0]}

    next_action_property = properties.get("next_action")
    if isinstance(next_action_property, dict) and "enum" in next_action_property:
        next_action_values = next_action_property["enum"]
        result["next_action"] = (
            "schedule_callback" if "schedule_callback" in next_action_values else next_action_values[0]
        )

    if "confidence_note" in properties:
        result["confidence_note"] = (
            "Fake server: deterministic canned result, not extracted from real call evidence."
        )

    if "manipulation_attempt_detected" in properties:
        # The fake server has no real call evidence of an attack, so it
        # always reports none.
        result["manipulation_attempt_detected"] = False

    if "answered_by" in properties:
        # Fake server has no real call evidence; always simulates the
        # happy path (reached a human), consistent with its canned
        # "Hello from the fake server." / "Understood, goodbye." transcript.
        result["answered_by"] = "human"

    return result


class FakeCalle:
    def __init__(self) -> None:
        self.calls: dict[str, CallRecord] = {}
        self.by_key: dict[str, str] = {}
        self.rate_limited_once_keys: set[str] = set()
        self.requests = 0
        self.creates = 0
        self._lock = threading.Lock()

    def consume_rate_limit_once(self, key: str | None) -> bool:
        """Return True (and record it) the first time this key is seen.

        Used to simulate exactly one 429 per Idempotency-Key, so a client
        retry with the same key is expected to succeed on the next attempt.
        """
        marker = key or "<no-idempotency-key>"
        with self._lock:
            if marker in self.rate_limited_once_keys:
                return False
            self.rate_limited_once_keys.add(marker)
            return True

    def next_id(self) -> str:
        return f"call_fake{len(self.calls) + 1}"

    def place(self, payload: dict[str, Any], key: str | None) -> tuple[CallRecord, bool]:
        with self._lock:
            if key and key in self.by_key:
                existing = self.calls[self.by_key[key]]
                return existing, True
            record = CallRecord(id=self.next_id(), payload=payload, created_at=datetime.now(UTC))
            self.calls[record.id] = record
            if key:
                self.by_key[key] = record.id
            return record, False

    def read(self, call_id: str) -> CallRecord | None:
        with self._lock:
            record = self.calls.get(call_id)
            if record is not None:
                record.reads += 1
            return record

    def rest_view(self, record: CallRecord) -> dict[str, Any]:
        payload = record.payload
        settled = record.settled
        result_schema = payload.get("result_schema")
        recipients_in = payload.get("recipients") or []
        first_phone = (recipients_in[0].get("phones") or [None])[0] if recipients_in else None
        structured_result = structured_result_for(result_schema, first_phone) if settled else None

        recipients_out = []
        for index, recipient_in in enumerate(recipients_in):
            recipients_out.append(
                {
                    "id": f"{record.id}_rcp{index + 1}",
                    "phones": recipient_in.get("phones", []),
                    "locale": recipient_in.get("locale"),
                    "region": recipient_in.get("region"),
                    "status": "completed" if settled else record.status,
                    "structured_result": None,
                    "summary": "Fake recipient outcome." if settled else None,
                    "attempts": [
                        {
                            "id": f"{record.id}_att1",
                            "phone": (recipient_in.get("phones") or [""])[0],
                            "status": "completed" if settled else record.status,
                            "started_at": stamp(record.created_at),
                            "completed_at": record.completed_at,
                            "summary": "Fake attempt outcome." if settled else None,
                            "transcript_turns": (
                                [
                                    {"offset_seconds": 0, "speaker": "bot", "text": "Hello from the fake server."},
                                    {"offset_seconds": 4, "speaker": "user", "text": "Understood, goodbye."},
                                ]
                                if settled
                                else []
                            ),
                            "provider_call_id": f"fake_provider_{record.id}" if settled else None,
                            "failure_code": None,
                            "failure_message": None,
                        }
                    ],
                }
            )

        return {
            "id": record.id,
            "object": "call_task",
            "status": record.status,
            "task": payload.get("task", ""),
            "recipients": recipients_out,
            "structured_result": structured_result,
            "summary": "Fake call completed successfully." if settled else None,
            "task_completed": True if settled else None,
            "completion_confidence": {"score": 0.9, "label": "high"} if settled else None,
            "evidence": ["The fake server always reports success."] if settled else [],
            "metadata": payload.get("metadata", {}),
            "failure_code": None,
            "failure_message": None,
            "created_at": stamp(record.created_at),
            "completed_at": record.completed_at,
        }

    def events_view(self, record: CallRecord) -> dict[str, Any]:
        events = [
            {
                "id": f"{record.id}_evt1",
                "type": "call.queued",
                "call_id": record.id,
                "created_at": stamp(record.created_at),
                "level": "info",
                "status": "queued",
                "message": "Call task accepted by the fake server.",
                "details": {},
            }
        ]
        if record.status in ("in_progress", "completed"):
            events.append(
                {
                    "id": f"{record.id}_evt2",
                    "type": "call.in_progress",
                    "call_id": record.id,
                    "created_at": stamp(record.created_at + timedelta(seconds=1)),
                    "level": "info",
                    "status": "in_progress",
                    "message": "Fake dial started.",
                    "details": {},
                }
            )
        if record.settled:
            events.append(
                {
                    "id": f"{record.id}_evt3",
                    "type": "call.completed",
                    "call_id": record.id,
                    "created_at": record.completed_at,
                    "level": "info",
                    "status": "completed",
                    "message": "Fake call completed.",
                    "details": {},
                }
            )
        return {"object": "list", "data": events, "next_cursor": None}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def fake(self) -> FakeCalle:
        return self.server.fake  # type: ignore[attr-defined]

    def log_message(self, *args: Any) -> None:
        return

    def _send(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer ") and header[len("Bearer "):].strip():
            return True
        self._send(401, api_error("unauthorized", "missing or empty bearer token"))
        return False

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw or b"{}")

    def _route(self) -> list[str]:
        self.fake.requests += 1
        return urlparse(self.path).path.strip("/").split("/")

    def do_GET(self) -> None:
        if not self._authorized():
            return
        parts = self._route()
        if parts[:2] != ["v1", "calls"] or len(parts) < 3:
            self._send(404, api_error("not_found", f"no route for {self.path}"))
            return
        call_id = parts[2]
        if call_id not in self.fake.calls:
            self._send(404, api_error("not_found", f"no call {call_id}"))
            return

        if len(parts) == 4 and parts[3] == "events":
            # Reading events does not advance the queued -> in_progress ->
            # completed simulation; only GET /v1/calls/{id} does that.
            record = self.fake.calls[call_id]
            self._send(200, self.fake.events_view(record))
            return

        record = self.fake.read(call_id)
        assert record is not None
        self._send(200, self.fake.rest_view(record))

    def do_POST(self) -> None:
        if not self._authorized():
            return
        parts = self._route()
        if parts != ["v1", "calls"]:
            self._send(404, api_error("not_found", f"no route for {self.path}"))
            return
        self._handle_create()

    def _handle_create(self) -> None:
        self.fake.creates += 1
        payload = self._read_json()

        unknown = sorted(set(payload) - CREATE_CALL_FIELDS)
        if unknown:
            self._send(400, api_error("invalid_request", "unknown top-level fields", {"fields": unknown}))
            return
        if "task" not in payload or not isinstance(payload["task"], str) or not payload["task"]:
            self._send(400, api_error("invalid_request", "task is required and must be a non-empty string"))
            return

        recipients = payload.get("recipients")
        if recipients is not None:
            for recipient in recipients:
                extra = sorted(set(recipient) - RECIPIENT_FIELDS)
                if extra:
                    self._send(
                        400, api_error("invalid_recipient", "unknown recipient fields", {"fields": extra})
                    )
                    return
                phones = recipient.get("phones") or []
                if not phones:
                    self._send(400, api_error("no_recipients", "recipient has no phones"))
                    return
                phone = phones[0]
                region = recipient.get("region")
                locale = recipient.get("locale")

                if region == "ZZ":
                    self._send(400, api_error("unsupported_region", f"region {region} is not enabled"))
                    return
                if locale == "zz-ZZ":
                    self._send(400, api_error("unsupported_language", f"locale {locale} is not supported"))
                    return
                if phone == INSUFFICIENT_BALANCE_PHONE:
                    self._send(402, api_error("insufficient_balance", "account balance is too low"))
                    return
                if phone == RATE_LIMITED_ONCE_PHONE:
                    idempotency_key = self.headers.get("Idempotency-Key")
                    if self.fake.consume_rate_limit_once(idempotency_key):
                        self._send(429, api_error("rate_limit_exceeded", "too many requests, retry shortly"))
                        return

        idempotency_key = self.headers.get("Idempotency-Key")
        record, replayed = self.fake.place(payload, idempotency_key)
        self._send(200 if replayed else 201, self.fake.rest_view(record))


class FakeCalleServer:
    """Context manager that runs the fake server on a random local port."""

    def __init__(self) -> None:
        self.fake = FakeCalle()
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.fake = self.fake  # type: ignore[attr-defined]
        self._thread = threading.Thread(
            target=self._server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True
        )

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}"

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


if __name__ == "__main__":
    with FakeCalleServer() as server:
        print(json.dumps({"base_url": server.base_url}))
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
