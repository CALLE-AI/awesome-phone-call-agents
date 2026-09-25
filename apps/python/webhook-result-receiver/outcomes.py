"""Read a synthetic webhook fixture and print a suggested application action."""

import argparse
import json
from pathlib import Path

from receiver import (
    MAX_BODY_BYTES,
    TERMINAL_STATUSES,
    strict_json_loads,
    validate_event,
)

ACTIONS = {
    "booked": "Record the reported booking; verify its details before acting.",
    "declined": "Record the decline; do not automatically call again.",
    "callback": "Queue for human follow-up; do not place a call automatically.",
    "unanswered": "Leave unresolved; review contact policy before any new attempt.",
    "unknown": "Review the evidence; do not record a booking or a decline.",
}


def application_outcome(call: dict) -> str:
    """Interpret this demo's result schema after API verification in live use."""
    result = call.get("structured_result")
    if call.get("status") != "completed" or not isinstance(result, dict):
        return "unknown"
    if set(result) != {"outcome", "outcome_evidence"}:
        return "unknown"
    outcome = result["outcome"]
    evidence = result["outcome_evidence"]
    if (
        not isinstance(outcome, str)
        or outcome not in ACTIONS
        or not isinstance(evidence, str)
        or not evidence.strip()
    ):
        return "unknown"
    return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    args = parser.parse_args(argv)
    try:
        with args.fixture.open("rb") as source:
            raw = source.read(MAX_BODY_BYTES + 1)
        if len(raw) > MAX_BODY_BYTES:
            raise ValueError("fixture is too large")
        event = strict_json_loads(raw.decode("utf-8"))
        header = event.get("id") if isinstance(event, dict) else None
        event = validate_event(event, header)
        if event["data"].get("status") not in TERMINAL_STATUSES[event["type"]]:
            raise ValueError("event and status disagree")
        outcome = application_outcome(event["data"])
    except (OSError, ValueError, TypeError, RecursionError):
        print(json.dumps({"error": "invalid_fixture"}))
        return 1
    print(json.dumps({"outcome": outcome, "next_action": ACTIONS[outcome]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
