from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .api import CalleApiClient, CalleApiError, wait_for_terminal
from .mcp_result import normalize_mcp_result
from .core import (
    RequestValidationError,
    approval_token,
    build_call_payload,
    idempotency_key,
    normalize_call_result,
    preview_plan,
    validate_request,
)


def _load(path: str) -> Any:
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _emit(value: Any, output: str | None) -> None:
    rendered = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if output:
        Path(output).write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)


def _parse_allowlist(value: str | None) -> set[str]:
    if not value:
        return set()
    return {item.strip() for item in value.split(",") if item.strip()}


def _assert_live_gate(
    request: dict[str, Any], supplied_token: str | None, now: datetime, allowed_phones: set[str]
) -> None:
    if request["live_authorized"] is not True or request["call_window"] is None:
        raise RequestValidationError("request is not explicitly authorized for live calling")
    if supplied_token != approval_token(request):
        raise RequestValidationError("--confirm must exactly match the current preview approval token")
    starts = datetime.fromisoformat(request["call_window"]["starts_at"].replace("Z", "+00:00"))
    ends = datetime.fromisoformat(request["call_window"]["ends_at"].replace("Z", "+00:00"))
    current = now.astimezone(timezone.utc)
    if not starts.astimezone(timezone.utc) <= current <= ends.astimezone(timezone.utc):
        raise RequestValidationError("current time is outside the authorized call window")
    missing = [vendor["phone"] for vendor in request["vendors"] if vendor["phone"] not in allowed_phones]
    if missing:
        raise RequestValidationError("every recipient must appear in the server-controlled ROLLOFFSCOPE_ALLOWED_PHONES allowlist")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rolloffscope",
        description="Preview a CALL-E roll-off-dumpster quote task or normalize a completed result. Preview is the default.",
    )
    parser.add_argument("request", help="Path to the service quote request JSON")
    parser.add_argument("--result", help="Normalize an existing CALL-E result JSON; never places a call")
    parser.add_argument("--mcp-result", help="Import saved official CLI get_call_run JSON; never places or polls a call")
    parser.add_argument("--expected-run-id", help="Exact existing MCP run id to bind a saved result import")
    parser.add_argument("--output", help="Write JSON output to this path")
    parser.add_argument("--live", action="store_true", help="Opt into the live adapter; also requires --confirm")
    parser.add_argument("--confirm", help="Exact approval token printed by preview")
    parser.add_argument("--poll-interval-seconds", type=float, default=10)
    parser.add_argument("--poll-timeout-seconds", type=float, default=900)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = make_parser().parse_args(argv)
    try:
        request = validate_request(_load(args.request))
        if sum(bool(mode) for mode in (args.result, args.mcp_result, args.live)) > 1:
            raise RequestValidationError("--result, --mcp-result and --live cannot be combined")
        if args.expected_run_id and not args.mcp_result:
            raise RequestValidationError("--expected-run-id requires --mcp-result")
        if args.mcp_result:
            if not args.expected_run_id:
                raise RequestValidationError("--mcp-result requires --expected-run-id")
            _emit(normalize_mcp_result(request, _load(args.mcp_result), args.expected_run_id), args.output)
            return 0
        if args.result:
            _emit(normalize_call_result(request, _load(args.result)), args.output)
            return 0
        if not args.live:
            _emit(preview_plan(request), args.output)
            return 0
        allowlist = _parse_allowlist(os.environ.get("ROLLOFFSCOPE_ALLOWED_PHONES"))
        _assert_live_gate(request, args.confirm, datetime.now(timezone.utc), allowlist)
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise RequestValidationError("CALLE_API_KEY is required for a live call and is never stored by this app")

        client = CalleApiClient(api_key)
        created = client.create_call(build_call_payload(request), idempotency_key(request))
        call_id = created.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise CalleApiError(
                "CALL-E accepted an indeterminate create response without a call id; do not create another request"
            )
        completed = wait_for_terminal(
            client,
            call_id,
            poll_interval_seconds=args.poll_interval_seconds,
            timeout_seconds=args.poll_timeout_seconds,
        )
        _emit(normalize_call_result(request, completed), args.output)
        return 0
    except (OSError, json.JSONDecodeError, RequestValidationError, ValueError, CalleApiError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
