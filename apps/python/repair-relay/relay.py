"""Repair Relay: bounded repair availability calls and durable result review."""
import argparse
import copy
import hashlib
import json
import os
import re
import sqlite3
import urllib.request
from datetime import datetime
from pathlib import Path


SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["outcome", "available_window_ids", "quote", "notes"],
    "properties": {
        "outcome": {"type": "string", "enum": ["available", "unavailable", "callback", "unknown"]},
        "available_window_ids": {"type": "array", "items": {"type": "string"}},
        "quote": {"type": "string"},
        "notes": {"type": "string"},
    },
}


def validate_case(case):
    for key in ("case_id", "organization", "repair", "contact", "windows"):
        if not case.get(key):
            raise ValueError(f"Missing {key}")
    contact = case["contact"]
    if not re.fullmatch(r"\+1[2-9]\d{9}", contact.get("phone", "")):
        raise ValueError("This prototype supports US E.164 numbers only")
    if contact.get("consent") is not True:
        raise ValueError("Contact consent must be recorded before preparing outreach")
    ids = set()
    for window in case["windows"]:
        ident = window.get("id")
        if not isinstance(ident, str) or not ident or ident in ids:
            raise ValueError("Window IDs must be unique nonempty strings")
        ids.add(ident)
        start, end = (datetime.fromisoformat(window[k]) for k in ("start", "end"))
        if start.utcoffset() is None or end.utcoffset() is None or start >= end:
            raise ValueError("Windows must have timezone offsets and increasing times")
    return case


def preview(case):
    validate_case(case)
    windows = "\n".join(f"{w['id']}: {w['start']} to {w['end']}" for w in case["windows"])
    task = (
        f"You are an AI calling assistant for {case['organization']}. "
        "Identify yourself as an AI assistant at the beginning. "
        f"Ask whether the recipient is available for this repair: {case['repair']}. "
        "You are collecting availability only. Do not book an appointment, authorize work, "
        "agree to charges, collect payment details, or promise a technician will arrive. "
        "The coordinator will confirm separately. Ask which of these windows work, "
        "read back the dates and local offsets, and capture the corresponding IDs. "
        "If none work, ask whether a callback is wanted. Respect refusal and stop. "
        "Do not leave repair details on voicemail. Return unknown when no person confirms. "
        "Quote the recipient's exact availability statement; do not invent a quote.\n"
        + windows
    )
    body = {
        "task": task,
        "recipients": [{"phones": [case["contact"]["phone"]], "region": "US", "locale": "en-US"}],
        "recipient_result_schema": SCHEMA,
        "metadata": {"workflow_run_id": case["case_id"]},
    }
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    return {"approval_digest": digest, "request": body, "synthetic": case.get("synthetic", False)}


