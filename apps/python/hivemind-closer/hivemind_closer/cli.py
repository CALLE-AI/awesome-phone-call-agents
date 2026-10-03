"""Operator CLI. `preview` is always safe; `--live` is M3-gated."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from hivemind_closer.matrix import LeadState, Matrix, apply_result, seed_matrix

CANNED_MOCK_RESULT: dict[str, Any] = {
    "call_id": 0,
    "interested": "unknown",
    "callback_window": "unscheduled",
    "opt_out": "no",
    "transcript": "reached voicemail; left neutral 20-second message",
}


def row_view(call_id: int, state: LeadState, aggression: int, offer: float) -> str:
    """One fixed-width matrix row for terminal display."""
    return f"  [{call_id:>3}] state={state.value:<13} aggression={aggression} offer={offer:.2f}"


def preview_report() -> dict[str, Any]:
    """Dry-run the full loop against the canned mock result. Pure."""
    before: Matrix = seed_matrix()
    after = apply_result(
        before,
        int(CANNED_MOCK_RESULT["call_id"]),
        interested=str(CANNED_MOCK_RESULT["interested"]),
        opt_out=str(CANNED_MOCK_RESULT["opt_out"]),
        transcript=str(CANNED_MOCK_RESULT["transcript"]),
    )
    return {
        "mode": "dry-run",
        "spend_calls": 0,
        "matrix": [
            {
                "call_id": row.call_id,
                "state": row.state.value,
                "aggression": row.aggression,
                "offer": row.current_offer,
            }
            for row in after.rows
        ],
        "result": dict(CANNED_MOCK_RESULT),
    }


def cmd_preview() -> int:
    """Print the dry-run matrix view. Never touches the network."""
    report = preview_report()
    print("hivemind-closer dry-run (spend: 0 calls)")
    matrix_rows = report["matrix"]
    if not isinstance(matrix_rows, list):
        raise TypeError(
            f"preview matrix must be a list, got {type(matrix_rows).__name__}"
        )
    for entry in matrix_rows:
        if not isinstance(entry, dict):
            raise TypeError(f"preview row must be a dict, got {type(entry).__name__}")
        print(
            row_view(
                int(entry["call_id"]),
                LeadState(str(entry["state"])),
                int(entry["aggression"]),
                float(entry["offer"]),
            )
        )
    print(json.dumps(report["result"], indent=2))
    return 0


def cmd_live() -> int:
    """Live dial placeholder: refuses without M3 human gating."""
    print(
        "live dial is gated: requires human approval, typed number "
        "confirmation, and remaining budget (M3). Nothing was dialed.",
        file=sys.stderr,
    )
    return 2


def build_parser() -> argparse.ArgumentParser:
    """CLI argument parser (kept separate for testability)."""
    parser = argparse.ArgumentParser(prog="hivemind-closer")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("preview", help="dry-run matrix view, zero spend")
    sub.add_parser("live", help="gated live call (M3, human approval required)")
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint; returns process exit code."""
    args = build_parser().parse_args(argv)
    if args.command == "preview":
        return cmd_preview()
    return cmd_live()


if __name__ == "__main__":
    raise SystemExit(main())
