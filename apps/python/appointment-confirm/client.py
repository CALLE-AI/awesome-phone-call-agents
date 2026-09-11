#!/usr/bin/env python3
"""Appointment confirmation CLI.

Default is a no-call preview. --mock runs a fixture conversation locally.
--execute --confirm-consent places exactly one real CALL-E call.

Examples:
  python3 client.py --request fixtures/sample_appointment.json
  python3 client.py --request fixtures/sample_appointment.json --mock
  CALLE_API_KEY=... python3 client.py --request fixtures/sample_appointment.json \
      --execute --confirm-consent
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from appointment_confirm import TRUSTED_BASE_URL
from appointment_confirm.engine import execute_mock, execute_with_client, preview
from appointment_confirm.live_client import LiveCalleClient, validate_trusted_base_url
from appointment_confirm.schema import load_intake


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview, mock, or place one appointment-confirmation phone call via CALL-E."
    )
    parser.add_argument("--request", required=True, type=Path, help="Appointment intake JSON.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Write JSON here. Existing files are never overwritten (mode 0600).",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preview", action="store_true", help="No-call plan (default).")
    mode.add_argument(
        "--mock",
        action="store_true",
        help="Run a local conversation fixture. Places no phone call. Needs no API key.",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Place exactly one real CALL-E call. Requires CALLE_API_KEY and --confirm-consent.",
    )
    parser.add_argument(
        "--fixture",
        type=Path,
        help="Conversation fixture for --mock. Defaults to fixtures/conversation_confirm_yes.json.",
    )
    parser.add_argument(
        "--confirm-consent",
        action="store_true",
        help="Required with --execute. Confirms the recipient consented to this call.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("CALLE_BASE_URL", TRUSTED_BASE_URL),
        help=f"Must be {TRUSTED_BASE_URL}.",
    )
    return parser.parse_args(argv)


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


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        intake = load_intake(args.request)
        if args.execute:
            if not args.confirm_consent:
                raise ValueError("--execute requires --confirm-consent")
            validate_trusted_base_url(args.base_url)
            api_key = os.environ.get("CALLE_API_KEY", "").strip()
            if not api_key:
                raise ValueError(
                    "CALLE_API_KEY is missing. For a real call, create a CALL-E account "
                    "(20 free calls) at https://www.heycall-e.com/ then copy a key from "
                    "https://dashboard.heycall-e.com/account/api-keys . "
                    "Until then, run --mock (no key, no dial)."
                )
            client = LiveCalleClient(api_key=api_key, base_url=args.base_url)
            ticket = execute_with_client(intake, client, mode="live")
            write_output(args.output, ticket)
            return 0
        if args.mock:
            ticket = execute_mock(intake, args.fixture)
            write_output(args.output, ticket)
            return 0
        write_output(args.output, preview(intake))
        return 0
    except (FileExistsError, OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
