#!/usr/bin/env python3
# confirm_call.py
"""
liya-appointment-confirm — confirm one appointment over the phone using
CALL-E, and get a structured yes/no (plus any alternate time) back.

Usage
-----
    # Preview only — validates the number and shows exactly what would be
    # sent. Makes NO network call and places NO real call.
    python confirm_call.py --task "Confirm the 10am appointment tomorrow" \\
        --phone +12025550123 --region US --dry-run

    # Place the real call (prompts for an explicit typed confirmation
    # first, since this has a real-world side effect):
    python confirm_call.py --task "Confirm the 10am appointment tomorrow" \\
        --phone +12025550123 --region US

    # Skip the interactive prompt (e.g. for scripting/CI):
    python confirm_call.py --task "..." --phone +1... --region US --yes

    # Check a call you already placed, instead of placing a new one:
    python confirm_call.py --check call_abc123

See README.md for setup, side effects, cancellation, and credential
handling notes.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import calle_client as calle

_STATE_DIR = Path.home() / ".liya_appointment_confirm"
_STATE_FILE = _STATE_DIR / "recent_calls.json"
_DEDUPE_WINDOW_SECONDS = 600  # 10 minutes

_DEFAULT_RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "confirmed": {
            "type": "boolean",
            "description": "Whether the recipient confirmed they can attend.",
        },
        "reason": {
            "type": "string",
            "description": "Reason given if they can't attend, if any.",
        },
        "alternate_time_requested": {
            "type": "string",
            "description": "An alternate time they proposed, if any.",
        },
    },
    "required": ["confirmed"],
}


def _mask(phone: str) -> str:
    """Mask everything but the last 3 digits, for anything printed to a
    shared terminal/log — the destination is only fully shown in the
    interactive confirmation prompt itself."""
    digits_only = "".join(c for c in phone if c.isdigit())
    if len(digits_only) <= 3:
        return phone
    return phone[: -len(digits_only) or None] + "*" * (len(digits_only) - 3) + digits_only[-3:]


def _load_recent_calls() -> dict:
    try:
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_recent_call(phone_digits: str, call_id: str) -> None:
    _STATE_DIR.mkdir(parents=True, exist_ok=True)
    data = _load_recent_calls()
    data[phone_digits] = {"call_id": call_id, "placed_at": time.time()}
    _STATE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _check_duplicate(phone_digits: str) -> str | None:
    data = _load_recent_calls()
    entry = data.get(phone_digits)
    if not entry:
        return None
    age = time.time() - entry.get("placed_at", 0)
    if age < _DEDUPE_WINDOW_SECONDS:
        return (
            f"A call to this same number was already placed {int(age)}s ago "
            f"(call id {entry.get('call_id')}). Re-run with --force if this "
            f"is genuinely a new, separate call."
        )
    return None


def cmd_check(call_id: str) -> int:
    try:
        call = calle.get_call(call_id)
    except calle.CallEError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(calle.summarize(call))
    return 0


def cmd_place(args: argparse.Namespace) -> int:
    try:
        phone = calle.normalize_phone(args.phone, args.region)
    except calle.CallEError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    phone_digits = "".join(c for c in phone if c.isdigit())

    print("=== Call preview ===")
    print(f"  Recipient : {_mask(phone)}")
    print(f"  Region    : {args.region}")
    print(f"  Task      : {args.task}")
    print(f"  Result schema: confirmed (bool), reason, alternate_time_requested")
    print()

    if args.dry_run:
        print("Dry run only — no network request was made, no call was placed.")
        return 0

    if not args.force:
        dup = _check_duplicate(phone_digits)
        if dup:
            print(f"Skipped: {dup}", file=sys.stderr)
            return 1

    if not args.yes:
        print(f"This will place a REAL phone call to {phone}.")
        confirm = input("Type YES to proceed: ").strip()
        if confirm != "YES":
            print("Not placed — confirmation not received.")
            return 1

    idempotency_key = calle.new_idempotency_key()
    try:
        created = calle.create_call(
            task=args.task,
            phone=phone,
            region=args.region,
            locale=args.locale,
            result_schema=None if args.no_schema else _DEFAULT_RESULT_SCHEMA,
            idempotency_key=idempotency_key,
        )
    except calle.CallEError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    call_id = created.get("id")
    if not call_id:
        print(f"Error: CALL-E did not return a call id: {created}", file=sys.stderr)
        return 1

    _save_recent_call(phone_digits, call_id)
    print(f"Call placed. call_id = {call_id}")

    if args.no_wait:
        print(f"Not waiting for completion — check later with:\n  python confirm_call.py --check {call_id}")
        return 0

    print("Waiting for the call to finish (this can take up to a few minutes)...")
    call = calle.poll_until_done(call_id, timeout_seconds=args.timeout)
    print()
    print(calle.summarize(call))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task", help="What the call should accomplish, in plain language.")
    parser.add_argument("--phone", help="Recipient phone number (E.164 preferred, e.g. +12025550123).")
    parser.add_argument("--region", default="US", help="Recipient region code CALL-E supports (default: US).")
    parser.add_argument("--locale", default=None, help="Spoken language/locale, e.g. en-IN.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and preview only — no call is placed.")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive typed confirmation prompt.")
    parser.add_argument("--force", action="store_true", help="Bypass the duplicate-call guard.")
    parser.add_argument("--no-wait", action="store_true", help="Return immediately after placing the call instead of polling for the result.")
    parser.add_argument("--no-schema", action="store_true", help="Don't request a structured result — just a free-text summary.")
    parser.add_argument("--timeout", type=int, default=180, help="Max seconds to poll for a result (default: 180).")
    parser.add_argument("--check", metavar="CALL_ID", help="Check the status/result of a previously placed call instead of placing a new one.")
    args = parser.parse_args()

    if args.check:
        return cmd_check(args.check)

    if not args.task or not args.phone:
        parser.error("--task and --phone are required unless using --check")

    return cmd_place(args)


if __name__ == "__main__":
    sys.exit(main())
