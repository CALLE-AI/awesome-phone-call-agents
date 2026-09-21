#!/usr/bin/env python3
"""calle_booking.py — book restaurant tables / medical appointments via CALL-E.

Wraps the `calle-ai` Python SDK (the CALL-E Developer API) with a
booking-friendly CLI. CALL-E is a goal-driven AI voice agent: give it a goal
+ a phone number and it dials, has a live conversation, and returns a
schema-validated structured result you can feed straight into a calendar.

Subcommands
-----------
plan     Dry-run. Build the task + recipient + result_schema and print them
         WITHOUT contacting CALL-E or dialing. Review this before booking.
         Does not require the calle-ai SDK or an API key.
book     Place the call and block until it reaches a terminal state, then
         print the structured result, per-attempt summary + transcript, and
         completion confidence. REQUIRES --confirm to actually dial.
status   Read the current state of a previously created call (read-only).

Availability ("variant A")
--------------------------
Pass --free-slots with a JSON array of time windows (or the object emitted by
calendar_slots.py) and they are injected into the task so CALL-E books within
your actual free time:

    FREE=$(calendar_slots.py --source google --days 3)
    calle_booking.py plan --kind restaurant --phone "+1..." \
        --free-slots "$FREE" --name "Alex Doe" --party-size 2

Each window is {"start": "ISO8601", "end": "ISO8601"}; a short form
{"date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "timezone": "..."}
is also accepted.

Setup
-----
    pip install calle-ai
    export CALLE_API_KEY="..."   # from https://dashboard.heycall-e.com/account/api-keys

Examples
--------
    # Preview (no call, no API key needed)
    calle_booking.py plan --kind restaurant --phone "+14155551234" \
        --date 2026-08-20 --time 19:00 --party-size 2 --name "Alex Doe" \
        --caller-phone "+14155550000" --email alex@example.com

    # Actually book (dials a real number)
    calle_booking.py book --confirm --kind restaurant --phone "+14155551234" \
        --date 2026-08-20 --time 19:00 --party-size 2 --name "Alex Doe" \
        --caller-phone "+14155550000" --email alex@example.com --pretty

    # Check on an in-flight / finished call
    calle_booking.py status --call-id cal_... --events

Notes
-----
- Phone numbers must include a country code (E.164, e.g. +14155551234).
- Idempotency keys are derived from the request so re-running the identical
  command within CALL-E's idempotency window returns the SAME call instead of
  double-booking. Override with --idempotency-key, or change any flag.
- All output is JSON on stdout (parse with jq or read directly).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_BASE_URL = "https://api.heycall-e.com"


# ---------------------------------------------------------------------------
# Result schemas (what CALL-E must return, schema-validated)
# ---------------------------------------------------------------------------

RESTAURANT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["booked", "date", "time", "party_size", "restaurant_name"],
    "properties": {
        "booked": {"type": "boolean", "description": "True if the reservation was successfully made"},
        "date": {"type": "string", "description": "Reservation date, YYYY-MM-DD"},
        "time": {"type": "string", "description": "Reservation time, HH:MM 24-hour, business local time"},
        "party_size": {"type": "integer", "description": "Number of people"},
        "restaurant_name": {"type": "string"},
        "confirmation_number": {"type": "string", "description": "Booking reference/confirmation number, if given"},
        "notes": {"type": "string", "description": "Any caveats or special notes"},
        "timezone_offset": {"type": "string", "description": "UTC offset of the business, e.g. -04:00 or +02:00, if extractable from the call"},
    },
}

MEDICAL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["booked", "date", "time", "provider_name", "appointment_type"],
    "properties": {
        "booked": {"type": "boolean", "description": "True if the appointment was successfully made"},
        "date": {"type": "string", "description": "Appointment date, YYYY-MM-DD"},
        "time": {"type": "string", "description": "Appointment time, HH:MM 24-hour, clinic local time"},
        "provider_name": {"type": "string", "description": "Doctor / clinic / provider name"},
        "clinic_address": {"type": "string"},
        "appointment_type": {"type": "string", "description": "e.g. GP visit, dental cleaning, physiotherapy"},
        "confirmation_number": {"type": "string", "description": "Booking reference/confirmation number, if given"},
        "notes": {"type": "string", "description": "Any caveats or special notes"},
        "timezone_offset": {"type": "string", "description": "UTC offset of the clinic, e.g. -04:00 or +02:00, if extractable from the call"},
    },
}

GENERIC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["booked", "date", "time", "business_name"],
    "properties": {
        "booked": {"type": "boolean", "description": "True if the booking was successfully made"},
        "date": {"type": "string", "description": "Booking date, YYYY-MM-DD"},
        "time": {"type": "string", "description": "Booking time, HH:MM 24-hour, business local time"},
        "business_name": {"type": "string", "description": "Name of the business / venue / provider"},
        "confirmation_number": {"type": "string", "description": "Booking reference/confirmation number, if given"},
        "notes": {"type": "string", "description": "Any caveats or special notes"},
        "timezone_offset": {"type": "string", "description": "UTC offset of the business, e.g. -04:00 or +02:00, if extractable from the call"},
    },
}

SCHEMAS = {"restaurant": RESTAURANT_SCHEMA, "medical": MEDICAL_SCHEMA, "generic": GENERIC_SCHEMA}


def get_schema(kind: str, schema_file: str | None = None) -> dict[str, Any]:
    """Resolve the result schema for a booking kind.

    - Built-in kinds (restaurant / medical / generic) come from SCHEMAS.
    - --schema-file loads a custom JSON Schema, so ANY booking type can be
      expressed without touching this script.
    """
    if schema_file:
        with open(schema_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return SCHEMAS.get(kind, GENERIC_SCHEMA)


# ---------------------------------------------------------------------------
# SDK import (lazy, so `plan` works without the dependency installed)
# ---------------------------------------------------------------------------

def _import_calle():
    try:
        import calle
        return calle
    except ImportError:
        sys.stderr.write("Missing dependency: `pip install calle-ai`\n")
        sys.exit(2)


def _load_dotenv() -> None:
    """Load $HERMES_HOME/.env (default ~/.hermes/.env) into os.environ, without
    clobbering variables already set. Lets CALLE_API_KEY (and BOOKING_PHONE)
    be picked up without exporting them first."""
    home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    path = os.path.join(home, ".env")
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean_phone(raw: str) -> str:
    """Strip formatting and enforce a leading +. Caller must include the
    country code — a local number without it can't be made E.164 safely."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        raise ValueError(f"Invalid phone number: {raw!r}")
    return "+" + digits


