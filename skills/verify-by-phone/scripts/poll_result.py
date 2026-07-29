#!/usr/bin/env python3
"""Poll a CALL-E call to its terminal state and save the full payload locally."""

import argparse
import json
import os
import sys
import time


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

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(call, handle, indent=2)
    print(f"terminal status: {call.get('status')}; payload saved to {args.out}")
    print("next: python3 scripts/extract_answer.py --payload", args.out)


if __name__ == "__main__":
    main()
