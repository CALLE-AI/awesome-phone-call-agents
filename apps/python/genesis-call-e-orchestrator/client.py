"""Safe CLI and library entry point for the Genesis CALL-E Orchestrator."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Callable

from scenarios import SCENARIOS, build_task, follow_up, simulated_result

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}***{phone[-4:]}" if len(phone) >= 7 else "***"


def validate_request(request: dict[str, Any]) -> dict[str, Any]:
    scenario = str(request.get("scenario") or "")
    if scenario not in SCENARIOS:
        raise ValueError(f"scenario must be one of: {', '.join(SCENARIOS)}")
    phone = str(request.get("phone_number") or "").strip()
    if not _E164.fullmatch(phone):
        raise ValueError("phone_number must be an explicit E.164 number; country codes are never guessed")
    if request.get("authorized_recipient") is not True:
        raise ValueError("authorized_recipient must be true before this workflow can be prepared")
    context = request.get("context") or {}
    if not isinstance(context, dict):
        raise ValueError("context must be a JSON object")
    return {**request, "scenario": scenario, "phone_number": phone, "context": context}


def build_preview(request: dict[str, Any]) -> dict[str, Any]:
    checked = validate_request(request)
    scenario = checked["scenario"]
    return {
        "mode": "preview",
        "scenario": scenario,
        "title": SCENARIOS[scenario]["title"],
        "phone_number_masked": mask_phone(checked["phone_number"]),
        "task": build_task(checked),
        "recipient_result_schema": SCENARIOS[scenario]["result_schema"],
        "side_effect": "No phone call was placed.",
    }


def run_simulation(request: dict[str, Any]) -> dict[str, Any]:
    checked = validate_request(request)
    structured = simulated_result(checked["scenario"])
    return {
        "mode": "simulation",
        "provider": "local-deterministic",
        "success": True,
        "scenario": checked["scenario"],
        "phone_number_masked": mask_phone(checked["phone_number"]),
        "result": structured,
        "follow_up_action": follow_up(checked["scenario"], structured),
        "side_effect": "No phone call was placed.",
    }


def _idempotency_key(request: dict[str, Any], task: str) -> str:
    material = json.dumps(
        {"scenario": request["scenario"], "phone": request["phone_number"], "task": task},
        sort_keys=True,
        separators=(",", ":"),
    )
    return "genesis:" + hashlib.sha256(material.encode("utf-8")).hexdigest()


def run_live(
    request: dict[str, Any],
    *,
    confirmed_authorized_recipient: bool,
    client_factory: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    checked = validate_request(request)
    if os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").lower() != "true":
        raise RuntimeError("live calls are disabled; set CALLE_LIVE_CALLS_ENABLED=true after review")
    if not confirmed_authorized_recipient:
        raise RuntimeError("live calls require --confirm-authorized-recipient")
    api_key = os.environ.get("CALLE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("CALLE_API_KEY is required for live calls")
    if client_factory is None:
        from calle import CalleClient

        client_factory = CalleClient

    task = build_task(checked)
    scenario = checked["scenario"]
    client = client_factory(
        api_key=api_key,
        base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"),
        timeout=float(os.environ.get("CALLE_HTTP_TIMEOUT_SECONDS", "30")),
    )
    try:
        terminal = client.calls.create_and_wait(
            task=task,
            recipient={
                "phone": checked["phone_number"],
                "region": checked.get("region"),
                "locale": checked.get("locale"),
            },
            recipient_result_schema=SCENARIOS[scenario]["result_schema"],
            metadata={"workflow": "genesis-call-e-orchestrator", "scenario": scenario},
            idempotency_key=_idempotency_key(checked, task),
            timeout_seconds=float(os.environ.get("CALLE_CALL_TIMEOUT_SECONDS", "600")),
        )
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()
    recipient = (terminal.get("recipients") or [{}])[0]
    structured = recipient.get("structured_result") or terminal.get("structured_result") or {}
    success = terminal.get("status") == "completed" and bool(structured)
    return {
        "mode": "live",
        "provider": "call-e",
        "success": success,
        "scenario": scenario,
        "call_id": terminal.get("id"),
        "status": terminal.get("status"),
        "phone_number_masked": mask_phone(checked["phone_number"]),
        "result": structured,
        "follow_up_action": follow_up(scenario, structured) if success else {
            "type": "manual_review",
            "reason": "The call did not return a complete structured result.",
        },
    }


def _write_new(path: str | None, payload: dict[str, Any]) -> None:
    if not path:
        return
    with Path(path).open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="Path to a reviewed request JSON file.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--simulate", action="store_true", help="Run the complete no-call demo flow.")
    mode.add_argument("--execute", action="store_true", help="Place one real CALL-E call.")
    parser.add_argument("--confirm-authorized-recipient", action="store_true")
    parser.add_argument("--output", help="Create a new JSON result file; existing files are never overwritten.")
    args = parser.parse_args(argv)
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        if args.execute:
            result = run_live(
                request,
                confirmed_authorized_recipient=args.confirm_authorized_recipient,
            )
        elif args.simulate:
            result = run_simulation(request)
        else:
            result = build_preview(request)
        _write_new(args.output, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
