"""Preview or execute the qualification calls for one lead file.

Preview is the default and never contacts CALL-E. Execution creates at most one
call per lead, keyed by a stable idempotency key, polls that call until it
reaches a terminal status, and routes the structured result.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from typing import Any, Callable, Protocol

from .locales import local_time, next_business_start, within_business_hours
from .models import Lead, LeadBatch, load_batch, redact
from .routing import ROUTE_RETRY, Decision, route_outcome
from .schema import build_result_schema
from .task import build_metadata, build_task, describe_market

DEFAULT_BASE_URL = "https://api.heycall-e.com"
#: A status missing from this set is polled until the timeout and then aborts
#: the batch, so anything final the provider can report has to be listed here.
#: `declined` and `rejected` are included because CALL-E maps a failed
#: per-recipient result to a decline even when the call never established
#: media; `routing.py` decides what a decline is worth. CALL-E confirmed this
#: mapping while investigating the failures in `docs/field-notes.md`
#: (CALLE-AI/awesome-phone-call-agents#81).
TERMINAL_STATUSES = frozenset(
    {
        "completed",
        "succeeded",
        "failed",
        "canceled",
        "cancelled",
        "expired",
        "no_answer",
        "busy",
        "declined",
        "rejected",
    }
)


class CallsAPI(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def get(self, call_id: str) -> dict[str, Any]: ...


DEFAULT_MAX_ATTEMPTS = 3


def idempotency_key(lead: Lead, attempt: int = 1) -> str:
    """Stable within one attempt, so a rerun cannot duplicate that attempt.

    A deliberate retry after `retry_later` carries a new attempt number, because
    reusing the key would make the provider replay the failed call instead of
    dialling again.

    The dialled number is folded in as a short digest, so correcting a mistyped
    phone on an existing lead produces a new key instead of a silent provider
    dedupe against the call to the wrong number. The digest keeps the number
    itself out of the key, which travels in headers and logs.
    """
    digest = hashlib.sha256(lead.phone.encode("utf-8")).hexdigest()[:8]
    base = f"carimport-{lead.campaign_id}-{lead.lead_id}-{digest}"
    return base if attempt <= 1 else f"{base}-a{attempt}"


def confidence_score(value: Any) -> float | None:
    """CALL-E returns {"score": float, "label": str}; older shapes send a float."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        score = value.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            return float(score)
    return None


def build_call_arguments(lead: Lead, attempt: int = 1) -> dict[str, Any]:
    return {
        "task": build_task(lead),
        "recipients": [{"phones": [lead.phone], "locale": lead.locale}],
        "result_schema": build_result_schema(),
        "metadata": build_metadata(lead),
        "idempotency_key": idempotency_key(lead, attempt),
    }


def masked_call_arguments(lead: Lead) -> dict[str, Any]:
    arguments = build_call_arguments(lead)
    arguments["recipients"] = [
        {"phones": [lead.masked_phone], "locale": lead.locale}
    ]
    return arguments


def callable_now(lead: Lead, now: datetime) -> dict[str, Any]:
    """Business-hours check for one lead, in the lead's own market timezone."""
    allowed = within_business_hours(lead.timezone, lead.business_hours, now)
    return {
        "local_time": local_time(lead.timezone, now).isoformat(timespec="minutes"),
        "business_hours": lead.business_hours_label,
        "within_business_hours": allowed,
        "next_local_window": (
            None
            if allowed
            else next_business_start(
                lead.timezone, lead.business_hours, now
            ).isoformat(timespec="minutes")
        ),
    }


def preview_lead(lead: Lead, now: datetime) -> dict[str, Any]:
    return {
        "lead_id": lead.lead_id,
        "phone": lead.masked_phone,
        "market": describe_market(lead),
        "idempotency_key": idempotency_key(lead),
        "schedule": callable_now(lead, now),
        "call_arguments": masked_call_arguments(lead),
    }


