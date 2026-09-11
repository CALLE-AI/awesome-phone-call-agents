"""FreshChain Resolver: coordinate one cold-chain delivery exception by phone."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


E164 = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$")
PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
DEFAULT_BASE_URL = "https://api.heycall-e.com"
TERMINAL_SUCCESS_STATUSES = {"completed", "succeeded"}
MIN_COMPLETION_CONFIDENCE = 0.8


class CallsAPI(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def wait_for_result(
        self, call_id: str, *, timeout_seconds: int, interval_seconds: int
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class DeliveryException:
    workflow_id: str
    shipment_reference: str
    phone: str
    authorized_operational_contact: bool
    caller_business_name: str
    receiving_site_name: str
    product_category: str
    predicted_arrival_local: str
    scheduled_window_end_local: str
    timezone: str
    locale: str
    temperature_status: str


def clean_text(value: Any, field: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    value = " ".join(value.split())
    if not minimum <= len(value) <= maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} characters")
    return value


def parse_local_datetime(
    value: Any, field: str, timezone: ZoneInfo | None
) -> str:
    text = clean_text(value, field, 16, 32)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"{field} must use an ISO local datetime") from exc
    if parsed.tzinfo is None and timezone:
        parsed = parsed.replace(tzinfo=timezone)
    return parsed.isoformat()


def parse_request(raw: Any) -> DeliveryException:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")

    workflow_id = clean_text(raw.get("workflow_id"), "workflow_id", 3, 64)
    shipment_reference = clean_text(
        raw.get("shipment_reference"), "shipment_reference", 3, 64
    )
    if not SAFE_ID.fullmatch(workflow_id):
        raise ValueError("workflow_id contains unsupported characters")
    if not SAFE_ID.fullmatch(shipment_reference):
        raise ValueError("shipment_reference contains unsupported characters")

    phone = clean_text(raw.get("phone"), "phone", 8, 16)
    if not E164.fullmatch(phone):
        raise ValueError("phone must use E.164 format")
    if raw.get("authorized_operational_contact") is not True:
        raise ValueError("authorized_operational_contact must be true")

    timezone_name = clean_text(raw.get("timezone"), "timezone", 3, 64)
    if not re.fullmatch(r"[A-Za-z]+(?:[._+-][A-Za-z]+)*/[A-Za-z]+(?:[._+-][A-Za-z]+)*", timezone_name):
        raise ValueError("timezone must be an IANA timezone such as America/New_York")
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        # Minimal Windows Python installations may not ship the IANA database.
        # The timezone name is retained and live installs declare `tzdata`.
        timezone = None

    predicted = parse_local_datetime(
        raw.get("predicted_arrival_local"), "predicted_arrival_local", timezone
    )
    window_end = parse_local_datetime(
        raw.get("scheduled_window_end_local"),
        "scheduled_window_end_local",
        timezone,
    )
    if datetime.fromisoformat(predicted) <= datetime.fromisoformat(window_end):
        raise ValueError(
            "predicted_arrival_local must be after scheduled_window_end_local"
        )

    temperature_status = raw.get("temperature_status")
    if temperature_status not in {"within_range", "unknown", "excursion"}:
        raise ValueError(
            "temperature_status must be within_range, unknown, or excursion"
        )

    locale = clean_text(raw.get("locale", "en-US"), "locale", 2, 16)
    if not re.fullmatch(r"[a-z]{2,3}(?:-[A-Z]{2})?", locale):
        raise ValueError("locale must look like en-US")

    return DeliveryException(
        workflow_id=workflow_id,
        shipment_reference=shipment_reference,
        phone=phone,
        authorized_operational_contact=True,
        caller_business_name=clean_text(
            raw.get("caller_business_name"), "caller_business_name", 2, 80
        ),
        receiving_site_name=clean_text(
            raw.get("receiving_site_name"), "receiving_site_name", 2, 100
        ),
        product_category=clean_text(
            raw.get("product_category"), "product_category", 3, 80
        ),
        predicted_arrival_local=predicted,
        scheduled_window_end_local=window_end,
        timezone=timezone_name,
        locale=locale,
        temperature_status=temperature_status,
    )


def load_request(path: Path) -> DeliveryException:
    with path.open(encoding="utf-8") as handle:
        return parse_request(json.load(handle))


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def build_task(request: DeliveryException) -> str:
    arrival = datetime.fromisoformat(request.predicted_arrival_local).strftime(
        "%Y-%m-%d %H:%M"
    )
    window_end = datetime.fromisoformat(request.scheduled_window_end_local).strftime(
        "%Y-%m-%d %H:%M"
    )
    temperature_guardrail = (
        "Temperature status is not confirmed as within range. Do not ask the recipient "
        "to judge product safety or accept the load. Ask only for the appropriate on-duty "
        "quality or operations escalation route, then end the call."
        if request.temperature_status != "within_range"
        else
        "The monitoring system reports temperature within range. State that this is only "
        "a logistics coordination call and do not make product-safety claims."
    )
    return (
        f"Call the authorized operational contact for {request.receiving_site_name} "
        f"on behalf of {request.caller_business_name}. Identify yourself as an AI calling "
        "assistant. Confirm this is the receiving or operations desk and ask for permission "
        "to continue. If not, do not disclose shipment details; ask only whether a general "
        "operations contact can be provided, then end. Never request personal, medical, "
        "financial, authentication, or payment information. "
        f"The non-secret shipment reference is {request.shipment_reference}; category: "
        f"{request.product_category}. Its scheduled receiving window ended at {window_end}, "
        f"and predicted arrival is {arrival}, timezone {request.timezone}. {temperature_guardrail} "
        "Ask whether the site can receive at the predicted arrival time. If yes, confirm whether "
        "the regular dock or an alternate dock should be used and whether a manual check-in is "
        "required. If no, ask for the next available receiving window. Ask whether a human "
        "operations escalation is required. Read back the operational outcome once. Do not "
        "book, cancel, authorize disposal, override quality controls, or promise acceptance."
    )


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": [
            "right_desk",
            "continued_after_ai_disclosure",
            "can_receive_at_eta",
            "dock_plan",
            "manual_check_in_required",
            "next_window_local",
            "human_escalation_required",
            "evidence_summary",
        ],
        "properties": {
            "right_desk": {"type": "string", "enum": ["yes", "no", "unknown"]},
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "can_receive_at_eta": {
                "type": "string",
                "enum": ["yes", "no", "unknown", "not_asked"],
            },
            "dock_plan": {
                "type": "string",
                "enum": ["regular", "alternate", "call_on_arrival", "unknown", "not_asked"],
            },
            "manual_check_in_required": {
                "type": "string",
                "enum": ["yes", "no", "unknown", "not_asked"],
            },
            "next_window_local": {
                "type": "string",
                "description": "Confirmed local window in YYYY-MM-DDTHH:MM format, or unknown.",
            },
            "human_escalation_required": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
            },
            "evidence_summary": {
                "type": "string",
                "description": "Short paraphrase without phone numbers or personal data.",
            },
        },
        "additionalProperties": False,
    }


def idempotency_key(request: DeliveryException) -> str:
    canonical = json.dumps(
        call_payload(request),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"freshchain-{hashlib.sha256(canonical).hexdigest()}"


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "api.heycall-e.com"
        and parsed.port in {None, 443}
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return "https://api.heycall-e.com"
    if (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.port is not None
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return value.rstrip("/")
    raise ValueError(
        "CALLE_BASE_URL must be the official HTTPS origin; plain HTTP is "
        "allowed only for an exact loopback test server with an explicit port"
    )


def call_payload(request: DeliveryException) -> dict[str, Any]:
    return {
        "task": build_task(request),
        "recipients": [{"phones": [request.phone], "locale": request.locale}],
        "result_schema": result_schema(),
        "metadata": {
            "workflow_id": request.workflow_id,
            "workflow_type": "cold_chain_delivery_exception",
            "shipment_reference": request.shipment_reference,
        },
    }


def build_call_arguments(request: DeliveryException) -> dict[str, Any]:
    payload = call_payload(request)
    return {
        **payload,
        "idempotency_key": idempotency_key(request),
    }


def route_outcome(
    request: DeliveryException,
    structured: dict[str, Any] | None,
    *,
    provider_status: str = "completed",
    task_completed: bool = True,
    completion_confidence: Any = 1.0,
) -> dict[str, str]:
    result = structured or {}
    if request.temperature_status != "within_range":
        return {
            "route": "hold",
            "reason": "Temperature status requires human quality review.",
        }
    if (
        provider_status not in TERMINAL_SUCCESS_STATUSES
        or task_completed is not True
        or confidence_score(completion_confidence) < MIN_COMPLETION_CONFIDENCE
    ):
        return {
            "route": "escalate",
            "reason": "CALL-E did not return a reliable terminal success result.",
        }
    if not valid_structured_result(result):
        return {
            "route": "escalate",
            "reason": "CALL-E did not return the complete required result schema.",
        }
    if result["human_escalation_required"] != "no":
        return {
            "route": "escalate",
            "reason": "The call result requires human operational escalation.",
        }
    if result.get("right_desk") != "yes" or result.get(
        "continued_after_ai_disclosure"
    ) != "yes":
        return {
            "route": "escalate",
            "reason": "The authorized receiving desk did not complete the call.",
        }
    if result.get("can_receive_at_eta") == "yes":
        return {
            "route": "proceed",
            "reason": "The receiving site confirmed it can receive at the predicted arrival.",
        }
    if result.get("can_receive_at_eta") == "no" and result.get(
        "next_window_local"
    ) not in {None, "", "unknown"}:
        return {
            "route": "rebook",
            "reason": "The site declined the ETA and supplied a next receiving window.",
        }
    return {
        "route": "escalate",
        "reason": "The call did not produce a safe, actionable logistics outcome.",
    }


def confidence_score(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        score = value.get("score")
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            return float(score)
    return 0.0


def valid_structured_result(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    schema = result_schema()
    required = schema["required"]
    if set(value) != set(required):
        return False
    for field in required:
        field_value = value.get(field)
        if not isinstance(field_value, str):
            return False
        allowed = schema["properties"][field].get("enum")
        if allowed is not None and field_value not in allowed:
            return False
    return len(value["evidence_summary"]) <= 500


def redact(value: Any) -> Any:
    if isinstance(value, str):
        return PHONE_LIKE.sub("[phone-redacted]", value)
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {key: redact(item) for key, item in value.items()}
    return value


def preview(request: DeliveryException) -> dict[str, Any]:
    arguments = build_call_arguments(request)
    arguments["recipients"] = [
        {"phones": [mask_phone(request.phone)], "locale": request.locale}
    ]
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "input": {
            **asdict(request),
            "phone": mask_phone(request.phone),
        },
        "call_arguments": arguments,
        "pre_call_route": (
            route_outcome(request, None)
            if request.temperature_status != "within_range"
            else {"route": "call_required", "reason": "Receiving confirmation is needed."}
        ),
    }


def simulated_result(request: DeliveryException, scenario: str) -> dict[str, Any]:
    scenarios = {
        "accept": {
            "right_desk": "yes",
            "continued_after_ai_disclosure": "yes",
            "can_receive_at_eta": "yes",
            "dock_plan": "alternate",
            "manual_check_in_required": "yes",
            "next_window_local": "unknown",
            "human_escalation_required": "no",
            "evidence_summary": "Receiving confirmed the ETA and directed the driver to the alternate dock.",
        },
        "rebook": {
            "right_desk": "yes",
            "continued_after_ai_disclosure": "yes",
            "can_receive_at_eta": "no",
            "dock_plan": "not_asked",
            "manual_check_in_required": "not_asked",
            "next_window_local": "2026-08-01T06:30",
            "human_escalation_required": "no",
            "evidence_summary": "Receiving declined the ETA and confirmed an early next-day window.",
        },
        "no-consent": {
            "right_desk": "yes",
            "continued_after_ai_disclosure": "no",
            "can_receive_at_eta": "not_asked",
            "dock_plan": "not_asked",
            "manual_check_in_required": "not_asked",
            "next_window_local": "unknown",
            "human_escalation_required": "yes",
            "evidence_summary": "The contact declined to continue after AI disclosure.",
        },
    }
    structured = scenarios[scenario]
    return {
        "mode": "simulate",
        "creates_phone_call": False,
        "scenario": scenario,
        "status": "completed",
        "structured_result": structured,
        "decision": route_outcome(request, structured),
    }


def execute(
    request: DeliveryException,
    calls: CallsAPI,
    timeout_seconds: int,
    on_created: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    created = calls.create(**build_call_arguments(request))
    call_id = created.get("id")
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("CALL-E create response did not contain a call id")
    if on_created is not None:
        on_created(call_id)
    completed = calls.wait_for_result(
        call_id, timeout_seconds=timeout_seconds, interval_seconds=2
    )
    status = completed.get("status")
    task_completed = completed.get("task_completed")
    completion_confidence = completed.get("completion_confidence")
    structured = completed.get("structured_result")
    if structured is not None and not isinstance(structured, dict):
        raise RuntimeError("CALL-E structured_result was not an object")
    return {
        "mode": "execute",
        "creates_phone_call": True,
        "call_id": call_id,
        "idempotency_key": idempotency_key(request),
        "status": status,
        "task_completed": task_completed,
        "completion_confidence": completion_confidence,
        "structured_result": redact(structured),
        "decision": route_outcome(
            request,
            structured,
            provider_status=status,
            task_completed=task_completed,
            completion_confidence=completion_confidence,
        ),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preview", action="store_true")
    mode.add_argument(
        "--simulate", choices=("accept", "rebook", "no-consent")
    )
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-authorized-recipient", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument(
        "--base-url", default=os.environ.get("CALLE_BASE_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--database",
        type=Path,
        default=Path(
            os.environ.get(
                "FRESHCHAIN_DB_PATH",
                Path(__file__).parent / "data" / "freshchain.sqlite3",
            )
        ),
    )
    return parser.parse_args(argv)


def write_output(path: Path | None, payload: dict[str, Any]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path is None:
        sys.stdout.write(rendered)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        handle.write(rendered)
    sys.stdout.write(f"Wrote {path}\n")


def execute_cli_with_audit(
    request: DeliveryException,
    calls: CallsAPI,
    timeout_seconds: int,
    database_path: Path,
) -> dict[str, Any]:
    from store import Store

    store = Store(database_path)
    case_id = store.claim_cli_live_execution(asdict(request))
    if case_id is None:
        raise RuntimeError(
            "Live execution is locked for this workflow; reconcile the "
            "calling or outcome_unknown case before retrying"
        )
    attempt_id: int | None = None
    accepted_call_id: str | None = None

    def persist_accepted(call_id: str) -> None:
        nonlocal attempt_id, accepted_call_id
        accepted_call_id = call_id
        attempt_id = store.record_call_accepted(case_id, call_id)

    try:
        result = execute(
            request,
            calls,
            timeout_seconds,
            on_created=persist_accepted,
        )
    except Exception as exc:
        store.record_live_ambiguity(
            case_id,
            attempt_id,
            accepted_call_id,
            type(exc).__name__,
        )
        raise RuntimeError(
            "CALL-E outcome is unknown; review the SQLite audit record "
            "before retrying"
        ) from exc
    if attempt_id is None:
        store.record_live_ambiguity(
            case_id,
            None,
            accepted_call_id,
            "MissingAcceptedCallAudit",
        )
        raise RuntimeError(
            "CALL-E result arrived without an accepted call audit"
        )
    store.complete_live_attempt(case_id, attempt_id, result)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        request = load_request(args.request)
        if args.simulate:
            payload = simulated_result(request, args.simulate)
        elif args.execute:
            if not args.confirm_authorized_recipient:
                raise ValueError("--execute requires --confirm-authorized-recipient")
            if os.environ.get("CALLE_LIVE_CALLS_ENABLED", "").lower() != "true":
                raise ValueError(
                    "--execute requires CALLE_LIVE_CALLS_ENABLED=true"
                )
            if args.timeout_seconds <= 0:
                raise ValueError("--timeout-seconds must be positive")
            api_key = os.environ.get("CALLE_API_KEY")
            if not api_key:
                raise ValueError("CALLE_API_KEY is required for --execute")
            from calle import CalleClient

            client = CalleClient(
                api_key=api_key, base_url=validate_base_url(args.base_url)
            )
            payload = execute_cli_with_audit(
                request,
                client.calls,
                args.timeout_seconds,
                args.database,
            )
        else:
            payload = preview(request)
        write_output(args.output, payload)
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
