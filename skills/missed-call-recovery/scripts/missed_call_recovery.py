#!/usr/bin/env python3
"""Missed-call recovery: call a lead back after the business missed their call.

Turns one missed-call event into at most one outbound recovery call, one
schema-validated lead result, and one dashboard post. Dry-run is the default:
no call is placed and nothing is posted without --execute --approved-real-calls.

Uses only the Python standard library. Places calls through the CALL-E CLI
(`calle call start` / `calle call status`), matching the provider boundary used
by the other skills in this repository.

Exit codes: 0 success (including a successful refusal to act), 1 validation or
configuration error, 2 provider error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

SCHEMA_VERSION = "1"
GOAL_VERSION = "1"
MAX_ATTEMPTS = 2
RETRY_SPACING_MINUTES = 30
RECOVERY_WINDOW_MINUTES = 30
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
TERMINAL_STATUSES = {
    "BUSY",
    "CANCELED",
    "CANCELLED",
    "COMPLETED",
    "DECLINED",
    "EXPIRED",
    "FAILED",
    "NO_ANSWER",
    "VOICEMAIL",
}
NO_HUMAN_STATUSES = {"NO_ANSWER", "VOICEMAIL"}
SECRET_KEYS = {"access_token", "refresh_token", "confirm_token", "session_secret", "token"}

LEAD_INTENTS = ["Booking", "Quote", "Support", "Information", "WrongNumber", "NotInterested"]
URGENCIES = ["Emergency", "Urgent", "Normal", "Flexible"]
DISPOSITIONS = ["Completed", "EndedEarly", "Declined", "DoNotCall", "NotReached"]

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "consent_granted": {"type": "boolean"},
        "disposition": {"type": "string", "enum": DISPOSITIONS},
        "disposition_evidence": {"type": "string"},
        "lead_intent": {"type": "string", "enum": LEAD_INTENTS},
        "need_summary": {"type": "string"},
        "urgency": {"type": "string", "enum": URGENCIES},
        "callback_slot": {"type": "string"},
        "wants_booking": {"type": "boolean"},
        "notes": {"type": "string"},
    },
    "required": ["consent_granted", "disposition", "disposition_evidence"],
}


def fail(message: str, code: int = 1) -> "SystemExit":
    print(f"ERROR: {message}", file=sys.stderr)
    return SystemExit(code)


def mask_phone(number: str) -> str:
    """Mask the middle of an E.164 number; keep country+area shape and last 4."""
    if len(number) <= 8:
        return "*" * len(number)
    return f"{number[:5]}****{number[-4:]}"


def redact(value: Any) -> Any:
    """Recursively remove secret-looking keys and mask phone-looking values."""
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if k.lower() in SECRET_KEYS else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str) and E164_RE.match(value):
        return mask_phone(value)
    return value


def load_event(path: Path) -> dict[str, Any]:
    try:
        event = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise fail(f"cannot read event file {path}: {exc}")
    if not isinstance(event, dict):
        raise fail("event file must contain a JSON object")
    return event


def validate_event(event: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    for field in ("eventId", "callerPhoneNumber", "businessName", "missedAt", "timezone"):
        if not event.get(field):
            problems.append(f"missing required field: {field}")
    phone = event.get("callerPhoneNumber", "")
    if phone and not E164_RE.match(str(phone)):
        problems.append(f"callerPhoneNumber is not E.164: {mask_phone(str(phone))}")
    try:
        ZoneInfo(str(event.get("timezone", "")))
    except Exception:
        if event.get("timezone"):
            problems.append(f"unknown timezone: {event.get('timezone')}")
    return problems


def working_hours_ok(missed_at: datetime, tz: ZoneInfo) -> tuple[bool, str]:
    local = missed_at.astimezone(tz)
    if local.weekday() >= 5:
        return False, "next business morning"
    if not 9 <= local.hour < 18:
        return False, "next business morning"
    return True, "within 30-minute window"


def build_goal(event: dict[str, Any]) -> str:
    business = str(event["businessName"])
    caller = str(event.get("callerName") or "the caller")
    slots = event.get("availableSlots") or []
    slot_line = ""
    if slots:
        offered = ", ".join(f"{s}" for s in slots[:4])
        slot_line = (
            f" If they want a booking, offer only these pre-approved slots: {offered}."
            " Never confirm a slot as final; say a person will confirm."
        )
    return (
        f"You are calling {caller} back on behalf of {business}. "
        "The business missed their inbound call. Follow this order and allow interruption:\n"
        f"1. Apologize: say {business} is sorry it missed their call, and that you are calling to help now. "
        "If asked whether you are a person, say you are an automated assistant.\n"
        "2. Ask if now is a good moment. If not, offer to call back later and end the call.\n"
        "3. Identify the need: ask what they were calling about, one question at a time. "
        "Summarize it in one sentence.\n"
        "4. Classify urgency as Emergency, Urgent, Normal, or Flexible. If anything suggests an emergency "
        "or safety risk, tell them to hang up and contact emergency services, end the call, and record "
        "urgency as Emergency. Never give medical, legal, or financial advice.\n"
        f"5. Offer booking.{slot_line} Record the time they ask for exactly as spoken.\n"
        "6. Wrap up: summarize what happens next, thank them, end.\n"
        "For price, availability, or policy questions, say a person will confirm. Never invent an answer.\n"
        "Return the structured result with consent_granted, disposition, and disposition_evidence always filled."
    )


def idempotency_key(event: dict[str, Any], attempt_no: int) -> str:
    digest_payload = "|".join(
        [
            str(event["callerPhoneNumber"]),
            GOAL_VERSION,
            SCHEMA_VERSION,
            str(event.get("language", "English")),
        ]
    )
    digest = hashlib.sha256(digest_payload.encode("utf-8")).hexdigest()[:8]
    return f"recovery:{event['eventId']}:{attempt_no}:{digest}"


def load_state(path: Path) -> dict[str, Any]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def calle_command(args: list[str], calle_bin: str) -> dict[str, Any]:
    resolved = shutil.which(calle_bin) if not Path(calle_bin).exists() else calle_bin
    if resolved is None:
        raise fail(f"CALL-E CLI not found: {calle_bin}. See references/safety.md before installing.", 2)
    proc = subprocess.run(
        [resolved, *args],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0:
        sys.stderr.write(redact(proc.stderr.strip()) + "\n")
        raise fail(f"calle {' '.join(args[:2])} failed with exit {proc.returncode}", 2)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"stdout": proc.stdout.strip()}


def start_call(event: dict[str, Any], calle_bin: str) -> dict[str, Any]:
    args = [
        "call", "start",
        "--to-phone", str(event["callerPhoneNumber"]),
        "--goal", build_goal(event),
    ]
    if event.get("language"):
        args += ["--language", str(event["language"])]
    if event.get("region"):
        args += ["--region", str(event["region"])]
    return calle_command(args, calle_bin)


def poll_call(run_id: str, calle_bin: str, timeout_s: int, interval_s: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_s
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        time.sleep(interval_s)
        latest = calle_command(["call", "status", "--run-id", run_id], calle_bin)
        if str(latest.get("status", "")).upper() in TERMINAL_STATUSES:
            return latest
    return latest


def extract_result(call_output: dict[str, Any]) -> dict[str, Any]:
    for container_key in ("result", "structured_result", "data"):
        container = call_output.get(container_key)
        if isinstance(container, dict):
            candidate = container.get("result", container)
            if isinstance(candidate, dict) and candidate.get("disposition"):
                return candidate
    if isinstance(call_output.get("disposition"), str):
        return call_output
    return {}


def validate_result(result: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Validate against the declared schema: drop undeclared, refuse bad enums."""
    errors: list[str] = []
    validated: dict[str, Any] = {}
    props = RESULT_SCHEMA["properties"]
    for key, value in result.items():
        if key not in props:
            continue  # undeclared fields are dropped, not stored
        spec = props[key]
        expected_type = spec.get("type")
        if expected_type == "boolean" and not isinstance(value, bool):
            errors.append(f"{key}: expected boolean")
            continue
        if expected_type == "string":
            if not isinstance(value, str):
                errors.append(f"{key}: expected string")
                continue
            enum = spec.get("enum")
            if enum and value not in enum:
                errors.append(f"{key}: {value!r} not in {enum}")
                continue
        validated[key] = value
    for key in RESULT_SCHEMA["required"]:
        if key not in validated:
            errors.append(f"{key}: required field missing")
    return validated, errors


