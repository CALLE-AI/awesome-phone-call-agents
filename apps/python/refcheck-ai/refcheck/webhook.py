"""Terminal webhook receiver for reference calls.

CALL-E webhooks are unsigned — there is no webhook secret, `CALL-E-Timestamp`
or `CALL-E-Signature` header, and the SDK's `webhooks.verify` / `webhooks.unwrap`
are retained only for integrations running their own signing layer. So this
receiver treats every delivery as untrusted input:

  1. it serves on an unguessable path token,
  2. it requires `CALL-E-Event-Id` to match the body's `event.id`,
  3. it re-fetches `GET /v1/calls/{call_id}` with the API key and stores *that*
     snapshot — the posted body is only a notification that something changed.

Delivery is at-least-once, so an event id is claimed in SQLite before any side
effect and duplicates are answered 200 without reprocessing. A verification
failure releases the claim and returns 5xx so CALL-E's retry is not swallowed.

Run it:

    CALLE_API_KEY=... REFCHECK_WEBHOOK_TOKEN=... \
        uvicorn refcheck.webhook:app --port 8000
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, Header, HTTPException, Request

from refcheck.client import get_client
from refcheck.results import (
    OUTCOME_TO_STATUS,
    extract_duration_seconds,
    extract_provider_call_id,
    extract_transcript,
    rehire_to_bool,
)
from refcheck.scoring import compute_reference_score

TERMINAL_EVENTS = {"call.completed", "call.failed", "call.result_validation_failed"}
TERMINAL_STATUSES = {"completed", "failed", "canceled"}

DB_PATH = Path(os.environ.get("REFCHECK_DB", "refcheck.db"))
router = APIRouter()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "create table if not exists webhook_events ("
        " event_id text primary key, event_type text not null,"
        " call_id text not null, received_at text default current_timestamp)"
    )
    conn.execute(
        "create table if not exists reference_results ("
        " reference_id text primary key, call_id text, call_status text,"
        " call_outcome text, score real, result_json text, transcript text,"
        " duration_seconds integer, provider_call_id text)"
    )
    conn.commit()
    return conn


def claim_event(conn: sqlite3.Connection, event_id: str, event_type: str, call_id: str) -> bool:
    """False when this event id was already recorded."""
    try:
        conn.execute(
            "insert into webhook_events (event_id, event_type, call_id) values (?, ?, ?)",
            (event_id, event_type, call_id),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def release_event(conn: sqlite3.Connection, event_id: str) -> None:
    conn.execute("delete from webhook_events where event_id = ?", (event_id,))
    conn.commit()


def store_result(conn: sqlite3.Connection, reference_id: str, call: dict[str, Any]) -> float | None:
    result = call.get("structured_result") or {}
    if not result:
        recipients = call.get("recipients") or [{}]
        result = recipients[0].get("structured_result") or {}

    outcome = result.get("call_outcome")
    score = compute_reference_score(result.get("answers"), result.get("referee_enthusiasm"))

    if call.get("status") != "completed":
        # Do NOT translate a generic failure into "no answer" or "declined" —
        # the Calls API does not publish those codes.
        call_status = "failed"
    else:
        call_status = OUTCOME_TO_STATUS.get(outcome or "unknown", "completed")

    conn.execute(
        "insert or replace into reference_results"
        " (reference_id, call_id, call_status, call_outcome, score, result_json,"
        "  transcript, duration_seconds, provider_call_id)"
        " values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            reference_id,
            str(call.get("id") or ""),
            call_status,
            outcome,
            score,
            json.dumps(
                {**result, "would_rehire_bool": rehire_to_bool(result.get("would_rehire"))}
            ),
            extract_transcript(call),
            extract_duration_seconds(call),
            extract_provider_call_id(call),
        ),
    )
    conn.commit()
    return score


@router.post("/calle/webhook/{token}")
async def receive(
    token: str,
    request: Request,
    calle_event_id: str | None = Header(default=None, alias="CALL-E-Event-Id"),
):
    expected = os.environ.get("REFCHECK_WEBHOOK_TOKEN")
    if not expected or token != expected:
        raise HTTPException(404, "Not found")

    try:
        event = json.loads(await request.body())
    except ValueError:
        raise HTTPException(400, "Malformed JSON")
    if not isinstance(event, dict):
        raise HTTPException(400, "Event must be a JSON object")

    if not calle_event_id or calle_event_id != event.get("id"):
        raise HTTPException(400, "Missing or mismatched CALL-E-Event-Id")

    if event.get("type") not in TERMINAL_EVENTS:
        return {"ok": True, "ignored": event.get("type")}

    call_id = (event.get("data") or {}).get("id")
    if not call_id:
        raise HTTPException(400, "Event data is missing a call id")

    conn = connect()
    if not claim_event(conn, event["id"], event["type"], call_id):
        return {"ok": True, "duplicate": True}

    try:
        call = get_client().calls.get(call_id)
    except Exception as exc:
        release_event(conn, event["id"])
        raise HTTPException(502, f"Could not verify call {call_id}: {exc}")

    if call.get("status") not in TERMINAL_STATUSES:
        release_event(conn, event["id"])
        raise HTTPException(409, "Call is not in a terminal state yet")

    reference_id = str((call.get("metadata") or {}).get("reference_id") or "")
    if not reference_id:
        return {"ok": True, "ignored": "no reference_id in metadata"}

    score = store_result(conn, reference_id, call)
    return {"ok": True, "reference_id": reference_id, "score": score}


app = FastAPI(title="RefCheck webhook receiver")
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
