from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .ledger import DurableLedger

from .policy import (
    PolicyError,
    build_manifest,
    load_plan,
    validate_attempt_limit,
    validate_dispatch_window,
    validate_plan,
    validate_rejection_cooldown,
)


CONFIRMATION = "I reviewed this call plan"


def _load_api_key() -> str:
    api_key = os.environ.get("CALLE_API_KEY", "").strip()
    if api_key:
        return api_key

    key_file = os.environ.get("CALLE_API_KEY_FILE", "").strip()
    if not key_file:
        raise PolicyError("CALLE_API_KEY or CALLE_API_KEY_FILE is required")
    try:
        api_key = Path(key_file).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise PolicyError("could not read CALLE_API_KEY_FILE") from exc
    if not api_key:
        raise PolicyError("CALLE_API_KEY_FILE is empty")
    return api_key


def _load_history(path: str | None) -> list[dict]:
    if not path:
        return []
    with open(path, encoding="utf-8") as handle:
        history = json.load(handle)
    if not isinstance(history, list):
        raise PolicyError("history must be a JSON array")
    return history


def _execute(
    plan: dict, confirmation: str | None, state_path: str | None
) -> dict:
    errors = validate_plan(plan)
    if plan.get("execution_allowed") is not True:
        raise PolicyError("live execution requires execution_allowed: true")
    if confirmation != CONFIRMATION:
        raise PolicyError(f"live execution requires --confirm {CONFIRMATION!r}")
    if not state_path:
        raise PolicyError("live execution requires --state with a durable ledger path")
    ledger = DurableLedger(state_path)
    # The current CALL-E SDK does not expose verifiable recording/retention
    # controls. Never claim these choices are enforced when making a live call.
    if plan["recording"] is not False or plan["retention_days"] != 0:
        errors.append(
            "live execution currently requires recording=false and retention_days=0"
        )
    errors.extend(validate_dispatch_window(plan))
    if errors:
        raise PolicyError("; ".join(errors))
    api_key = _load_api_key()

    try:
        from calle import CalleClient
    except ImportError as exc:
        raise PolicyError("install the live extra: pip install '.[live]'") from exc

    task = (
        f"Begin by saying exactly: {plan['ai_disclosure']} "
        f"Then: {plan['purpose']} "
        "Do not request passwords, passcodes, payment data, or other secrets."
    )
    with ledger.locked_events() as history:
        live_errors = validate_rejection_cooldown(plan, history)
        live_errors.extend(validate_attempt_limit(plan, history))
        # Re-evaluate after taking the cross-process lock so a queued dispatch
        # cannot cross the local-time boundary or race another process.
        live_errors.extend(validate_dispatch_window(plan))
        if live_errors:
            raise PolicyError("; ".join(live_errors))
        reservation = ledger.reservation(plan["phone"])
        history.append(reservation)

    client = CalleClient(api_key=api_key)
    try:
        result = client.calls.create_and_wait(
            task=task,
            recipients=[
                {
                    "phones": [plan["phone"]],
                    "locale": plan["locale"],
                    "region": plan["region"],
                }
            ],
            result_schema={
                "type": "object",
                "required": ["can_hear_clearly"],
                "properties": {
                    "can_hear_clearly": {
                        "type": "string",
                        "enum": ["yes", "no", "unknown"],
                    }
                },
            },
        )
    except Exception:
        # Keep an ambiguous dispatch reserved. A human must reconcile it with
        # the provider before another attempt; automatic redial is unsafe.
        with ledger.locked_events() as history:
            for event in history:
                if event.get("reservation_id") == reservation["reservation_id"]:
                    event["state"] = "reconciliation_required"
                    event["updated_at"] = datetime.now(timezone.utc).isoformat()
        raise

    with ledger.locked_events() as history:
        for event in history:
            if event.get("reservation_id") == reservation["reservation_id"]:
                event["state"] = "accepted"
                event["updated_at"] = datetime.now(timezone.utc).isoformat()
                event["provider_status"] = result.get("status")
                event["task_completed"] = result.get("task_completed")
                provider_status = str(result.get("status", "unknown")).lower()
                event["outcome"] = (
                    provider_status
                    if provider_status
                    in {"completed", "rejected", "no_answer", "failed"}
                    else "unknown"
                )
    return {
        "status": result.get("status"),
        "task_completed": result.get("task_completed"),
        "completion_confidence": result.get("completion_confidence"),
        "structured_result": result.get("structured_result"),
    }


def _simulate(plan: dict, history: list[dict]) -> dict:
    """Build a deterministic, fully offline demonstration result."""
    errors = validate_plan(plan)
    errors.extend(validate_rejection_cooldown(plan, history))
    if errors:
        raise PolicyError("; ".join(errors))

    disclosure = plan["ai_disclosure"].strip()
    purpose = plan["purpose"].strip()
    return {
        "mode": "offline_simulation",
        "network_used": False,
        "call_placed": False,
        "preflight": "passed",
        "manifest": build_manifest(plan),
        "simulated_transcript": [
            {"speaker": "agent", "text": disclosure},
            {"speaker": "agent", "text": purpose},
            {"speaker": "recipient", "text": "Yes, I can hear you clearly."},
            {
                "speaker": "agent",
                "text": "Thank you. The test is complete; I will end the call now.",
            },
        ],
        "simulated_result": {
            "status": "completed",
            "task_completed": True,
            "can_hear_clearly": "yes",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Consent-first CALL-E preflight")
    parser.add_argument(
        "command", choices=["validate", "manifest", "simulate", "execute"]
    )
    parser.add_argument(
        "--state",
        help="required durable JSON ledger for live execution",
    )
    parser.add_argument("plan")
    parser.add_argument("--confirm")
    parser.add_argument(
        "--history",
        help="JSON event ledger used to enforce the 24-hour rejection cooldown",
    )
    args = parser.parse_args()

    try:
        plan = load_plan(args.plan)
        history = _load_history(args.history)
        if args.command == "validate":
            errors = validate_plan(plan)
            errors.extend(validate_rejection_cooldown(plan, history))
            if errors:
                for error in errors:
                    print(f"BLOCK: {error}", file=sys.stderr)
                return 2
            print("PASS: call plan satisfies ConsentGate preflight")
            return 0
        if args.command == "manifest":
            print(json.dumps(build_manifest(plan), indent=2, sort_keys=True))
            return 0
        if args.command == "simulate":
            print(json.dumps(_simulate(plan, history), indent=2, sort_keys=True))
            return 0
        print(
            json.dumps(
                _execute(plan, args.confirm, args.state),
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    except (OSError, json.JSONDecodeError, PolicyError) as exc:
        print(f"BLOCK: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