def classify(validated: dict[str, Any], errors: list[str], status: str) -> dict[str, Any]:
    """Ordered classification: refusal first, then no-human, then consent."""
    disposition = validated.get("disposition")
    if errors:
        return {"outcome": "needs-review", "reason": "; ".join(errors)}
    if disposition in ("Declined", "DoNotCall"):
        return {"outcome": "declined", "disposition": disposition}
    if validated.get("consent_granted") is False:
        return {"outcome": "declined", "disposition": disposition or "Declined"}
    if disposition == "NotReached" and status.upper() in NO_HUMAN_STATUSES:
        return {"outcome": "not-reached", "disposition": "NotReached"}
    if status.upper() in NO_HUMAN_STATUSES and not validated:
        return {"outcome": "not-reached", "disposition": "NotReached"}
    if disposition == "EndedEarly":
        return {"outcome": "partial", "disposition": "EndedEarly"}
    if disposition == "Completed" and validated.get("consent_granted") is True:
        return {"outcome": "recovered", "disposition": "Completed"}
    return {"outcome": "needs-review", "reason": f"indeterminate disposition/result (status {status})"}


LEAD_FIELDS = ["lead_intent", "need_summary", "urgency", "callback_slot", "wants_booking", "notes"]


def dashboard_payload(event: dict[str, Any], outcome_info: dict[str, Any],
                      validated: dict[str, Any], attempt_no: int, key: str) -> dict[str, Any]:
    outcome = outcome_info["outcome"]
    lead: dict[str, Any] | None = None
    if outcome == "recovered":
        lead = {field: validated.get(field) for field in LEAD_FIELDS if field in validated}
    elif outcome == "partial":
        lead = {"partial": True, **{f: validated[f] for f in LEAD_FIELDS if f in validated}}
    return {
        "schema": "callbackops/lead-result@" + SCHEMA_VERSION,
        "event_id": event["eventId"],
        "outcome": outcome,
        "masked_caller": mask_phone(str(event["callerPhoneNumber"])),
        "business_name": event["businessName"],
        "lead": lead,
        "attempt": {"number": attempt_no, "cap": MAX_ATTEMPTS, "idempotency_key": key},
        "posted_at": datetime.now(timezone.utc).isoformat(),
    }


