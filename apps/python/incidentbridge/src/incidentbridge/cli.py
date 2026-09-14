"""Preview, simulate, or execute one controlled CALL-E incident-support call."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from incidentbridge.ledger import ReservationLedger
from incidentbridge.models import IncidentRequest, parse_request
from incidentbridge.policy import idempotency_key, preview, simulated_result
from incidentbridge.runtime import DEFAULT_BASE_URL, execute, validate_base_url


def load_request(path: Path) -> IncidentRequest:
    with path.open(encoding="utf-8") as handle:
        return parse_request(json.load(handle))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--simulate", choices=("acknowledged", "wrong-desk", "eta-unknown")
    )
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized-recipient", action="store_true")
    parser.add_argument("--allow", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument(
        "--base-url", default=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(os.environ.get("INCIDENTBRIDGE_DB_PATH", "data/incidentbridge.sqlite3")),
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args(argv)


def execute_once(request: IncidentRequest, args: argparse.Namespace) -> dict[str, Any]:
    if not args.confirm_authorized_recipient:
        raise ValueError("--execute requires --confirm-authorized-recipient")
    if request.support_phone not in set(args.allow):
        raise ValueError("--execute requires the exact support phone in --allow")
    if os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").lower() != "true":
        raise ValueError("--execute requires CALLE_LIVE_CALLS_ENABLED=true")
    if args.timeout_seconds <= 0:
        raise ValueError("--timeout-seconds must be positive")
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise ValueError("CALLE_API_KEY is required for --execute")

    from calle import CalleClient

    key = idempotency_key(request)
    ledger = ReservationLedger(args.database)
    if not ledger.claim(key):
        state = ledger.get(key)
        current = state[0] if state else "unknown"
        raise RuntimeError(
            f"call already reserved; reconcile ledger state {current}"
        )

    accepted_call_id: str | None = None

    def on_created(call_id: str) -> None:
        nonlocal accepted_call_id
        accepted_call_id = call_id
        ledger.mark_accepted(key, call_id)

    try:
        with CalleClient(
            api_key=api_key, base_url=validate_base_url(args.base_url)
        ) as client:
            result = execute(request, client.calls, args.timeout_seconds, on_created)
    except Exception as exc:
        ledger.mark_unknown(key, accepted_call_id, type(exc).__name__)
        raise RuntimeError(
            "CALL-E outcome is unknown; inspect the reservation ledger before any retry"
        ) from exc
    ledger.mark_completed(key, result["call_id"])
    return result


def write_output(path: Path | None, payload: dict[str, Any]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path is None:
        sys.stdout.write(rendered)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        handle.write(rendered)
    sys.stdout.write(f"Wrote {path}\n")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        request = load_request(args.request)
        if args.simulate:
            payload = simulated_result(request, args.simulate)
        elif args.execute:
            payload = execute_once(request, args)
        else:
            payload = preview(request)
        write_output(args.output, payload)
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
