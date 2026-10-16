#!/usr/bin/env python3
"""Poll a Calls V2 result until ready and save the full payload locally."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time


def write_payload(call: dict, path: str) -> None:
    """Replace private state atomically, keeping the original if writing fails."""
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=os.path.dirname(os.path.abspath(path)), delete=False
    ) as handle:
        try:
            json.dump(call, handle, indent=2)
            handle.close()
            os.replace(handle.name, path)
        finally:
            if os.path.exists(handle.name):
                os.unlink(handle.name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--call-id", required=True)
    parser.add_argument("--out", default="result.json")
    parser.add_argument("--interval-seconds", type=float, default=5.0)
    parser.add_argument("--timeout-seconds", type=float, default=600.0)
    args = parser.parse_args()
    if any(not math.isfinite(value) or value <= 0 for value in (
        args.interval_seconds, args.timeout_seconds
    )):
        parser.error("--interval-seconds and --timeout-seconds must be finite and positive")

    api_key = os.environ.get("CALLE_API_KEY", "")
    if not api_key:
        sys.exit("ERROR: set CALLE_API_KEY.")
    try:
        from calle import CalleClient
    except ImportError:
        sys.exit("ERROR: pip install calle-ai==1.0.1 (the package installs as module 'calle').")

    deadline = time.monotonic() + args.timeout_seconds
    try:
        with CalleClient(api_key=api_key) as client:
            call = client.calls.get(args.call_id)
            while call["result_status"] == "pending":
                if time.monotonic() > deadline:
                    sys.exit(
                        f"ERROR: timed out; Call ID {args.call_id}; result_status={call['result_status']}. "
                        "Resume polling this Call ID; do not create another call."
                    )
                print(f"status: {call.get('status')}; result_status: {call['result_status']}")
                time.sleep(args.interval_seconds)
                call = client.calls.get(args.call_id)
    except Exception as exc:
        sys.exit(
            f"ERROR: poll failed for Call ID {args.call_id}: {exc}\n"
            "Resume polling this Call ID; do not create another call."
        )

    write_payload(call, args.out)
    print(
        f"status: {call.get('status')}; call_outcome: {call.get('call_outcome')}; "
        f"result_status: {call['result_status']}; payload saved to {args.out} (mode 0600)"
    )
    print(
        "this file contains the recipient's phone number and the verbatim "
        "transcript of a real person; delete it when the verification is recorded"
    )
    print(
        f"next: python3 scripts/extract_answer.py --payload {args.out} "
        f"--qhat <from calibrate.py> --org '<organization exactly as listed>'"
    )


if __name__ == "__main__":
    main()
