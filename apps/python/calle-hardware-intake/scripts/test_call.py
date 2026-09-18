"""Trigger a real outbound CALL-E call and log a ticket from the result.

This makes an actual phone call (consumes a CALL-E credit). Usage:

    python scripts/test_call.py +15551234567 "Confirm the 10am diagnostic slot"

Options:
    --dry-plan   Only plan the call; never dial. Good for verifying the CLI shape.

Requirements: CALL-E logged in (`calle auth login`) and Gemini key in `.env`.
"""
import asyncio
import json
import sys
import time

sys.path.insert(0, ".")  # allow `import app.*`

from app import calle_client, gemini_engine  # noqa: E402


def _mask_phone(phone: str) -> str:
    """Show only the country prefix + last 4 digits (e.g. +91******0746)."""
    if len(phone) >= 7 and phone.startswith("+"):
        return phone[:3] + "******" + phone[-4:]
    return "<masked>"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_plan = "--dry-plan" in sys.argv
    if len(args) < 2:
        print(__doc__)
        return 2
    phone, goal = args[0], " ".join(args[1:])

    print(f"== Planning call to {_mask_phone(phone)}: {goal}")
    plan = calle_client.extract_plan(calle_client.plan_call(phone, goal))
    redacted = dict(plan)
    if redacted.get("confirm_token"):
        redacted["confirm_token"] = "********"  # never print the run token
    print(json.dumps(redacted, indent=2))

    if dry_plan or not plan["ready_to_run"]:
        print("(dry-plan or plan needs clarification — not dialing)")
        return 0

    print("== Running call (dialing — have the phone ready)...")
    run = calle_client.extract_run(calle_client.run_call(plan["plan_id"], plan["confirm_token"]))
    run_id = run["run_id"]
    print(f"run_id: {run_id}, status: {run['status']}")
    print("== run_call returns immediately; polling get_call_status every 5s...")

    TERMINAL = ("complete", "fail", "error", "done", "ended", "no_answer", "voicemail")

    def is_terminal(status):
        return bool(status) and any(t in str(status).lower() for t in TERMINAL)

    last = run
    for i in range(96):  # ~8 minutes max
        if is_terminal(last["status"]):
            break
        time.sleep(5)
        try:
            last = calle_client.extract_run(calle_client.get_call_status(run_id))
        except calle_client.CalleError as exc:
            print(f"  (poll {i}: {str(exc)[:120]})")  # transient — keep polling
            continue
        if i % 3 == 0:
            print(f"  poll {i}: status={last['status']!r}")

    print("== Final status:")
    print(json.dumps(last, indent=2, default=str))

    # Feed the whole conversation into Gemini -> structured ticket.
    result = gemini_engine.analyze_call(
        (last.get("transcript") or "") + "\n" + (last.get("summary") or "")
    )
    print("== Gemini analysis:")
    print(f"actions: {result['actions']}")
    print(f"notes: {result['notes']}")
    if result["ticket"] is not None:
        t = result["ticket"]
        print(f"TICKET CREATED: {t.ticket_number} | {t.device_type} | {t.priority} | {t.issue_description}")
    else:
        print("(no ticket — the conversation may not have described a repair issue)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