def make_idempotency_key(spec: dict[str, Any]) -> str:
    """Deterministic key derived from the full request, so an accidental
    re-run of the exact same command can't create a second call."""
    digest = hashlib.sha256()
    digest.update(json.dumps(spec, sort_keys=True, default=str).encode("utf-8"))
    return "calle-booking-" + digest.hexdigest()[:32]


def _pad_time(t: str) -> str:
    """Normalize 'HH:MM' to 'HH:MM:00' (fromisoformat requires seconds)."""
    t = str(t).strip()
    if t.count(":") == 1:
        t += ":00"
    return t


def _parse_iso(s: str, default_tz: Any = None) -> datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=default_tz or datetime.now().astimezone().tzinfo)
    return dt


def _fmt_window(start: datetime, end: datetime) -> str:
    if start.date() == end.date():
        return f"{start:%Y-%m-%d %H:%M}–{end:%H:%M}"
    return f"{start:%Y-%m-%d %H:%M} – {end:%Y-%m-%d %H:%M}"


def parse_free_slots(raw: str) -> list[tuple[datetime, datetime]]:
    """Parse --free-slots: a JSON array of {start,end} windows, or the full
    object emitted by calendar_slots.py (which has a 'free_slots' key)."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"--free-slots is not valid JSON: {exc}") from exc
    if isinstance(data, dict) and "free_slots" in data:
        data = data["free_slots"]
    if not isinstance(data, list):
        raise ValueError("--free-slots must be a JSON array of windows (or a calendar_slots.py object)")

    windows: list[tuple[datetime, datetime]] = []
    for w in data:
        if not isinstance(w, dict):
            raise ValueError(f"each free window must be an object, got: {w!r}")
        if "date" in w and "start" in w and "end" in w:
            tz = ZoneInfo(str(w["timezone"])) if w.get("timezone") else None
            s = _parse_iso(f"{w['date']}T{_pad_time(w['start'])}", tz)
            e = _parse_iso(f"{w['date']}T{_pad_time(w['end'])}", tz)
        elif "start" in w and "end" in w:
            s = _parse_iso(str(w["start"]))
            e = _parse_iso(str(w["end"]))
        else:
            raise ValueError(f"unrecognized free window (need start/end or date/start/end): {w!r}")
        if e <= s:
            raise ValueError(f"free window end is not after start: {w!r}")
        windows.append((s, e))
    windows.sort(key=lambda x: x[0])
    return windows


def _free_slots_block(free_windows: list[tuple[datetime, datetime]]) -> str:
    lines = ["I am only available during these windows (book within one of them):"]
    for s, e in free_windows:
        lines.append(f"* {_fmt_window(s, e)}")
    lines.append(
        "Before ending the call, confirm the exact date, time, and any "
        "confirmation/reference number. If none of my available windows work, "
        "ask for and note the closest alternatives to those windows."
    )
    return "\n".join(lines)


def build_task(args: argparse.Namespace, free_windows: list[tuple[datetime, datetime]] | None = None) -> str:
    phone = clean_phone(args.phone)
    tz = f" ({args.timezone})" if args.timezone else ""
    when_parts = [p for p in (args.date, args.time) if p]
    when = " ".join(when_parts) + tz if when_parts else "the soonest available slot"

    contact: list[str] = []
    if args.caller_phone:
        contact.append(f"- Callback number: {clean_phone(args.caller_phone)}")
    if args.email:
        contact.append(f"- Email: {args.email}")

    if free_windows:
        if args.date or args.time:
            when_line = f"- Preferred date and time: {when} (fall back to the windows below)"
        else:
            when_line = "- Date and time: within my available windows (listed below)"
    else:
        when_line = f"- Date and time: {when}"

    if args.kind == "restaurant":
        lines = [
            f"Book a table at the restaurant reached at {phone}.",
            "Goal: make a confirmed reservation.",
            when_line,
            f"- Party size: {args.party_size}",
            f"- Reservation name: {args.name}",
            *contact,
        ]
    elif args.kind == "medical":
        lines = [
            f"Book an appointment at the medical centre reached at {phone}.",
            "Goal: make a confirmed appointment.",
            f"- Patient name: {args.name}",
            when_line,
            f"- Reason for visit: {args.reason}",
            *contact,
        ]
    else:  # generic — any other --kind value (salon, garage, vet, ...)
        lines = [
            f"Book a {args.kind} at the business reached at {phone}.",
            "Goal: make a confirmed booking/appointment.",
            f"- Booking name: {args.name}",
            when_line,
            *contact,
        ]
        if args.reason:
            lines.append(f"- Details: {args.reason}")

    if args.notes:
        lines.append(f"- Special requests / notes: {args.notes}")

    if free_windows:
        lines.append("")
        lines.extend(_free_slots_block(free_windows).split("\n"))
    else:
        lines.append(
            "Before ending the call, confirm the exact date, time, and any "
            "confirmation/reference number. If the requested slot is unavailable, "
            "ask for and note the closest available alternatives."
        )
    return "\n".join(lines)


def build_spec(args: argparse.Namespace) -> dict[str, Any]:
    free_windows = parse_free_slots(args.free_slots) if args.free_slots else None

    # --kind defaults to 'generic' when --task is provided without it
    kind = args.kind or "generic"

    if args.task:
        task = args.task
        if free_windows:
            task = task.rstrip() + "\n\n" + _free_slots_block(free_windows)
    else:
        if not args.kind:
            sys.stderr.write("error: --kind is required (or pass --task)\n")
            sys.exit(2)
        if args.kind == "restaurant" and args.party_size is None:
            sys.stderr.write("error: --party-size is required for restaurant bookings (or pass --task)\n")
            sys.exit(2)
        if args.kind == "medical" and not args.reason:
            sys.stderr.write("error: --reason is required for medical bookings (or pass --task)\n")
            sys.exit(2)
        if not args.task and not args.name:
            sys.stderr.write("error: --name is required (or pass --task which includes the name)\n")
            sys.exit(2)
        task = build_task(args, free_windows)

    metadata: dict[str, Any] = {
        "source": "calle_booking.py",
        "kind": kind,
        "name": args.name,
        "date": args.date,
        "time": args.time,
        "timezone": args.timezone,
        "caller_phone": clean_phone(args.caller_phone) if args.caller_phone else None,
        "email": args.email,
        "free_slots": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in free_windows] if free_windows else None,
    }
    metadata = {k: v for k, v in metadata.items() if v is not None}

    return {
        "task": task,
        "recipient": {"phone": clean_phone(args.phone)},
        "result_schema": get_schema(kind, args.schema_file),
        "metadata": metadata,
    }


def _validate_base_url(base_url: str | None) -> str:
    """Return the approved base URL or exit if it's not the official origin."""
    url = (base_url or DEFAULT_BASE_URL).rstrip("/")
    if url != "https://api.heycall-e.com":
        sys.stderr.write(
            f"error: --base-url must be exactly https://api.heycall-e.com, got {url}\n"
        )
        sys.exit(2)
    return url


