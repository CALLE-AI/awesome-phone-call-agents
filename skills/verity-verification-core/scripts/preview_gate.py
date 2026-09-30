#!/usr/bin/env python3
"""Preview the call plan and the E1-E7 checklist Verity will apply. No call is placed.

    python scripts/preview_gate.py --input assets/experience-b.input.json
    python scripts/preview_gate.py --input my-input.json --verification-id ver_8471 \
        --recipient +12025550123

The input JSON is `{ intent, intended_value, business_tz? }`. Output is deterministic:
the natural-language task text, the `result_schema`, a deterministic idempotency key
(only when --verification-id is given), a masked recipient (only when --recipient is
given), and the exact evidence the reconcile step will require. Standard library only;
never opens a socket.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RESULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "appointment_date": {"type": "string", "description": "YYYY-MM-DD the caller agreed to"},
        "appointment_time": {"type": "string", "description": "HH:mm 24h the caller agreed to"},
        "timezone": {"type": "string", "description": "IANA timezone, e.g. America/New_York"},
        "confirmed": {"type": "boolean", "description": "true only if the caller explicitly said yes"},
    },
}

TASK_TEMPLATES = {
    "book": ("Call {recipient} and book a {service} for the customer on {date} at {time} "
             "{tz}. Ask them to confirm the day and time."),
    "reschedule": ("Call {recipient} and reschedule the customer's appointment to a {service} "
                   "on {date} at {time} {tz}. Confirm the new day and time."),
    "confirm": ("Call {recipient} and confirm the customer's {service} on {date} at {time} "
                "{tz}. Ask them to say the day and time back."),
}

CHECKLIST = [
    ("E1", "task_completed == true and confidence is not 'low' (necessary, never sufficient)"),
    ("E2", "the transcript resolves to exactly one datetime after self-correction"),
    ("E3", "that parsed value exactly equals the value above (date + time + timezone)"),
    ("E4", "a bot turn restated the full value AND the caller affirmed it"),
    ("E5", "no open ambiguity flag (self-correction / multi-time / relative date / "
           "no-confirmation / claim-parse-mismatch)"),
    ("E6", "a fresh re-check shows the resource is still yours and not expired"),
    ("E7", "no learned failure pattern demands a second channel or a hard block"),
]


def mask_e164(num: str) -> str:
    digits = "".join(ch for ch in num if ch.isdigit())
    if len(digits) < 4:
        return "<PHONE>"
    return f"+{'*' * (len(digits) - 2)}{digits[-2:]}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--verification-id", default=None,
                    help="your durable workflow id; makes the idempotency key deterministic")
    ap.add_argument("--recipient", default=None, help="E.164 recipient; shown masked only")
    args = ap.parse_args()

    spec = json.loads(args.input.read_text(encoding="utf-8"))
    intent = spec["intent"]
    v = spec["intended_value"]
    tz = spec.get("business_tz", v["timezone"])
    recipient = args.recipient or "<RECIPIENT_E164>"

    task_text = TASK_TEMPLATES[intent].format(
        recipient=mask_e164(recipient) if args.recipient else recipient,
        service=v["service_type"], date=v["appointment_date"], time=v["appointment_time"], tz=tz,
    )

    print("CALL PLAN  (nothing has been dialed)")
    print(f"  intent           : {intent}")
    print(f"  value to write   : {v['appointment_date']} {v['appointment_time']} {v['timezone']} "
          f"({v['service_type']})")
    print(f"  recipient        : {mask_e164(recipient) if args.recipient else recipient}")
    if args.verification_id:
        print(f"  idempotency key  : verity:{args.verification_id}:v1")
    else:
        print("  idempotency key  : (pass --verification-id to make it deterministic)")
    print(f"  task text        : {task_text}")
    print(f"  result_schema    : {json.dumps(RESULT_SCHEMA)}")
    print()
    print("AFTER THE CALL, reconcile_call.py will require ALL of:")
    for code, text in CHECKLIST:
        print(f"  {code}  {text}")
    print()
    print("Any missing field, any open ambiguity, any thrown error -> BLOCK, never ALLOW.")
    print("Voicemail, a mid-sentence correction, and an unconfirmed value are all BLOCK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
