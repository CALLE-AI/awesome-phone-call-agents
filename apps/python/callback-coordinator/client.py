"""Callback Coordinator CLI.

Preview (default) validates an intake and prints a masked no-call plan.
Execute places exactly one CALL-E triage call and returns a fail-closed ticket.

Live execution requires:
  - a request file that records explicit consent for this callback;
  - the --confirm-consent flag (a separate explicit confirmation);
  - a server-side CALLE_API_KEY in the environment.

Example:
  uv run python client.py --request example_request_web_form.json
  CALLE_API_KEY=... uv run python client.py --request example_request_web_form.json \\
      --execute --confirm-consent --output ticket.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from coordinator import (
    execute_with_client,
    load_intake,
    preview,
)

DEFAULT_BASE_URL = "https://api.heycall-e.com"


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview or run one consent-first callback triage call with CALL-E."
    )
    parser.add_argument(
        "--request", required=True, type=Path, help="Path to the callback intake JSON file."
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional new JSON result path; existing files are never overwritten.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--preview",
        action="store_true",
        help="Validate and print a masked no-call plan. This is the default.",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Create exactly one CALL-E triage call and wait for its result.",
    )
    parser.add_argument(
        "--confirm-consent",
        action="store_true",
        help="Required with --execute; confirms the recipient consented to this callback.",
    )
    parser.add_argument(
        "--check-api",
        action="store_true",
        help="Verify the CALL-E API key and connectivity with GET /health. Places no call.",
    )
    parser.add_argument(
        "--now",
        type=str,
        default=None,
        help="ISO-8601 timestamp used for the quiet-hours gate. Defaults to the current time.",
    )
    parser.add_argument(
        "--base-url", default=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument("--timeout-seconds", type=int, default=600)
    return parser.parse_args(argv)


def parse_now(raw: str | None) -> datetime:
    if raw is None:
        return datetime.now(timezone.utc)
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("--now must be an ISO-8601 timestamp like 2026-08-09T22:30:00-04:00") from exc
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


def write_output(path: Path | None, payload: dict) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path is None:
        sys.stdout.write(rendered)
        return
    destination = path.expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as handle:
        handle.write(rendered)
    destination.chmod(0o600)
    sys.stdout.write(f"Wrote {destination}\n")


def check_api(base_url: str) -> dict:
    """Verify the CALL-E API key and connectivity via GET /health. No call placed."""
    import httpx

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise ValueError("CALLE_API_KEY is required for --check-api")
    url = base_url.rstrip("/") + "/health"
    with httpx.Client(timeout=15.0) as http:
        response = http.get(
            url, headers={"Authorization": f"Bearer {api_key}"}
        )
    return {
        "check": "api",
        "creates_phone_call": False,
        "base_url": base_url,
        "status_code": response.status_code,
        "healthy": response.status_code < 400,
    }


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        if args.check_api:
            write_output(args.output, check_api(args.base_url))
            return 0

        intake = load_intake(args.request)
        now = parse_now(args.now)

        if not args.execute:
            write_output(args.output, preview(intake, now))
            return 0

        if not args.confirm_consent:
            raise ValueError("--execute requires --confirm-consent")
        if args.timeout_seconds <= 0:
            raise ValueError("--timeout-seconds must be positive")

        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise ValueError("CALLE_API_KEY is required for --execute")

        from calle import CalleClient

        client = CalleClient(api_key=api_key, base_url=args.base_url)
        ticket = execute_with_client(
            intake, client, now=now, timeout_seconds=args.timeout_seconds
        )
        write_output(args.output, ticket)
        return 0
    except (
        FileExistsError,
        OSError,
        ValueError,
        RuntimeError,
        json.JSONDecodeError,
    ) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
