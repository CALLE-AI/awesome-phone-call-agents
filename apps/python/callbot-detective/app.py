"""Minimal CALL-E workflow for CallBot Detective.

Preview a mission with --dry-run, or place a real call with --execute.
"""

import argparse
import json
import os
import sys

from calle import CalleClient


def build_task(phone: str, mission: str) -> str:
    return (
        f"Call {phone}. Identify clearly as CallBot, an AI assistant calling on behalf "
        f"of a customer. Mission: {mission}"
    )


def build_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "answer": {
                "type": "string",
                "description": "The best-supported answer from the phone conversation. "
                "Use 'unverified' when the answer cannot be established."
            }
        },
        "required": ["answer"],
        "additionalProperties": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="CallBot Detective CALL-E workflow")
    parser.add_argument("--phone", required=True, help="Authorized recipient phone number")
    parser.add_argument("--mission", required=True, help="Natural-language investigation mission")
    parser.add_argument("--dry-run", action="store_true", help="Preview without placing a call")
    parser.add_argument("--execute", action="store_true", help="Place a real CALL-E call")
    args = parser.parse_args()

    if args.dry_run == args.execute:
        parser.error("choose exactly one of --dry-run or --execute")

    task = build_task(args.phone, args.mission)
    payload = {"task": task, "result_schema": build_schema()}

    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return 0

    api_key = os.getenv("CALLE_API_KEY")
    if not api_key:
        print("CALLE_API_KEY is required for --execute", file=sys.stderr)
        return 2

    client = CalleClient(api_key=api_key)
    call = client.calls.create(**payload)
    print(json.dumps({"call_id": call.id}, indent=2))
    print("Retrieve the call later with the CALL-E Calls API using the returned call_id.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
