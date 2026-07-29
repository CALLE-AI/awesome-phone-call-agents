#!/usr/bin/env python3
"""Poll a CALL-E call to its terminal state and save the full payload locally."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time


def write_payload(call: dict, path: str) -> None:
    """Write the terminal payload owner-readable only.

    This file is the most sensitive artifact the skill produces: it holds the
    recipient's phone number in the clear and a verbatim transcript of a real
    person who did not choose to be recorded by us. The default 0644 made it
    world-readable on any shared or multi-user machine, which is a poor default
    for a file created by a tool that dials strangers.

    The mode is applied twice on purpose. O_CREAT only honours the mode when it
    actually creates the file, so re-running against a path that already exists
    at 0644 would silently keep the loose permissions; the explicit chmod closes
    that. umask can only make the O_CREAT mode stricter, never looser, so the
    chmod is also what guarantees 0600 rather than merely "no worse than 0600".
    """
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(call, handle, indent=2)
    os.chmod(path, 0o600)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--call-id", required=True)
    parser.add_argument("--out", default="result.json")
    parser.add_argument("--interval-seconds", type=float, default=5.0)
    parser.add_argument("--timeout-seconds", type=float, default=600.0)
    args = parser.parse_args()

    api_key = os.environ.get("CALLE_API_KEY", "")
    if not api_key:
        sys.exit("ERROR: set CALLE_API_KEY.")
    try:
        from calle import CalleClient
    except ImportError:
        sys.exit("ERROR: pip install calle-ai (the package installs as module 'calle').")

    deadline = time.monotonic() + args.timeout_seconds
    with CalleClient(api_key=api_key) as client:
        call = client.calls.get(args.call_id)
        while call.get("status") not in {"completed", "failed", "canceled"}:
            if time.monotonic() > deadline:
                sys.exit(f"ERROR: timed out; last status {call.get('status')}")
            print(f"status: {call.get('status')}")
            time.sleep(args.interval_seconds)
            call = client.calls.get(args.call_id)

    write_payload(call, args.out)
    print(f"terminal status: {call.get('status')}; payload saved to {args.out} (mode 0600)")
    print(
        "this file contains the recipient's phone number and the verbatim "
        "transcript of a real person; delete it when the verification is recorded"
    )
    print("next: python3 scripts/extract_answer.py --payload", args.out)


if __name__ == "__main__":
    main()
