#!/usr/bin/env python3
"""Practice-only preview for clinic-front-desk-confirm. Never dials."""

from __future__ import annotations

import argparse
import json
import uuid


def mask(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"***{digits[-4:]}" if len(digits) >= 4 else "***"


def practice(who: str, when: str, where: str, purpose: str, phone: str, scenario: str) -> dict:
    outcomes = {
        "confirmed": "confirmed",
        "declined": "declined",
        "reschedule_requested": "reschedule_requested",
        "no_answer": "no_answer",
    }
    outcome = outcomes.get(scenario, "confirmed")
    summaries = {
        "confirmed": f"{who} kept {when} at {where} ({mask(phone)}).",
        "declined": f"{who} cancelled the {purpose} ({mask(phone)}).",
        "reschedule_requested": f"{who} asked to move {when} ({mask(phone)}).",
        "no_answer": f"No answer from {mask(phone)} — try again later.",
    }
    script = (
        f"Hi, this is the front desk at {where} calling for {who}. "
        f"Just checking you're still okay for your {purpose} on {when}. "
        "You can say yes to keep it, no to cancel, or ask us to find another time."
    )
    replies = {
        "confirmed": "Yes, that still works.",
        "declined": "I need to cancel, sorry.",
        "reschedule_requested": "Can we move it to a morning?",
        "no_answer": "(no answer)",
    }
    return {
        "outcome": outcome,
        "call": "dry-run",
        "phone": mask(phone),
        "idempotency": f"appt-{uuid.uuid4().hex[:16]}",
        "summary": summaries[outcome],
        "transcript": f"{script}\n[patient] {replies[outcome]}",
        "reschedule_window": "weekday morning if possible" if outcome == "reschedule_requested" else None,
        "raw": {"mode": "dry-run", "scenario": scenario},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Practice clinic appointment confirmation (no dial)")
    parser.add_argument("--practice", action="store_true", default=True, help="Practice mode (default)")
    parser.add_argument("--who", default="Maya Alvarez")
    parser.add_argument("--when", default="Thu 4:15pm")
    parser.add_argument("--where", default="Lakeside Dental")
    parser.add_argument("--purpose", default="hygiene")
    parser.add_argument("--phone", default="+447700900123")
    parser.add_argument(
        "--scenario",
        default="confirmed",
        choices=["confirmed", "declined", "reschedule_requested", "no_answer"],
    )
    args = parser.parse_args()
    print(json.dumps(practice(args.who, args.when, args.where, args.purpose, args.phone, args.scenario), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
