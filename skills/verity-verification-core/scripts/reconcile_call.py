#!/usr/bin/env python3
"""Reconcile a completed CALL-E call against the value it was supposed to write.

    python scripts/reconcile_call.py --call assets/experience-b.call.json \
        --input assets/experience-b.input.json

`--call` is a CALL-E `WebhookEvent` or a bare `CallTask` (JSON). `--input` is
`{ intent, intended_value, business_tz? }`. Prints the parsed target, the ambiguity
flags, the verdict (ALLOW / BLOCK + reason_code), and on BLOCK the `repair_target` to
quote on a second channel. Voicemail, self-correction, ambiguity, or an unconfirmed
value are reported as BLOCK — never as a verified result.

Exit code: 0 on ALLOW, 2 on BLOCK, 1 on bad input. Standard library only; no network.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verity_gate import call_task_from, verify  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--call", required=True, type=Path)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--json", action="store_true", help="emit the full result as JSON")
    args = ap.parse_args()

    spec = json.loads(args.input.read_text(encoding="utf-8"))
    doc = json.loads(args.call.read_text(encoding="utf-8"))
    task = call_task_from(doc)

    out = verify(
        task,
        intent=spec["intent"],
        intended=spec["intended_value"],
        business_tz=spec.get("business_tz", spec["intended_value"]["timezone"]),
    )
    parsed, ambiguity, decision = out["parsed"], out["ambiguity"], out["decision"]

    if args.json:
        print(json.dumps(out, indent=2))
        return 0 if decision["decision"] == "ALLOW" else 2

    conf = (task.get("completion_confidence") or {}).get("label", "null")
    tgt = parsed["resolved_targets"][0] if parsed["resolved_targets"] else None
    print(f"call            : {task.get('id', '(no id)')}  status={task['status']}")
    print(f"CALL-E claim    : task_completed={task.get('task_completed')} confidence={conf}")
    print(f"intended value  : {spec['intended_value']['appointment_date']} "
          f"{spec['intended_value']['appointment_time']} ({spec['intent']})")
    print(f"parsed target   : {tgt['date'] + ' ' + tgt['time'] if tgt else '(none)'}  "
          f"explicit_confirmation={parsed['explicit_confirmation']}  partial={parsed['partial']}")
    print(f"ambiguity flags : [{', '.join(ambiguity['flags']) or 'none'}]")
    print(f"VERDICT         : {decision['decision']}  reason={decision['reason_code']}"
          + ("  (ghost booking prevented)" if decision["ghost_booking_prevented"] else ""))
    if decision["decision"] == "BLOCK" and decision["repair_target"]:
        rt = decision["repair_target"]
        print(f"repair_target   : {rt['appointment_date']} {rt['appointment_time']} "
              f"{rt['timezone']}  ->  confirm on a second channel (e.g. SMS 'reply YES')")
    elif decision["decision"] == "BLOCK":
        print("repair_target   : none  ->  route to a human")

    return 0 if decision["decision"] == "ALLOW" else 2


if __name__ == "__main__":
    sys.exit(main())
