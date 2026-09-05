#!/usr/bin/env python3
"""Thin runner for the capacity-backfill-cascade skill.

Delegates to the table-rescue reference app and stays dry-run unless --live is passed.
"""
import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--state-dir", default="state")
    parser.add_argument("--run-id", default=None)
    parser.add_argument(
        "--live", action="store_true", help="Place real calls through CALL-E MCP"
    )
    args, extra = parser.parse_known_args()
    try:
        from table_rescue.cli import main as app_main
    except ImportError:
        print(
            "table_rescue is not installed. Install the reference app first:\n"
            "  cd apps/python/table-rescue && pip install -e .",
            file=sys.stderr,
        )
        return 1
    forwarded = [
        "run",
        "--data-dir", args.data_dir,
        "--state-dir", args.state_dir,
    ]
    if args.run_id:
        forwarded.extend(["--run-id", args.run_id])
    if args.live:
        forwarded.append("--live")
    forwarded.extend(extra)
    return app_main(forwarded)


if __name__ == "__main__":
    sys.exit(main())
