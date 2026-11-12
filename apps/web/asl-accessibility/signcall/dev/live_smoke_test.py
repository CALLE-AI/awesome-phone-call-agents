"""
Standalone diagnostic: place exactly one real call and print CALL-E's raw
response next to the mapped CallResult, to check that calle/run.py's field
mapping still matches the live API. It is not part of the workflow.

It bypasses call_and_wait(), so it enforces the same routing rule itself: the
number must be one of SIGNCALL_TEST_LINES, so this script can't be a way to
dial a number nobody vetted. The raw JSON is printed before mapping so a
mapping bug still leaves you the data you came for. Everything it prints has
phone numbers masked to the last four digits (api/masking.py), so its output
is safe to paste into an issue or a log.

    cd apps/web/asl-accessibility
    CALLE_MOCK_MODE=0 python3 -m signcall.dev.live_smoke_test +15555550123   # new call
    CALLE_MOCK_MODE=0 python3 -m signcall.dev.live_smoke_test call_XXXXXXXX  # re-inspect an
                                                                           # existing call, no
                                                                           # new call is placed
"""

import json
import sys

from ..api.masking import mask_text
from ..calle.run import TEST_LINES_ENV, _get_client, _map_result, _poll_until_terminal, test_lines


def say(text: str = "") -> None:
    """print(), with phone numbers masked."""
    print(mask_text(str(text)))


def _looks_like_call_id(arg: str) -> bool:
    return arg.startswith("call_")


TASK = (
    "Call this number, say this is a short test call from an accessibility "
    "project, ask if they can hear clearly, ask them to say one word back, "
    "thank them, and end the call."
)

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "heard_clearly": {"type": "boolean"},
        "note": {"type": "string"},
    },
}


def main() -> None:
    lines = test_lines()
    if len(sys.argv) != 2:
        say(f"Usage: python3 -m signcall.dev.live_smoke_test <one of {TEST_LINES_ENV}: {', '.join(lines) or '(not set)'}>")
        say("   or: python3 -m signcall.dev.live_smoke_test call_XXXXXXXX  (re-inspect, no new call)")
        sys.exit(1)
    arg = sys.argv[1]
    if not _looks_like_call_id(arg) and arg not in lines:
        say(
            f"Refusing to dial {arg!r}: calls are only placed to numbers listed in "
            f"{TEST_LINES_ENV} ({', '.join(lines) or 'not set'}). Pass one of those, or "
            f"an existing call_... id to re-inspect a completed call."
        )
        sys.exit(1)
    client = _get_client()

    if _looks_like_call_id(arg):
        call_id = arg
        say(f"Re-inspecting existing call {call_id}; no new call placed.")
        raw = client.calls.get(call_id)
    else:
        phone = arg
        say(f"Placing one real call to {phone}. This will actually ring.")
        created = client.calls.create(task=TASK, recipient={"phone": phone}, result_schema=RESULT_SCHEMA)
        call_id = str(created["id"])
        say(f"Call created, id={call_id}. Polling until terminal status...")
        raw = _poll_until_terminal(client, call_id)

    say("\n=== RAW response from client.calls.get() (phone numbers masked) ===")
    say(json.dumps(raw, indent=2, default=str))

    try:
        mapped = _map_result(raw)
    except Exception as exc:
        say(f"\n=== _map_result() CRASHED: {exc!r} ===")
        say("The raw JSON above is still valid; fix calle/run.py::_map_result() against it.")
        sys.exit(1)

    say("\n=== MAPPED CallResult ===")
    say(mapped)

    say("\n=== Check ===")
    missing = []
    if not mapped.status:
        missing.append("status")
    if not mapped.structured_result and raw.get("structured_result"):
        missing.append("structured_result (raw has it, mapped came back empty)")
    if not mapped.transcript_turns and _anywhere_nonempty(raw, "transcript_turns"):
        missing.append("transcript_turns (raw has turns somewhere nested, mapped came back empty)")
    if missing:
        say(
            f"MISMATCH: {', '.join(missing)} didn't map correctly. Compare the raw "
            f"key names above against calle/run.py::_map_result()."
        )
    else:
        say("Mapping looks consistent: status, structured_result and transcript_turns all came through.")


def _anywhere_nonempty(obj, key: str) -> bool:
    """True if a non-empty list exists under `key` at any nesting depth, so the
    check keeps working if the API's nesting changes."""
    if isinstance(obj, dict):
        if isinstance(obj.get(key), list) and obj[key]:
            return True
        return any(_anywhere_nonempty(v, key) for v in obj.values())
    if isinstance(obj, list):
        return any(_anywhere_nonempty(item, key) for item in obj)
    return False


if __name__ == "__main__":
    main()
