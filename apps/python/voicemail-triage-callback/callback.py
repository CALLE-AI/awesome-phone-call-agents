"""Places a real outbound call via the CALL-E platform once an upstream
triage step has already decided a callback is warranted and safe.

This app does not do the triage itself -- it is the reusable "place the
call" primitive meant to sit downstream of any classifier (an LLM agent, a
rules engine, a human reviewer) that has already decided:

1. this caller/request is not a scam or spam number, and
2. the task is simple and well-defined enough to complete without a human
   deciding anything mid-call (confirming an appointment, acknowledging a
   delivery, collecting a new lead's basic contact info).

Full reference implementation of the upstream triage step -- voicemail
transcription via AssemblyAI, classification via the Strands Agents SDK on
Amazon Bedrock, then this same callback primitive -- lives at
https://github.com/axxess-triaxis/callismatic.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from typing import Any

JsonObject = dict[str, Any]

DEMO_TASKS: dict[str, JsonObject] = {
    "delivery": {
        "task": "Call back to confirm whether it's okay to leave the package at the door next "
        "time, or schedule redelivery tomorrow between 9 and noon.",
        "to_phone": "+15550005555",
    },
    "lead": {
        "task": "Call back a new business lead to discuss a kitchen remodel and offer to "
        "schedule a consultation.",
        "to_phone": "+15550002222",
    },
}


def place_callback(task: str, phone_number: str, *, api_key: str | None = None) -> JsonObject:
    """Places a real CALL-E call and waits for it to finish, returning CALL-E's own result
    object (status, per-recipient outcome, transcript_turns, any structured_result).

    Raises RuntimeError if no API key is available. Imports the calle-ai SDK lazily so that
    --demo mode above needs no dependency installed at all.
    """
    if not isinstance(phone_number, str) or not re.fullmatch(r"\+[1-9][0-9]{1,14}", phone_number):
        raise ValueError("Destination must be exact ASCII E.164; no number was submitted.")
    api_key = api_key or os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise RuntimeError("CALLE_API_KEY is not set -- see README.md for setup.")

    from calle import CalleClient

    client = CalleClient(api_key=api_key)
    try:
        return client.calls.create_and_wait(task=task, recipient={"phone": phone_number})
    finally:
        client.close()


def _demo_result(task: str, phone_number: str) -> JsonObject:
    return {
        "id": "call_demo_0000000000000000",
        "object": "call_task",
        "status": "completed",
        "task": task,
        "recipients": [{"phones": [phone_number], "status": "completed"}],
        "task_completed": True,
        "note": "DEMO MODE -- no real call was placed. This mirrors CALL-E's real result shape.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--demo",
        choices=sorted(DEMO_TASKS),
        help="Run against a canned example task -- no credentials, no real call placed.",
    )
    parser.add_argument("--task", help="Natural-language task for a real call. Required with --live.")
    parser.add_argument(
        "--to-phone",
        help="E.164 destination number for a real call (e.g. +15551234567). Required with "
        "--live. Never guessed or reformatted by this app.",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Place a real CALL-E call. Requires --confirm and CALLE_API_KEY.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Confirm this call and attest the recipient authorized it. Never implied by --live alone.",
    )
    args = parser.parse_args()

    if args.demo:
        example = DEMO_TASKS[args.demo]
        print(json.dumps(_demo_result(example["task"], example["to_phone"]), indent=2))
        return

    if not args.live:
        parser.error(
            "Pass --demo <key> to try this without credentials, or --live --confirm "
            "--task ... --to-phone ... to place a real call."
        )
    if not args.confirm:
        parser.error("--live requires --confirm as well -- never implied by --live alone.")
    if not args.task or not args.to_phone:
        parser.error("--live requires both --task and --to-phone.")

    try:
        result = place_callback(args.task, args.to_phone)
    except ValueError:
        parser.exit(1, "Destination must be exact ASCII E.164; no number was submitted.\n")
    except Exception:
        parser.exit(1, "Call submission or waiting failed; its outcome may be unknown. Reconcile with the provider before another call.\n")
    # Raw provider objects remain private to the integration, not CLI output.
    status = result.get("status")
    if status not in {"queued", "pending", "in_progress", "completed", "failed", "canceled"}:
        status = "unknown"
    print(json.dumps({"status": status, "destination": "[phone redacted]"}, indent=2))


if __name__ == "__main__":
    main()
