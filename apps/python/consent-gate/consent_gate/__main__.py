from __future__ import annotations

import argparse
import hashlib
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


def _verified_outcome(result: dict) -> str:
    """Derive a retry-safe outcome from provider and structured evidence."""
    provider_status = str(result.get("status", "unknown")).lower()
    structured = result.get("structured_result")
    reachability = (
        str(structured.get("can_hear_clearly", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    stop_requested = (
        str(structured.get("stop_requested", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    contact_made = (
        str(structured.get("contact_made", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    # A provider rejection or an inaudible call is not evidence that the
    # recipient withdrew consent. Suppress future calls only on an explicit
    # stop request captured in the structured result.
    if stop_requested == "yes":
        return "rejected"
    if provider_status in {"no_answer", "failed"} and contact_made == "no":
        return provider_status
    if (
        provider_status == "completed"
        and contact_made == "yes"
        and reachability == "yes"
        and stop_requested == "no"
    ):
        return "completed"
    return "unknown"


def _request_for_plan(plan: dict) -> dict:
    task = (
        f"Begin by saying exactly: {plan['ai_disclosure']} "
        f"Then: {plan['purpose']} "
        "If the recipient asks to stop or not be called again, acknowledge the "
        "request, end the call, and set stop_requested to yes. "
        "Do not request passwords, passcodes, payment data, or other secrets."
    )
    return {
        "task": task,
        "recipients": [
            {
                "phones": [plan["phone"]],
                "locale": plan["locale"],
                "region": plan["region"],
            }
        ],
        "result_schema": {
            "type": "object",
            "required": ["contact_made", "can_hear_clearly", "stop_requested"],
            "properties": {
                "contact_made": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                    "description": (
                        "Whether there is positive evidence of recipient contact"
                    ),
                },
                "can_hear_clearly": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                },
                "stop_requested": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                    "description": (
                        "Whether the recipient explicitly asked to stop the call "
                        "or not be called again"
                    ),
                },
            },
        },
    }


def _request_identity(payload: dict) -> tuple[str, str]:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return digest, f"consent-gate-{digest}"


def _update_event(
    ledger: DurableLedger, reservation_id: str, **updates: object
) -> None:
    with ledger.locked_events() as history:
        for event in history:
            if event.get("reservation_id") == reservation_id:
                event.update(updates)
                event["updated_at"] = datetime.now(timezone.utc).isoformat()
                return
        raise PolicyError("durable reservation was not found")


def _finalize_result(
    ledger: DurableLedger, reservation_id: str, result: dict
) -> dict:
    outcome = _verified_outcome(result)
    _update_event(
        ledger,
        reservation_id,
        state="accepted" if outcome != "unknown" else "reconciliation_required",
        provider_status=result.get("status"),
        task_completed=result.get("task_completed"),
        outcome=outcome,
    )
    return {
        "status": result.get("status"),
        "task_completed": result.get("task_completed"),
        "completion_confidence": result.get("completion_confidence"),
        "structured_result": result.get("structured_result"),
    }


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

    request_payload = _request_for_plan(plan)
    request_sha256, idempotency_key = _request_identity(request_payload)
    with ledger.locked_events() as history:
        live_errors = validate_rejection_cooldown(plan, history)
        live_errors.extend(validate_attempt_limit(plan, history))
        # Re-evaluate after taking the cross-process lock so a queued dispatch
        # cannot cross the local-time boundary or race another process.
        live_errors.extend(validate_dispatch_window(plan))
        if live_errors:
            raise PolicyError("; ".join(live_errors))
        reservation = ledger.reservation(
            plan["phone"],
            request_payload=request_payload,
            request_sha256=request_sha256,
            idempotency_key=idempotency_key,
        )
        history.append(reservation)

    client = CalleClient(api_key=api_key)
    try:
        created = client.calls.create(
            **request_payload, idempotency_key=idempotency_key
        )
        call_id = str(created.get("id", "")).strip()
        if not call_id:
            raise PolicyError("provider accepted create without returning a call ID")
        _update_event(
            ledger,
            reservation["reservation_id"],
            state="accepted_waiting",
            provider_call_id=call_id,
        )
        result = client.calls.wait_for_result(call_id)
    except Exception:
        # Keep an ambiguous dispatch reserved. A human must reconcile it with
        # the provider before another attempt; automatic redial is unsafe.
        _update_event(
            ledger,
            reservation["reservation_id"],
            state="reconciliation_required",
        )
        raise
    return _finalize_result(ledger, reservation["reservation_id"], result)


def _reconcile(
    plan: dict,
    confirmation: str | None,
    state_path: str | None,
    reservation_id: str | None,
) -> dict:
    errors = validate_plan(plan)
    if plan.get("execution_allowed") is not True:
        errors.append("reconciliation requires execution_allowed: true")
    if errors:
        raise PolicyError("; ".join(errors))
    if confirmation != CONFIRMATION:
        raise PolicyError(f"reconciliation requires --confirm {CONFIRMATION!r}")
    if not state_path or not reservation_id:
        raise PolicyError("reconciliation requires --state and --reservation")
    payload = _request_for_plan(plan)
    request_sha256, idempotency_key = _request_identity(payload)
    ledger = DurableLedger(state_path)
    with ledger.locked_events() as history:
        event = next(
            (item for item in history if item.get("reservation_id") == reservation_id),
            None,
        )
        if event is None:
            raise PolicyError("durable reservation was not found")
        if event.get("state") != "reconciliation_required":
            raise PolicyError("reservation does not require reconciliation")
        if (
            event.get("request_payload") != payload
            or event.get("request_sha256") != request_sha256
            or event.get("idempotency_key") != idempotency_key
        ):
            raise PolicyError("plan does not match the reserved request")
        call_id = str(event.get("provider_call_id", "")).strip()

    api_key = _load_api_key()
    try:
        from calle import CalleClient
    except ImportError as exc:
        raise PolicyError("install the live extra: pip install '.[live]'") from exc
    client = CalleClient(api_key=api_key)
    try:
        if not call_id:
            window_errors = validate_dispatch_window(plan)
            if window_errors:
                raise PolicyError("; ".join(window_errors))
            created = client.calls.create(**payload, idempotency_key=idempotency_key)
            call_id = str(created.get("id", "")).strip()
            if not call_id:
                raise PolicyError("same-key reconciliation returned no call ID")
            _update_event(
                ledger,
                reservation_id,
                state="accepted_waiting",
                provider_call_id=call_id,
            )
        result = client.calls.wait_for_result(call_id)
    except Exception:
        _update_event(ledger, reservation_id, state="reconciliation_required")
        raise
    return _finalize_result(ledger, reservation_id, result)


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
            "stop_requested": "no",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Consent-first CALL-E preflight")
    parser.add_argument(
        "command",
        choices=["validate", "manifest", "simulate", "execute", "reconcile"],
    )
    parser.add_argument(
        "--state",
        help="required durable JSON ledger for live execution",
    )
    parser.add_argument("plan")
    parser.add_argument("--confirm")
    parser.add_argument("--reservation")
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
        if args.command == "reconcile":
            print(
                json.dumps(
                    _reconcile(plan, args.confirm, args.state, args.reservation),
                    indent=2,
                    sort_keys=True,
                )
            )
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