def poll_for_result(
    calls: CallsAPI,
    call_id: str,
    *,
    timeout_seconds: float,
    interval_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Poll one call until it reaches a terminal status or the timeout expires."""
    deadline = monotonic() + timeout_seconds
    while True:
        snapshot = calls.get(call_id)
        if not isinstance(snapshot, dict):
            raise RuntimeError("CALL-E status response was not an object")
        if snapshot.get("status") in TERMINAL_STATUSES:
            return snapshot
        if monotonic() >= deadline:
            raise TimeoutError(
                f"call {call_id} did not reach a terminal status within "
                f"{timeout_seconds:g}s; check the CALL-E dashboard before retrying"
            )
        sleep(interval_seconds)


def execute_lead(
    lead: Lead,
    calls: CallsAPI,
    *,
    timeout_seconds: float,
    interval_seconds: float,
    attempt: int = 1,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Create exactly one call for the lead and route its terminal result."""
    created = calls.create(**build_call_arguments(lead, attempt))
    call_id = created.get("id") if isinstance(created, dict) else None
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("CALL-E create response did not contain a call id")

    completed = poll_for_result(
        calls,
        call_id,
        timeout_seconds=timeout_seconds,
        interval_seconds=interval_seconds,
        sleep=sleep,
    )
    provider_status = completed.get("status")
    task_completed = completed.get("task_completed")
    confidence = completed.get("completion_confidence")
    structured = completed.get("structured_result")
    if structured is not None and not isinstance(structured, dict):
        raise RuntimeError("CALL-E structured_result was not an object")

    decision = route_outcome(
        lead,
        structured,
        provider_status=provider_status if isinstance(provider_status, str) else None,
        task_completed=task_completed if isinstance(task_completed, bool) else None,
        completion_confidence=confidence_score(confidence),
    )
    return {
        "lead_id": lead.lead_id,
        "phone": lead.masked_phone,
        "outcome": "called",
        "attempt": attempt,
        "call_id": call_id,
        "idempotency_key": idempotency_key(lead, attempt),
        "provider_status": provider_status,
        "task_completed": task_completed,
        "completion_confidence": confidence,
        "structured_result": redact(structured),
        "decision": decision.as_dict(),
    }


def deferred_lead(lead: Lead, schedule: dict[str, Any]) -> dict[str, Any]:
    return {
        "lead_id": lead.lead_id,
        "phone": lead.masked_phone,
        "outcome": "deferred",
        "reason": (
            f"Local time {schedule['local_time']} is outside {schedule['business_hours']}."
        ),
        "next_local_window": schedule["next_local_window"],
        "decision": Decision(
            route="retry_later",
            priority="low",
            reason="Deferred by the local business-hours guard; no call was created.",
            follow_up_allowed=True,
            suppress_number=False,
        ).as_dict(),
    }


def skipped_lead(lead: Lead, previous: dict[str, Any]) -> dict[str, Any]:
    return {
        "lead_id": lead.lead_id,
        "phone": lead.masked_phone,
        "outcome": "skipped",
        "reason": (
            f"This lead already reached {previous.get('route')!r} in the state file."
        ),
        "call_id": previous.get("call_id"),
        "attempt": previous_attempts(previous),
    }


def exhausted_lead(
    lead: Lead, previous: dict[str, Any], max_attempts: int
) -> dict[str, Any]:
    return {
        "lead_id": lead.lead_id,
        "phone": lead.masked_phone,
        "outcome": "exhausted",
        "reason": (
            f"{max_attempts} attempts already ended in retry_later; a human should "
            "check the number before it is dialled again."
        ),
        "call_id": previous.get("call_id"),
        "attempt": previous_attempts(previous),
        "decision": Decision(
            route="manual_review",
            priority="low",
            reason="Retry budget spent without a completed call.",
            follow_up_allowed=False,
            suppress_number=False,
        ).as_dict(),
    }


def previous_attempts(previous: dict[str, Any]) -> int:
    attempts = previous.get("attempts")
    return attempts if isinstance(attempts, int) and attempts > 0 else 1


def load_state(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        state = json.load(handle)
    if not isinstance(state, dict):
        raise ValueError("state file must contain a JSON object")
    return state


def save_state(path: Path | None, state: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.chmod(0o600)
    temporary.replace(path)


def preview(batch: LeadBatch, leads: tuple[Lead, ...], now: datetime) -> dict[str, Any]:
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "campaign_id": batch.campaign_id,
        "dealer_display_name": batch.dealer_display_name,
        "lead_count": len(leads),
        "leads": [preview_lead(lead, now) for lead in leads],
    }


def execute(
    batch: LeadBatch,
    leads: tuple[Lead, ...],
    calls: CallsAPI,
    *,
    now: datetime,
    timeout_seconds: float,
    interval_seconds: float,
    allow_outside_business_hours: bool = False,
    state_path: Path | None = None,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    state = load_state(state_path)
    recorded_calls: dict[str, Any] = state.setdefault("calls", {})
    state.setdefault("campaign_id", batch.campaign_id)

    results: list[dict[str, Any]] = []
    for lead in leads:
        previous = recorded_calls.get(lead.lead_id)
        attempt = 1
        if isinstance(previous, dict):
            # Only `retry_later` leaves a lead callable; every other route is a
            # decision that must not be re-dialled.
            if previous.get("route") != ROUTE_RETRY:
                results.append(skipped_lead(lead, previous))
                continue
            attempt = previous_attempts(previous) + 1
            if attempt > max_attempts:
                results.append(exhausted_lead(lead, previous, max_attempts))
                continue

        schedule = callable_now(lead, now)
        if not schedule["within_business_hours"] and not allow_outside_business_hours:
            results.append(deferred_lead(lead, schedule))
            continue

        result = execute_lead(
            lead,
            calls,
            timeout_seconds=timeout_seconds,
            interval_seconds=interval_seconds,
            attempt=attempt,
            sleep=sleep,
        )
        results.append(result)
        recorded_calls[lead.lead_id] = {
            "attempts": attempt,
            "call_id": result["call_id"],
            "idempotency_key": result["idempotency_key"],
            "route": result["decision"]["route"],
        }
        save_state(state_path, state)

    return {
        "mode": "execute",
        "creates_phone_call": True,
        "campaign_id": batch.campaign_id,
        "dealer_display_name": batch.dealer_display_name,
        "lead_count": len(leads),
        "calls_created": sum(1 for item in results if item["outcome"] == "called"),
        "results": results,
    }


def parse_now(value: str | None) -> datetime:
    if value is None:
        return datetime.now(dt_timezone.utc)
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("--now must be an ISO 8601 datetime") from exc
    if moment.tzinfo is None:
        raise ValueError("--now must include a UTC offset, for example 2026-08-03T10:00:00Z")
    return moment


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="car-import-lead-qualifier",
        description="Preview or run car import lead qualification calls with CALL-E.",
    )
    parser.add_argument(
        "--leads", required=True, type=Path, help="Path to the lead JSON file."
    )
    parser.add_argument("--lead-id", help="Process only this lead_id.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--preview",
        action="store_true",
        help="Validate and print a masked no-call plan. This is the default.",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Create at most one CALL-E call per lead and wait for each result.",
    )
    parser.add_argument(
        "--confirm-lead-consent",
        action="store_true",
        help="Required with --execute; confirms every lead asked to be contacted.",
    )
    parser.add_argument(
        "--allow-outside-business-hours",
        action="store_true",
        help="Call leads whose local time is outside their business hours.",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        help=(
            "JSON file recording placed calls. A rerun skips decided leads and "
            "re-dials only the ones that ended in retry_later."
        ),
    )
    parser.add_argument(
        "--max-attempts",
        type=int,
        default=DEFAULT_MAX_ATTEMPTS,
        help=(
            f"Retry budget per lead across runs, default {DEFAULT_MAX_ATTEMPTS}. "
            "Needs --state-file to be counted."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional new JSON result path; existing files are never overwritten.",
    )
    parser.add_argument(
        "--base-url", default=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument("--timeout-seconds", type=float, default=600.0)
    parser.add_argument("--poll-interval-seconds", type=float, default=5.0)
    parser.add_argument("--now", help="ISO 8601 instant used for business-hours checks.")
    return parser.parse_args(argv)


def write_output(path: Path | None, payload: dict[str, Any]) -> None:
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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        now = parse_now(args.now)
        batch = load_batch(args.leads)
        leads = batch.select(args.lead_id)

        if not args.execute:
            write_output(args.output, preview(batch, leads, now))
            return 0

        if not args.confirm_lead_consent:
            raise ValueError("--execute requires --confirm-lead-consent")
        if args.timeout_seconds <= 0 or args.poll_interval_seconds <= 0:
            raise ValueError("--timeout-seconds and --poll-interval-seconds must be positive")
        if args.max_attempts < 1:
            raise ValueError("--max-attempts must be at least 1")
        api_key = os.environ.get("CALLE_API_KEY")
        if not api_key:
            raise ValueError("CALLE_API_KEY is required for --execute")

        from calle import CalleClient

        client = CalleClient(api_key=api_key, base_url=args.base_url)
        payload = execute(
            batch,
            leads,
            client.calls,
            now=now,
            timeout_seconds=args.timeout_seconds,
            interval_seconds=args.poll_interval_seconds,
            allow_outside_business_hours=args.allow_outside_business_hours,
            state_path=args.state_file,
            max_attempts=args.max_attempts,
        )
        write_output(args.output, payload)
        return 0
    except (
        FileExistsError,
        FileNotFoundError,
        OSError,
        ValueError,
        RuntimeError,
        TimeoutError,
        json.JSONDecodeError,
    ) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