def _get_client(args: argparse.Namespace, calle):
    api_key = args.api_key or os.environ.get("CALLE_API_KEY")
    if not api_key:
        sys.stderr.write("No API key: set CALLE_API_KEY or pass --api-key.\n")
        sys.exit(2)
    return calle.CalleClient(api_key=api_key, base_url=_validate_base_url(args.base_url))


def _print(obj: Any, pretty: bool) -> None:
    print(json.dumps(obj, indent=2 if pretty else None, ensure_ascii=False))


def _mask_phone(phone: str) -> str:
    """Mask a phone number for public output."""
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) >= 8:
        return f"+{digits[:2]} {digits[2:4]} *** {digits[-4:]}"
    return "***"



def _validate_e164(phone: str) -> bool:
    """Strict E.164: + then ASCII digits only, 7-15 digit body, no leading zero."""
    s = str(phone).strip()
    if not s.startswith('+'):
        return False
    digits = s[1:]
    if not digits:
        return False
    if not all(c.isascii() and c.isdigit() for c in digits):
        return False
    if digits[0] == '0':
        return False
    if len(digits) < 7 or len(digits) > 15:
        return False
    return True


def _mask_phone(phone: str) -> str:
    """Mask a phone number for public output: +27 87 *** 6508"""
    digits = ''.join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) >= 8:
        return f'+{digits[:2]} {digits[2:4]} *** {digits[-4:]}'
    return '***'


