"""Print the full CALL-E record for a call this ledger already placed.

Read-only. It dials nobody and spends no call credit. Written to read back what
was actually said on a live call, because a transcript is the only place some
defects are visible — a mangled invoice reference or a fabricated read-back
looks like a clean structured result from the outside.

    python tools/inspect_call.py demo/live
    python tools/inspect_call.py demo/live --call-id <call-id-from-the-ledger>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from calle import CalleClient

from kept.config import load_credentials
from kept.ledger import Ledger
from kept.models import redact_phone_like
from kept.store import EVENT_CALL_DISPATCHED, EVENT_CALL_FAILED, EVENT_CALL_PLACED

_CALL_FIELDS = (
    "id",
    "status",
    "task_completed",
    "completion_confidence",
    "evidence",
    "summary",
    "failure_code",
    "failure_message",
    "created_at",
    "completed_at",
)


def latest_call_id(ledger: Ledger) -> str | None:
    dialled = [
        payload["call_id"]
        for event in (EVENT_CALL_DISPATCHED, EVENT_CALL_PLACED)
        for payload in ledger.of_type(event)
        if payload.get("call_id")
    ]
    return dialled[-1] if dialled else None


def print_failures(ledger: Ledger) -> None:
    for failure in ledger.of_type(EVENT_CALL_FAILED):
        print(f"failed: {failure['code']} - {_masked(failure['message'])}")


def print_call(call: dict[str, Any]) -> None:
    """Render the provider's own words, with anything dialable masked first."""
    for field in _CALL_FIELDS:
        print(f"{field:22}: {_masked(call.get(field))}")
    print("structured_result     :", _masked(json.dumps(call.get("structured_result"), indent=2)))


def _masked(value: Any) -> str:
    return redact_phone_like(str(value))


def print_transcript(call: dict[str, Any]) -> None:
    for recipient in call.get("recipients") or []:
        print(f"\nrecipient {recipient.get('id')} status={recipient.get('status')}")
        print("  summary:", _masked(recipient.get("summary")))
        for attempt in recipient.get("attempts") or []:
            print(
                f"  attempt {attempt.get('id')} status={attempt.get('status')} "
                f"failure={attempt.get('failure_code')} {_masked(attempt.get('failure_message'))}"
            )
            for turn in attempt.get("transcript_turns") or []:
                print(
                    f"    [{turn.get('offset_seconds')}s] "
                    f"{turn.get('speaker')}: {_masked(turn.get('text'))}"
                )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path, help="Data directory holding ledger.jsonl.")
    parser.add_argument("--call-id", help="Defaults to the last call this ledger dialled.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ledger = Ledger(args.data / "ledger.jsonl")
    print_failures(ledger)

    call_id = args.call_id or latest_call_id(ledger)
    if call_id is None:
        print(f"no call was ever dialled from {args.data}", file=sys.stderr)
        return 1

    client = CalleClient(api_key=load_credentials().api_key)
    try:
        call = client.calls.get(call_id)
    finally:
        client.close()

    print_call(call)
    print_transcript(call)
    return 0


if __name__ == "__main__":
    sys.exit(main())