def connect(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("""CREATE TABLE IF NOT EXISTS calls (
        digest TEXT PRIMARY KEY, case_json TEXT NOT NULL, state TEXT NOT NULL,
        call_id TEXT, result_json TEXT, decision TEXT, reason TEXT)""")
    return db


def api(method, path, body=None, digest=None):
    key = os.environ.get("CALLE_API_KEY")
    if not key:
        raise ValueError("Set CALLE_API_KEY in your environment; never put it in the case file")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if digest:
        headers["Idempotency-Key"] = f"repair-relay-{digest}"
    request = urllib.request.Request(
        "https://api.heycall-e.com" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers, method=method,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def send(db, case, approval, transport=api):
    plan = preview(case)
    digest = plan["approval_digest"]
    if approval != digest:
        raise ValueError("Approval does not match this exact call preview")
    if plan["synthetic"]:
        raise ValueError("Synthetic cases cannot place live calls")
    if not os.environ.get("CALLE_API_KEY") and transport is api:
        raise ValueError("CALLE_API_KEY is missing")
    with db:
        # Unique insert is also the concurrency guard. A failed/uncertain request
        # remains recorded and cannot silently create another outbound call.
        db.execute("INSERT INTO calls(digest,case_json,state) VALUES (?,?,?)",
                   (digest, json.dumps(case), "sending"))
    try:
        result = transport("POST", "/v1/calls", plan["request"], digest)
        call_id = result.get("id") or result.get("call_id")
        if not isinstance(call_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", call_id):
            raise ValueError("Provider response did not contain a usable call ID")
        with db:
            db.execute("UPDATE calls SET state='submitted',call_id=? WHERE digest=?", (call_id, digest))
        return {"digest": digest, "state": "submitted", "call_id": call_id}
    except Exception:
        with db:
            db.execute("UPDATE calls SET state='unknown' WHERE digest=?", (digest,))
        raise RuntimeError("Call creation is uncertain. Do not retry; reconcile with the provider dashboard.") from None


def assess(case, result):
    """Evidence presence does not establish semantic truth; a person reviews it."""
    invalid = {"state": "needs_review", "reason": "Malformed provider response", "windows": []}
    if not isinstance(result, dict):
        return invalid
    if result.get("status") != "completed" or result.get("task_completed") is not True:
        return {"state": "needs_review", "reason": "Provider did not report a completed task", "windows": []}
    recipients = result.get("recipients", [])
    if not isinstance(recipients, list) or len(recipients) != 1 or not isinstance(recipients[0], dict):
        return {"state": "needs_review", "reason": "Expected exactly one recipient result", "windows": []}
    recipient = recipients[0]
    data = recipient.get("structured_result") or {}
    if not isinstance(data, dict):
        return invalid
    quote = data.get("quote", "")
    attempts = recipient.get("attempts", [])
    if not isinstance(attempts, list) or not all(isinstance(a, dict) for a in attempts):
        return invalid
    turns = []
    for attempt in attempts:
        transcript = attempt.get("transcript_turns", [])
        if not isinstance(transcript, list):
            return invalid
        for turn in transcript:
            if not isinstance(turn, dict) or not isinstance(turn.get("text"), str):
                return invalid
            if turn.get("speaker") == "user":
                turns.append(turn["text"])
    supported = isinstance(quote, str) and bool(quote.strip()) and any(quote in t for t in turns)
    ids = data.get("available_window_ids", [])
    known = {w["id"]: w for w in case["windows"]}
    valid_ids = isinstance(ids, list) and all(isinstance(i, str) and i in known for i in ids)
    if not supported or not valid_ids or data.get("outcome") not in SCHEMA["properties"]["outcome"]["enum"]:
        return {"state": "needs_review", "reason": "Missing recipient evidence or invalid structured fields", "windows": []}
    if data["outcome"] != "available" or not ids:
        return {"state": "needs_review", "reason": "No availability confirmed", "windows": [], "quote": quote}
    return {"state": "review_ready", "reason": "Check the quoted evidence before accepting availability",
            "quote": quote, "windows": [known[i] for i in dict.fromkeys(ids)]}


def refresh(db, digest, transport=api):
    row = db.execute("SELECT * FROM calls WHERE digest=?", (digest,)).fetchone()
    if row is None or not row["call_id"]:
        raise ValueError("No provider call ID; reconcile an uncertain create in the dashboard")
    result = transport("GET", "/v1/calls/" + row["call_id"])
    assessment = assess(json.loads(row["case_json"]), result)
    with db:
        serialized = json.dumps(result, sort_keys=True)
        previous = json.loads(row["result_json"]) if row["result_json"] else None
        changed = previous != result
        db.execute("UPDATE calls SET result_json=?,state=?,decision=?,reason=? WHERE digest=?",
                   (serialized, assessment["state"], None if changed else row["decision"],
                    None if changed else row["reason"], digest))
    return assessment


def decide(db, digest, decision, reason):
    if decision not in ("accept_availability", "reject") or not reason.strip():
        raise ValueError("Provide an explicit review decision and reason")
    with db:
        row = db.execute("SELECT * FROM calls WHERE digest=?", (digest,)).fetchone()
        if row is None or row["state"] not in ("review_ready", "needs_review"):
            raise ValueError("Fetch and review the call result first")
        if decision == "accept_availability" and row["state"] != "review_ready":
            raise ValueError("Unsupported availability cannot be accepted")
        db.execute("UPDATE calls SET decision=?,reason=? WHERE digest=?", (decision, reason, digest))
    return {"decision": decision, "reason": reason, "appointment_booked": False}


def handoff(db, window_id, capacity):
    """Export only reviewed availability for one exact session, never bookings."""
    if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
        raise ValueError("Capacity must be a positive integer")
    proposals = []
    session = None
    for row in db.execute("SELECT * FROM calls WHERE decision='accept_availability' ORDER BY digest"):
        case = json.loads(row["case_json"])
        result = json.loads(row["result_json"])
        assessment = assess(case, result)
        if assessment["state"] != "review_ready":
            raise ValueError("An accepted result no longer has supported evidence; review it again")
        window = next((w for w in assessment["windows"] if w["id"] == window_id), None)
        if window is None:
            continue
        bounds = (window["start"], window["end"])
        if session is not None and session != bounds:
            raise ValueError("Window ID refers to different session times across cases")
        session = bounds
        proposals.append({"case_id": case["case_id"], "digest": row["digest"],
                          "repair": case["repair"], "window": window,
                          "quote": assessment["quote"], "review_reason": row["reason"],
                          "synthetic": case.get("synthetic", False)})
    if len(proposals) > capacity:
        raise ValueError("Reviewed proposals exceed session capacity; revise the review decisions")
    return {"appointment_booked": False, "window_id": window_id, "capacity": capacity,
            "proposals": proposals, "remaining_places": capacity - len(proposals),
            "instruction": "Coordinator must confirm appointments separately. Keep this export private."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="relay.sqlite3")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "send", "evaluate"):
        cmd = commands.add_parser(name)
        cmd.add_argument("case", type=Path)
        if name == "send":
            cmd.add_argument("--approve", required=True, help="Exact digest from reviewed preview")
        if name == "evaluate":
            cmd.add_argument("result", type=Path)
    refresh_cmd = commands.add_parser("refresh")
    refresh_cmd.add_argument("digest")
    decision_cmd = commands.add_parser("decide")
    decision_cmd.add_argument("digest")
    decision_cmd.add_argument("decision", choices=["accept_availability", "reject"])
    decision_cmd.add_argument("--reason", required=True)
    handoff_cmd = commands.add_parser("handoff", help="Export reviewed proposals for one session")
    handoff_cmd.add_argument("--window-id", required=True)
    handoff_cmd.add_argument("--capacity", type=int, required=True)
    args = parser.parse_args()
    try:
        if args.command in ("preview", "send", "evaluate"):
            case = validate_case(json.loads(args.case.read_text(encoding="utf-8")))
        if args.command == "preview":
            output = copy.deepcopy(preview(case))
            phone = output["request"]["recipients"][0]["phones"][0]
            output["request"]["recipients"][0]["phones"] = ["+1******" + phone[-4:]]
            output["note"] = "Destination masked for display; digest binds the complete destination in your case file."
        elif args.command == "evaluate":
            output = assess(case, json.loads(args.result.read_text(encoding="utf-8")))
        else:
            with connect(args.db) as db:
                if args.command == "send":
                    output = send(db, case, args.approve)
                elif args.command == "refresh":
                    output = refresh(db, args.digest)
                elif args.command == "handoff":
                    output = handoff(db, args.window_id, args.capacity)
                else:
                    output = decide(db, args.digest, args.decision, args.reason)
        print(json.dumps(output, indent=2))
    except (ValueError, RuntimeError, sqlite3.IntegrityError, OSError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