def post_dashboard(payload: dict[str, Any], url: str, token: str | None) -> str:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    last_error = "unknown error"
    for attempt in range(3):
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if 200 <= response.status < 300:
                    return f"posted ({response.status})"
                last_error = f"HTTP {response.status}"
        except urllib.error.HTTPError as exc:
            if exc.code == 429 or 500 <= exc.code < 600:
                last_error = f"HTTP {exc.code}"
            else:
                return f"blocked (HTTP {exc.code}, not retried)"
        except urllib.error.URLError as exc:
            last_error = str(exc.reason)
        time.sleep(2 ** attempt)
    return f"failed after retries ({last_error}); kept for --post-dashboard"


def main(argv: list[str] | None = None) -> SystemExit | None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--event", required=True, type=Path, help="missed-call event JSON")
    parser.add_argument("--state", required=True, type=Path, help="dedupe and attempt state JSON")
    parser.add_argument("--execute", action="store_true", help="actually place the call")
    parser.add_argument("--approved-real-calls", action="store_true",
                        help="required with --execute; confirms the dry-run was reviewed")
    parser.add_argument("--poll", action="store_true", help="poll to a terminal status before classifying")
    parser.add_argument("--output", type=Path, help="append result records as JSONL")
    parser.add_argument("--dashboard-webhook", help="override CALLBACKOPS_DASHBOARD_URL")
    parser.add_argument("--post-dashboard", type=Path,
                        help="retry a kept dashboard record without placing another call")
    parser.add_argument("--calle-bin", default="calle", help="CALL-E CLI binary")
    parser.add_argument("--poll-timeout", type=int, default=600)
    parser.add_argument("--poll-interval", type=int, default=10)
    args = parser.parse_args(argv)

    if args.post_dashboard:
        record = json.loads(args.post_dashboard.read_text(encoding="utf-8"))
        url = args.dashboard_webhook or os.environ.get("CALLBACKOPS_DASHBOARD_URL", "")
        token = os.environ.get("CALLBACKOPS_DASHBOARD_TOKEN")
        if not url:
            raise fail("no dashboard webhook configured (CALLBACKOPS_DASHBOARD_URL)")
        print(post_dashboard(record, url, token))
        return None

    event = load_event(args.event)
    problems = validate_event(event)
    if problems:
        for problem in problems:
            print(f"status: not called\nblocker: {problem}", file=sys.stderr)
        raise fail("event validation failed")

    state = load_state(args.state)
    event_id = str(event["eventId"])
    record = state.setdefault("events", {}).setdefault(event_id, {"attempts": 0, "done": False})
    phone = str(event["callerPhoneNumber"])

    blockers: list[str] = []
    if record.get("done"):
        blockers.append("event already has a completed recovery conversation")
    if phone in state.get("do_not_call", []):
        blockers.append("caller number is on the do-not-call record")
    if record["attempts"] >= MAX_ATTEMPTS:
        blockers.append(f"attempt cap reached ({MAX_ATTEMPTS})")
    try:
        missed_at = datetime.fromisoformat(str(event["missedAt"]))
    except ValueError:
        raise fail("missedAt is not a parseable timestamp")
    tz = ZoneInfo(str(event["timezone"]))
    in_window, window_note = working_hours_ok(missed_at, tz)
    if not in_window:
        blockers.append(f"outside working hours; schedule for {window_note}")
    if blockers:
        print("status: not called")
        for blocker in blockers:
            print(f"blocker: {blocker}")
        print("supply: resolve the blockers above, or schedule the recovery manually")
        save_state(args.state, state)
        return None

    attempt_no = record["attempts"] + 1
    key = idempotency_key(event, attempt_no)
    goal = build_goal(event)
    masked = mask_phone(phone)

    if not (args.execute and args.approved_real_calls):
        print("DRY-RUN: no call will be placed")
        print(f"event          {event_id}")
        print(f"caller         {masked}" + (f" ({event.get('callerName')})" if event.get("callerName") else ""))
        print(f"business       {event['businessName']}")
        print(f"idempotency    {key}")
        print(f"dashboard      {'set (env)' if (args.dashboard_webhook or os.environ.get('CALLBACKOPS_DASHBOARD_URL')) else 'not set'}")
        print(f"goal           {len(goal.split())} words, opens with apology + disclosure")
        print(f"schema         {len(RESULT_SCHEMA['properties'])} properties, {len(RESULT_SCHEMA['required'])} required")
        print("approve with   --execute --approved-real-calls")
        return None

    # Reserve the attempt durably before dialing.
    record["attempts"] = attempt_no
    record[f"attempt_{attempt_no}"] = {"idempotency_key": key, "started_at": datetime.now(timezone.utc).isoformat()}
    save_state(args.state, state)

    try:
        call_output = start_call(event, args.calle_bin)
    except SystemExit:
        record[f"attempt_{attempt_no}"]["state"] = "needs-review"
        save_state(args.state, state)
        raise
    status = str(call_output.get("status", ""))
    run_id = str(call_output.get("run_id") or call_output.get("runId") or call_output.get("id") or "")
    if args.poll and run_id and status.upper() not in TERMINAL_STATUSES:
        call_output = poll_call(run_id, args.calle_bin, args.poll_timeout, args.poll_interval)
        status = str(call_output.get("status", status))

    result = extract_result(call_output)
    validated, errors = validate_result(result)
    outcome_info = classify(validated, errors, status)
    outcome = outcome_info["outcome"]

    terminal_outcomes = {"recovered", "partial", "declined", "needs-review"}
    record["last_outcome"] = outcome
    if outcome in terminal_outcomes:
        record["done"] = True
    if outcome == "declined" and outcome_info.get("disposition") == "DoNotCall":
        dnc = state.setdefault("do_not_call", [])
        if phone not in dnc:
            dnc.append(phone)
    save_state(args.state, state)

    payload = dashboard_payload(event, outcome_info, validated, attempt_no, key)
    dashboard_note = "skipped (outcome permits no lead fields)" if payload["lead"] is None else None
    if dashboard_note is None:
        url = args.dashboard_webhook or os.environ.get("CALLBACKOPS_DASHBOARD_URL", "")
        token = os.environ.get("CALLBACKOPS_DASHBOARD_TOKEN")
        if not url:
            dashboard_note = "kept (no dashboard webhook configured)"
        else:
            dashboard_note = post_dashboard(payload, url, token)

    retry_note = "not permitted"
    if outcome == "not-reached" and attempt_no < MAX_ATTEMPTS:
        retry_note = f"scheduled: +{RETRY_SPACING_MINUTES} min, attempt {attempt_no + 1} of {MAX_ATTEMPTS}"

    print(f"outcome        {outcome}")
    print(f"caller         {masked}")
    print(f"disposition    {validated.get('disposition', outcome_info.get('disposition', 'n/a'))}")
    evidence = validated.get("disposition_evidence")
    if evidence:
        print(f"evidence       {evidence[:120]}")
    for field in LEAD_FIELDS:
        if field in validated:
            print(f"{field:<14} {validated[field]}")
    if errors:
        print(f"validation     {len(errors)} field error(s): {'; '.join(errors[:3])}")
    print(f"dashboard      {dashboard_note}")
    print(f"attempt        {attempt_no} of {MAX_ATTEMPTS}; retry: {retry_note}")
    print(f"idempotency    {key}")

    if args.output:
        kept = dict(payload)
        if "failed after retries" in dashboard_note or "kept (" in dashboard_note:
            kept_record = args.output.with_suffix(".dashboard-retry.json")
            kept_record.write_text(json.dumps(redact(kept), indent=2), encoding="utf-8")
            print(f"kept record    {kept_record} (retry with --post-dashboard)")
        with args.output.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(redact(kept)) + "\n")
    return None


if __name__ == "__main__":
    main()
