#!/usr/bin/env python3
"""MetaPelet × CALL-E — one consent-based elder check-in call."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from task_builder import build_recipients, build_task, load_result_schema, preview_plan

DEFAULT_BASE_URL = "https://api.heycall-e.com"
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
    data = json.loads(path.read_text(encoding="utf-8"))
    required = ["workflow_id", "phone", "recipient_consented", "user_name", "language"]
    missing = [k for k in required if k not in data]
    if missing:
        raise SystemExit(f"Missing required fields: {', '.join(missing)}")
    if data.get("recipient_consented") is not True:
        raise SystemExit("recipient_consented must be true for any run.")
    return data


def _run_live(request: dict, output: Path | None) -> int:
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise SystemExit("Set CALLE_API_KEY in the environment or .env (do not commit).")

    try:
        from calle import CalleClient
    except ImportError as exc:
        raise SystemExit(
            "Install dependencies: pip install -r requirements.txt"
        ) from exc

    os.environ.setdefault("CALLE_BASE_URL", DEFAULT_BASE_URL)
    client = CalleClient(api_key=api_key)
    task = build_task(request)
    schema = load_result_schema()
    idempotency = f"metapelet-{request['workflow_id']}"

    print("Placing one CALL-E call (live)...", flush=True)
    call = client.calls.create_and_wait(
        task=task,
        recipients=build_recipients(request),
        result_schema=schema,
        idempotency_key=idempotency,
        timeout_seconds=900.0,
    )

    redacted = {
        "workflow_id": request["workflow_id"],
        "status": call.get("status") if isinstance(call, dict) else getattr(call, "status", None),
        "task_completed": call.get("task_completed")
        if isinstance(call, dict)
        else getattr(call, "task_completed", None),
        "structured_result": call.get("structured_result")
        if isinstance(call, dict)
        else getattr(call, "structured_result", None),
    }
    text = json.dumps(redacted, ensure_ascii=False, indent=2)
    sys.stdout.buffer.write(text.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    if output:
        output.write_text(text + "\n", encoding="utf-8")
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
        "--output",
        type=Path,
        help="Write redacted structured result JSON here",
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

    return _run_live(request, args.output)


if __name__ == "__main__":
    sys.exit(main())
