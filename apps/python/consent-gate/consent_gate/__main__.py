from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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
NAMESPACE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$")
DO_NOT_CALL = re.compile(
    r"\b(do not call|don't call|never call|stop calling|remove me from|"
    r"do not contact|don't contact)\b",
    re.IGNORECASE,
)


def _transcript_text(result: dict, *, recipient_only: bool = False) -> str:
    turns: list[str] = []
    recipients = result.get("recipients")
    if not isinstance(recipients, list):
        return ""
    for recipient in recipients:
        if not isinstance(recipient, dict):
            continue
        attempts = recipient.get("attempts")
        if not isinstance(attempts, list):
            continue
        for attempt in attempts:
            if not isinstance(attempt, dict):
                continue
            transcript = attempt.get("transcript_turns")
            if not isinstance(transcript, list):
                continue
            for turn in transcript:
                if not isinstance(turn, dict) or not isinstance(turn.get("text"), str):
                    continue
                if recipient_only and str(turn.get("speaker", "")).lower() not in {
                    "recipient",
                    "user",
                    "callee",
                }:
                    continue
                turns.append(turn["text"])
    return "\n".join(turns)


def _has_high_confidence_evidence(result: dict) -> bool:
    confidence = result.get("completion_confidence")
    if not isinstance(confidence, dict):
        return False
    try:
        score = float(confidence.get("score", 0))
    except (TypeError, ValueError):
        return False
    return (
        result.get("task_completed") is True
        and score >= 0.8
        and str(confidence.get("label", "")).lower() == "high"
        and bool(result.get("evidence"))
        and bool(_transcript_text(result).strip())
    )


def _has_verified_no_contact(result: dict) -> bool:
    recipients = result.get("recipients")
    if not isinstance(recipients, list) or not recipients:
        return False
    attempts_found = False
    no_contact_codes = {"no_answer", "not_connected", "unreachable"}
    for recipient in recipients:
        if not isinstance(recipient, dict):
            return False
        attempts = recipient.get("attempts")
        if not isinstance(attempts, list) or not attempts:
            return False
        for attempt in attempts:
            if not isinstance(attempt, dict):
                return False
            attempts_found = True
            if str(attempt.get("status", "")).lower() not in {"failed", "canceled"}:
                return False
            if str(attempt.get("failure_code", "")).lower() not in no_contact_codes:
                return False
            if attempt.get("transcript_turns"):
                return False
    return attempts_found


def _verified_outcome(result: dict) -> str:
    """Derive a retry-safe outcome from provider and structured evidence."""
    provider_status = str(result.get("status", "unknown")).lower()
    structured = result.get("structured_result")
    reachability = (
        str(structured.get("can_hear_clearly", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    end_call_requested = (
        str(structured.get("end_call_requested", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    do_not_call_requested = (
        str(structured.get("do_not_call_requested", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    contact_made = (
        str(structured.get("contact_made", "unknown")).lower()
        if isinstance(structured, dict)
        else "unknown"
    )
    if do_not_call_requested == "yes":
        if _has_high_confidence_evidence(result) and DO_NOT_CALL.search(
            _transcript_text(result, recipient_only=True)
        ):
            return "do_not_call"
        return "unknown"
    if (
        provider_status in {"no_answer", "failed"}
        and contact_made == "no"
        and _has_verified_no_contact(result)
    ):
        return provider_status
    if (
        provider_status == "completed"
        and contact_made == "yes"
        and reachability == "yes"
        and end_call_requested in {"yes", "no"}
        and do_not_call_requested == "no"
        and _has_high_confidence_evidence(result)
    ):
        return "completed"
    return "unknown"


def _request_for_plan(plan: dict, provider_namespace: str) -> dict:
    task = (
        f"Begin by saying exactly: {plan['ai_disclosure']} "
        f"Then: {plan['purpose']} "
        "Distinguish a request to end only this call from a request never to be "
        "called again. Set end_call_requested or do_not_call_requested exactly "
        "as spoken, acknowledge either request, and end the call. "
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
            "required": [
                "contact_made",
                "can_hear_clearly",
                "end_call_requested",
                "do_not_call_requested",
            ],
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
                "end_call_requested": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                    "description": (
                        "Whether the recipient explicitly asked to end this call"
                    ),
                },
                "do_not_call_requested": {
                    "type": "string",
                    "enum": ["yes", "no", "unknown"],
                    "description": (
                        "Whether the recipient explicitly requested no future calls"
                    ),
                },
            },
        },
        "metadata": {"consent_gate_provider_namespace": provider_namespace},
    }


def _request_identity(payload: dict, provider_namespace: str) -> tuple[str, str]:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    basis = f"{provider_namespace}\n{canonical}"
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()
    namespace_digest = hashlib.sha256(
        provider_namespace.encode("utf-8")
    ).hexdigest()[:12]
    return digest, f"consent-gate-{namespace_digest}-{digest}"


def _load_provider_namespace() -> str:
    namespace = os.environ.get("CALLE_IDEMPOTENCY_NAMESPACE", "").strip()
    if not NAMESPACE.fullmatch(namespace):
        raise PolicyError(
            "CALLE_IDEMPOTENCY_NAMESPACE must be a stable 3-80 character "
            "provider account or project namespace"
        )
    return namespace


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
    provider_namespace = _load_provider_namespace()

    try:
        from calle import CalleClient
    except ImportError as exc:
        raise PolicyError("install the live extra: pip install '.[live]'") from exc

    request_payload = _request_for_plan(plan, provider_namespace)
    request_sha256, idempotency_key = _request_identity(
        request_payload, provider_namespace
    )
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
            provider_namespace=provider_namespace,
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
    provider_namespace = _load_provider_namespace()
    payload = _request_for_plan(plan, provider_namespace)
    request_sha256, idempotency_key = _request_identity(
        payload, provider_namespace
    )
    ledger = DurableLedger(state_path)
    with ledger.locked_events() as history:
        event = next(
            (item for item in history if item.get("reservation_id") == reservation_id),
            None,
        )
        if event is None:
            raise PolicyError("durable reservation was not found")
        state = event.get("state")
        if state not in {"accepted_waiting", "reconciliation_required"}:
            raise PolicyError("reservation does not require reconciliation")
        if (
            event.get("request_payload") != payload
            or event.get("request_sha256") != request_sha256
            or event.get("idempotency_key") != idempotency_key
            or event.get("provider_namespace") != provider_namespace
        ):
            raise PolicyError("plan does not match the reserved request")
        call_id = str(event.get("provider_call_id", "")).strip()
        if state == "accepted_waiting" and not call_id:
            raise PolicyError("accepted_waiting reservation is missing its call ID")

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
            "end_call_requested": "no",
            "do_not_call_requested": "no",
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
