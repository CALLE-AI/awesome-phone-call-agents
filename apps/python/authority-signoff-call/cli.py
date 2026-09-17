#!/usr/bin/env python3
"""CLI for authority-signoff-call.

    # No call, no credentials. Always do this first.
    python cli.py preview --authority "Chief Financial Officer" \\
        --context "Q3 vendor payment batch" \\
        --decision "Auto-release $42,000 vendor payment run" \\
        --tier "Finance auto-release policy v2 (under $50k)" \\
        --amount "$42,000"

    # One real call. Needs CALLE_API_KEY, CALLE_SIGNOFF_PHONE,
    # CALLE_SIGNOFF_ENABLED=true in the environment.
    python cli.py request --authority "Chief Financial Officer" \\
        --context "Q3 vendor payment batch" \\
        --decision "Auto-release $42,000 vendor payment run" \\
        --tier "Finance auto-release policy v2 (under $50k)" \\
        --amount "$42,000" \\
        --idempotency-key "vendor-batch-q3-2026-001"

Exit codes: 0 = confirm, 10 = override (rejected), 20 = unclear (no
answer / call failed / not configured — see stderr for which).
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from signoff_call import build_task, request_signoff_call


def main() -> int:
    # A call script built from real-world input (currency symbols, non-English
    # names) can contain non-ASCII text; don't let the platform's default
    # console codepage (e.g. Windows cp1252) crash a plain preview.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=["preview", "request"])
    parser.add_argument("--authority", required=True, help="Name of the accountable person being called")
    parser.add_argument("--context", required=True, help="One line of context for the call")
    parser.add_argument("--decision", required=True, help="The decision/action that was auto-authorized")
    parser.add_argument("--tier", required=True, help="The real authority tier it was authorized under")
    parser.add_argument("--amount", default=None, help="Optional amount/value involved")
    parser.add_argument("--idempotency-key", default=None, help="Required for --mode request")
    args = parser.parse_args()

    if args.mode == "preview":
        task = build_task(
            authority_name=args.authority,
            context=args.context,
            decision_summary=args.decision,
            authorizing_tier=args.tier,
            amount=args.amount,
        )
        print("Would call:", args.authority)
        print("Call script:")
        print(task)
        print("\nNo call placed. Nothing here required credentials.")
        return 0

    if not args.idempotency_key:
        print("error: --idempotency-key is required for --mode request", file=sys.stderr)
        return 30

    try:
        result = asyncio.run(
            request_signoff_call(
                authority_name=args.authority,
                context=args.context,
                decision_summary=args.decision,
                authorizing_tier=args.tier,
                amount=args.amount,
                idempotency_key=args.idempotency_key,
            )
        )
    except ValueError as exc:
        # validate_e164() raises here for a malformed CALLE_SIGNOFF_PHONE —
        # str(exc) already masks the number, never print the raw env var.
        print(f"error: {exc}", file=sys.stderr)
        return 30

    if result["dry_run"]:
        print(f"[DRY RUN — {result['dry_run_reason']}] No call placed. Would have said:", file=sys.stderr)
        print(result["task"], file=sys.stderr)
        return 20

    decision = result["decision"]
    print(f"decision: {decision}")
    if decision == "confirm":
        return 0
    if decision == "override":
        return 10
    if result.get("error"):
        print("call failed — see logs", file=sys.stderr)
    return 20


if __name__ == "__main__":
    raise SystemExit(main())
