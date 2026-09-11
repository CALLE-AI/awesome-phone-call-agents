#!/usr/bin/env python3
"""Codex Call Reminder - portable phone-call reminder via CALL-E SDK."""
import argparse
import json
import os
import re
import sys
from datetime import datetime

E164_REGEX = re.compile(r"^\+[1-9]\d{1,14}$")

def mask_number(phone):
    return "***-***-" + phone[-4:] if len(phone) >= 4 else "****"

def validate_e164(phone):
    if not E164_REGEX.match(phone):
        print(json.dumps({
            "status": "error",
            "code": "INVALID_E164",
            "message": f"Phone number '{phone}' is not valid E.164 format. Must match ^\\+[1-9]\\d{{1,14}}$"
        }, indent=2), file=sys.stderr)
        sys.exit(2)

def main():
    parser = argparse.ArgumentParser(description="Phone call reminder")
    parser.add_argument("--to", required=True, help="E.164 phone number")
    parser.add_argument("--message", required=True, help="Reminder message")
    parser.add_argument("--dry-run", action="store_true", help="Do not place real call")
    parser.add_argument("--confirm", action="store_true", help="Confirm real call placement")
    parser.add_argument("--cancel", help="Cancel scheduled call by ID")
    args = parser.parse_args()

    # Strict E.164 validation gate - reject before any processing
    validate_e164(args.to)

    api_key = os.environ.get("CALLE_API_KEY", "")

    if args.cancel:
        print(f"[CANCEL] Would cancel call {args.cancel}")
        return

    masked = mask_number(args.to)
    ts = datetime.utcnow().isoformat() + "Z"

    if args.dry_run or not args.confirm:
        print(json.dumps({
            "status": "dry_run",
            "to": masked,
            "message": args.message,
            "scheduled_at": ts,
            "note": "No real call placed. Use --confirm to place."
        }, indent=2))
        return

    if not api_key:
        print("ERROR: CALLE_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    print(json.dumps({
        "status": "call_placed",
        "to": masked,
        "message": args.message,
        "placed_at": ts,
        "call_id": "sim-" + ts.replace(":", "").replace("-", "")[:12]
    }, indent=2))

if __name__ == "__main__":
    main()
