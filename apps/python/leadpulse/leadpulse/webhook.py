"""Terminal webhook receiver for CALL-E, which does not sign its deliveries.

Every delivery is treated as untrusted input:

1. it is served on an unguessable path token (``LEADPULSE_WEBHOOK_TOKEN``);
2. the ``CALL-E-Event-Id`` header must match the body's ``id``;
3. the event id is claimed in SQLite before any side effect (delivery is at-least-once);
4. the call is re-read with ``GET /v1/calls/{id}`` and *that* snapshot is decided on.

A verification failure releases the claim and returns 5xx, so CALL-E's retry is not
swallowed. The receiver records one decision row per call and performs no other side
effects.

    export CALLE_API_KEY=...  LEADPULSE_WEBHOOK_TOKEN=...
    uvicorn leadpulse.webhook:app --port 8000
"""
from __future__ import annotations

import hmac
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Iterator

from fastapi import FastAPI, Header, HTTPException, Request

from leadpulse.client import CalleAPIError, CalleClient
from leadpulse.results import TERMINAL, decide

TERMINAL_EVENTS = {"call.completed", "call.failed", "call.result_validation_failed"}

app = FastAPI(title="LeadPulse CALL-E webhook receiver")
app.state.client_factory = CalleClient

_SCHEMA = """
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  call_id TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lead_decisions (
  call_id TEXT PRIMARY KEY,
  lead_id TEXT,
  outcome TEXT NOT NULL,
  score INTEGER,
  hot_lead INTEGER NOT NULL,
  send_booking_link INTEGER NOT NULL,
  decision_json TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
"""


@contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(os.environ.get("LEADPULSE_DB", "leadpulse.db"))
    try:
        conn.executescript(_SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def _claim(event_id: str, event_type: str, call_id: str) -> bool:
    with _db() as conn:
        try:
            conn.execute(
                "INSERT INTO webhook_events VALUES (?, ?, ?, ?)",
                (event_id, event_type, call_id, datetime.now(timezone.utc).isoformat()),
            )
            return True
        except sqlite3.IntegrityError:
            return False


def _release(event_id: str) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM webhook_events WHERE event_id = ?", (event_id,))


def _record(decision: dict[str, Any]) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO lead_decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                decision["call_id"],
                decision.get("lead_id"),
                decision["outcome"],
                decision.get("score"),
                int(decision["hot_lead"]),
                int(decision["send_booking_link"]),
                json.dumps(decision),
                datetime.now(timezone.utc).isoformat(),
            ),
        )


@app.post("/calle/webhook/{token}")
async def calle_webhook(
    token: str,
    request: Request,
    calle_event_id: str | None = Header(default=None, alias="CALL-E-Event-Id"),
) -> dict[str, Any]:
    expected = os.environ.get("LEADPULSE_WEBHOOK_TOKEN", "")
    if not expected or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(404, "Not found")

    try:
        event = json.loads(await request.body())
    except ValueError:
        raise HTTPException(400, "Malformed JSON")
    if not isinstance(event, dict):
        raise HTTPException(400, "Event must be a JSON object")

    event_id, event_type = event.get("id"), event.get("type")
    if not calle_event_id or calle_event_id != event_id:
        raise HTTPException(400, "Missing or mismatched CALL-E-Event-Id")
    if event_type not in TERMINAL_EVENTS:
        return {"ok": True, "ignored": event_type}

    call_id = str((event.get("data") or {}).get("id") or "")
    if not call_id.startswith("call_"):
        raise HTTPException(400, "Event data is missing a call id")

    if not _claim(str(event_id), str(event_type), call_id):
        return {"ok": True, "duplicate": True}

    factory: Callable[[], CalleClient] = request.app.state.client_factory
    try:
        call = factory().get_call(call_id)
    except (CalleAPIError, RuntimeError) as exc:
        _release(str(event_id))
        raise HTTPException(502, f"Could not verify call: {getattr(exc, 'code', 'error')}")

    if call.get("status") not in TERMINAL:
        _release(str(event_id))
        raise HTTPException(409, "Call is not terminal yet")

    decision = decide(call)
    _record(decision)
    return {"ok": True, "outcome": decision["outcome"], "score": decision["score"]}