def _mask_result(obj):
    """Recursively mask phone-bearing fields in any nested structure."""
    import re as _re
    if isinstance(obj, dict):
        masked = {}
        for k, v in obj.items():
            if k in ('phone', 'caller_phone') and v:
                masked[k] = _mask_phone(str(v))
            elif isinstance(v, (dict, list)):
                masked[k] = _mask_result(v)
            elif isinstance(v, str):
                masked[k] = _re.sub(
                    r'\+?[1-9]\d{6,14}',
                    lambda m: _mask_phone(m.group()),
                    v
                )
            else:
                masked[k] = v
        return masked
    if isinstance(obj, list):
        return [_mask_result(it) for it in obj]
    return obj


def _envelope(call: dict[str, Any]) -> dict[str, Any]:
    """Public-safe envelope — masked status + result. No raw evidence or diagnostics."""
    sr = call.get("structured_result") or {}
    masked_sr = _mask_result(sr) if sr else None
    events = call.get("events")
    masked_events = _mask_result(events) if events else None
    return {
        "ok": True,
        "call_id": call.get("id"),
        "status": call.get("status"),
        "task_completed": call.get("task_completed"),
        "completion_confidence": call.get("completion_confidence"),
        "structured_result": masked_sr,
        "events": masked_events,
    }


