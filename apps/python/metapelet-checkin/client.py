#!/usr/bin/env python3
"""MetaPelet × CALL-E — one consent-based elder check-in call."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from call_runtime import execute_live, resolve_base_url, write_output
from task_builder import (
    build_task,
    idempotency_key,
    load_result_schema,
    preview_plan,
    validate_request,
)

ENV_PATH = Path(__file__).resolve().parent / ".env"


def _load_dotenv() -> None:
    if not ENV_PATH.is_file():
        return
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def _load_request(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc
    try:
        return validate_request(data)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def _run_live(request: dict, output: Path | None, timeout_seconds: float) -> int:
    try:
        base_url = resolve_base_url()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise SystemExit("Set CALLE_API_KEY in the environment or .env (do not commit).")

    try:
        from calle import CalleClient
    except ImportError as exc:
        raise SystemExit(
            "Install dependencies: pip install -r requirements.txt"
        ) from exc

    os.environ["CALLE_BASE_URL"] = base_url
    client = CalleClient(api_key=api_key, base_url=base_url)
    task = build_task(request)
    schema = load_result_schema()
    idempotency = idempotency_key(request, task, schema)

    print("Placing one CALL-E call (live)...", flush=True)
    payload = execute_live(
        request,
        client,
        task=task,
        schema=schema,
        idempotency_key=idempotency,
        timeout_seconds=timeout_seconds,
    )
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    sys.stdout.buffer.write(rendered.encode("utf-8"))
    if output:
        try:
            write_output(output, payload)
        except FileExistsError:
            raise SystemExit(f"Refusing to overwrite existing output: {output}") from None
        print(f"Wrote {output}", flush=True)
    return 0


def main() -> int:
    _load_dotenv()
    parser = argparse.ArgumentParser(description="MetaPelet elder check-in via CALL-E")
    parser.add_argument(
        "--request",
        type=Path,
        default=Path("example_request.json"),
        help="Request JSON path",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Place a real CALL-E call (consumes credits)",
    )
    parser.add_argument(
        "--confirm-recipient-opt-in",
        action="store_true",
        help="Required with --execute: recipient consented",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=900.0,
        help="Max seconds to wait for terminal call status",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write redacted result JSON here (0600, never overwrites)",
    )
    args = parser.parse_args()

    request = _load_request(args.request)

    if not args.execute:
        plan = preview_plan(request)
        text = json.dumps(plan, ensure_ascii=False, indent=2)
        sys.stdout.buffer.write(text.encode("utf-8"))
        sys.stdout.buffer.write(b"\n\nPreview only - no call placed.\n")
        return 0

    if not args.confirm_recipient_opt_in:
        raise SystemExit("Live calls require --confirm-recipient-opt-in.")
    if args.timeout_seconds <= 0:
        raise SystemExit("--timeout-seconds must be positive.")

    return _run_live(request, args.output, args.timeout_seconds)


if __name__ == "__main__":
    sys.exit(main())
