"""Terminal webhook receiver for CALL-E, which does not sign its deliveries.

Every delivery is treated as untrusted input:

1. it is served on an unguessable path token (``NOSHOWZERO_WEBHOOK_TOKEN``), compared in constant time;
2. the ``CALL-E-Event-Id`` header must match the body's ``id``;
3. the event id is claimed in SQLite before any side effect (delivery is at-least-once);
4. the call is re-read with ``GET /v1/calls/{id}`` and *that* snapshot is decided on.

A verification failure releases the claim and returns 5xx/409, so CALL-E's retry is not swallowed.
The receiver records one decision row per call and nothing else: it never dials the next waitlist
patient by itself. ``next_action`` tells the operator (or agent) what to run next.

    export CALLE_API_KEY=...  NOSHOWZERO_WEBHOOK_TOKEN=...
    uvicorn noshowzero.webhook:app --port 8000
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

from noshowzero.client import CalleAPIError, CalleClient
from noshowzero.results import TERMINAL, decide

TERMINAL_EVENTS = {"call.completed", "call.failed", "call.result_validation_failed"}

app = FastAPI(title="NoShowZero CALL-E webhook receiver")
app.state.client_factory = CalleClient

_SCHEMA = """
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  call_id TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS call_decisions (
  call_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT,
  outcome TEXT NOT NULL,
  next_action TEXT,
  decision_json TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
"""


@contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(os.environ.get("NOSHOWZERO_DB", "noshowzero.db"))
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


def next_action(decision: dict[str, Any]) -> str | None:
    """What the operator should do next. The receiver itself never places a call."""
    if decision.get("release_slot"):
        return "offer_slot_to_waitlist"
    if decision.get("book"):
        return "book_slot_for_waitlist_patient"
    if decision.get("offer_next"):
        return "offer_slot_to_next_waitlist_patient"
    if decision.get("outcome") in ("needs_review", "unclear", "result_validation_failed"):
        return "front_desk_review"
    return None


def _record(decision: dict[str, Any]) -> str | None:
    action = next_action(decision)
    # Transcripts and phone numbers are not stored; the decision holds CALL-E's summary and notes only.
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO call_decisions VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                decision["call_id"],
                decision["kind"],
                decision.get("appointment_id") or decision.get("entry_id"),
                decision["outcome"],
                action,
                json.dumps(decision),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return action


@app.post("/calle/webhook/{token}")
async def calle_webhook(
    token: str,
    request: Request,
    calle_event_id: str | None = Header(default=None, alias="CALL-E-Event-Id"),
) -> dict[str, Any]:
    expected = os.environ.get("NOSHOWZERO_WEBHOOK_TOKEN", "")
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

    try:
        decision = decide(call)
    except ValueError:
        return {"ok": True, "ignored": "not a NoShowZero call"}
    action = _record(decision)
    return {"ok": True, "kind": decision["kind"], "outcome": decision["outcome"], "next_action": action}