def _safe_spec(spec: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of the spec with sensitive fields masked for preview.
    Task text is shown with phone numbers masked; recipient + metadata phones are masked."""
    import re as _re
    safe = dict(spec)
    if "task" in safe and isinstance(safe["task"], str):
        safe["task"] = _re.sub(
            r'\+?[1-9]\d{6,14}',
            lambda m: _mask_phone(m.group()),
            safe["task"]
        )
    if "recipient" in safe:
        safe["recipient"] = {"phone": _mask_phone(safe["recipient"].get("phone", ""))}
    if "webhook_url" in safe and safe["webhook_url"]:
        safe["webhook_url"] = "***masked***"
    if "metadata" in safe and isinstance(safe["metadata"], dict):
        safe["metadata"] = dict(safe["metadata"])
        if safe["metadata"].get("caller_phone"):
            safe["metadata"]["caller_phone"] = _mask_phone(safe["metadata"]["caller_phone"])
        if safe["metadata"].get("callback_number"):
            safe["metadata"]["callback_number"] = _mask_phone(safe["metadata"]["callback_number"])
    return safe


def _fail(code: int, message: str, pretty: bool) -> None:
    _print({"ok": False, "error": "call failed — see CALL-E dashboard for details"}, pretty)
    sys.exit(code)


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def cmd_plan(args: argparse.Namespace) -> None:
    spec = build_spec(args)
    spec = _safe_spec(spec)
    spec["dry_run"] = True
    spec["note"] = "No call placed. Review the task, then run `book --confirm` to dial."
    _print(spec, args.pretty)


def cmd_book(args: argparse.Namespace) -> None:
    spec = build_spec(args)

    if not _validate_e164(args.phone):
        sys.stderr.write(f"error: invalid E.164 phone number: {args.phone}\n")
        sys.exit(2)

    if not args.confirm:
        out = {
            "dry_run": True,
            "note": "This would place a REAL phone call. Re-run with --confirm to dial.",
            **_safe_spec(spec),
        }
        _print(out, args.pretty)
        sys.stderr.write("Refusing to dial: pass --confirm to actually place the call.\n")
        sys.exit(1)

    # Validate --base-url BEFORE importing the SDK / placing a call,
    # so credentials never reach a non-approved origin.
    _validate_base_url(getattr(args, "base_url", None))

    calle = _import_calle()
    client = _get_client(args, calle)
    idem = args.idempotency_key or make_idempotency_key(spec)
    call_id = None
    use_no_wait = args.no_wait or args.webhook_url is not None
    try:
        call = client.calls.create(
            task=spec["task"],
            recipient=spec["recipient"],
            result_schema=spec["result_schema"],
            metadata=spec["metadata"],
            idempotency_key=idem,
            webhook_url=args.webhook_url,
        )
        call_id = str(call["id"])
        if use_no_wait:
            result = _envelope(call)
            result["idempotency_key"] = idem
            if args.webhook_url:
                result["note"] = (
                    f"Webhook registered. Call {call_id} is in progress; "
                    f"result will be POSTed to {args.webhook_url}."
                )
            else:
                result["note"] = (
                    f"Call {call_id} created but not awaited. "
                    f"Check: $BOOK status --call-id {call_id}"
                )
            _print(result, args.pretty)
            return
        call = client.calls.wait_for_result(
            call_id,
            interval_seconds=args.interval,
            timeout_seconds=args.timeout,
        )
    except calle.CalleAuthenticationError:
        _fail(4, "Authentication failed — check CALLE_API_KEY.", args.pretty)
    except calle.CalleRateLimitError:
        _fail(5, "Rate limited by CALL-E — wait and retry.", args.pretty)
    except calle.CalleTimeoutError:
        _fail(6, f"Timed out waiting for call {call_id} to finish. "
                  f"Check status: $BOOK status --call-id {call_id}", args.pretty)
    except (calle.CalleAPIError, calle.CalleConnectionError) as exc:
        _fail(3, f"CALL-E API error: {exc}", args.pretty)
    finally:
        client.close()

    result = _envelope(call)
    result["idempotency_key"] = idem
    _print(result, args.pretty)


def cmd_status(args: argparse.Namespace) -> None:
    calle = _import_calle()
    client = _get_client(args, calle)
    try:
        call = client.calls.get(args.call_id)
        out = _envelope(call)
        if args.events:
            out["events"] = client.calls.list_events(args.call_id)
    except calle.CalleAuthenticationError:
        _fail(4, "Authentication failed — check CALLE_API_KEY.", args.pretty)
    except calle.CalleAPIError as exc:
        _fail(3, f"CALL-E API error: {exc}", args.pretty)
    finally:
        client.close()

    _print(out, args.pretty)


# ---------------------------------------------------------------------------
# CLI wiring
# ---------------------------------------------------------------------------

def add_booking_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--task",
                   help="Raw natural-language task. Bypasses --kind/--date/--party-size "
                        "templates. Example: 'Call the vet at this number and ask about "
                        "a dog checkup on Thursday. Book it under the name Thethela Faltein.'")
    p.add_argument("--kind",
                   help="Booking type. 'restaurant'/'medical' use built-in templates; "
                        "any other value (salon, garage, vet, ...) uses the generic template. "
                        "Not required when --task is provided.")
    p.add_argument("--schema-file", help="Path to a custom JSON Schema for the result "
                                         "(fully generic bookings — overrides --kind's built-in schema)")
    p.add_argument("--phone", required=True,
                   help="Business phone number to call (E.164 with country code, e.g. +14155551234)")
    p.add_argument("--date", help="Preferred date, YYYY-MM-DD")
    p.add_argument("--time", help="Preferred time, HH:MM 24-hour")
    p.add_argument("--timezone", help="IANA timezone for the date/time, e.g. Europe/London")
    p.add_argument("--name", help="Booking name (full name). Required unless --task is provided.")
    p.add_argument("--caller-phone", help="Your callback number to leave with the business (E.164)")
    p.add_argument("--email", help="Contact email to leave with the business")
    p.add_argument("--party-size", type=int, help="[restaurant] number of people")
    p.add_argument("--reason", help="[medical] reason for the visit")
    p.add_argument("--notes", help="Special requests or notes")
    p.add_argument("--free-slots",
                   help='JSON array of available windows [{"start","end"}] (or a calendar_slots.py object) to inject into the task')


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--api-key", help="CALL-E API key (or set CALLE_API_KEY env var)")
    common.add_argument("--base-url", help=f"CALL-E API base URL (default: {DEFAULT_BASE_URL})")
    common.add_argument("--pretty", action="store_true", help="Pretty-print JSON")

    p = argparse.ArgumentParser(
        prog="calle_booking.py",
        description="Book restaurant tables / medical appointments via CALL-E (calle-ai SDK).",
        parents=[common],
    )
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("plan", parents=[common], help="Dry-run: preview task + schema without dialing")
    add_booking_args(sp)
    sp.set_defaults(func=cmd_plan)

    sp = sub.add_parser("book", parents=[common], help="Place the call (requires --confirm)")
    add_booking_args(sp)
    sp.add_argument("--confirm", action="store_true",
                    help="REQUIRED — actually place the call")
    sp.add_argument("--idempotency-key", help="Override the auto-generated idempotency key")
    sp.add_argument("--interval", type=float, default=5.0,
                    help="Poll interval in seconds (default: 5)")
    sp.add_argument("--timeout", type=float, default=900.0,
                    help="Max seconds to wait for a terminal state (default: 900)")
    sp.add_argument("--no-wait", action="store_true",
                    help="Create the call and exit immediately without polling; use status to check later")
    sp.add_argument("--webhook-url",
                    help="URL for CALL-E to POST the result to; implies --no-wait")
    sp.set_defaults(func=cmd_book)

    sp = sub.add_parser("status", parents=[common], help="Read current state of a call (read-only)")
    sp.add_argument("--call-id", required=True, help="CALL-E call id")
    sp.add_argument("--events", action="store_true", help="Also fetch the event/transcript list")
    sp.set_defaults(func=cmd_status)

    return p


def main(argv: list[str] | None = None) -> int:
    _load_dotenv()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except ValueError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
