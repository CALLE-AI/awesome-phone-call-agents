"""Operator-approved CALL-E calls to an allowlisted support provider.

The provider call asks about general outage-support availability. It never carries a
resident name, phone number, address, condition, product name, prescription number, or
equipment model. A person selects the provider and authorizes exactly one call.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .dispatch import LiveCallBudget
from .ledger import Ledger, LedgerError
from .models import (
    Event,
    SupportCategory,
    SupportProvider,
    SupportRequest,
    SupportRequestState,
    YesNoUnknown,
)
from .redact import redact_free_text
from .transports.base import CallTransport, TransportError

AVAILABILITY_VALUES = frozenset({"yes", "no", "unknown"})
RESPONSE_WINDOW_MAX_LENGTH = 80
PUBLIC_INSTRUCTIONS_MAX_LENGTH = 200

PROVIDER_RESULT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["availability", "response_window", "public_instructions"],
    "properties": {
        "availability": {
            "type": "string",
            "enum": sorted(AVAILABILITY_VALUES),
            "description": (
                "Whether this provider can accept a general outage-support referral "
                "in the requested category: yes, no, or unknown."
            ),
        },
        "response_window": {
            "type": "string",
            "description": (
                "A broad public response window, at most 80 characters. Do not include "
                "a resident name, phone number, account, prescription, or clinical detail."
            ),
        },
        "public_instructions": {
            "type": "string",
            "description": (
                "Public next-step instructions, at most 200 characters. Do not request "
                "or include resident or clinical information."
            ),
        },
    },
}

CATEGORY_LABELS = {
    SupportCategory.PRESCRIPTION_ACCESS: "prescription access",
    SupportCategory.POWERED_EQUIPMENT: "powered-equipment outage support",
    SupportCategory.OTHER_CRITICAL_SUPPLY: "another critical-supply need",
    SupportCategory.UNKNOWN: "general outage support",
}


class SupportError(RuntimeError):
    """Raised when a provider call would cross an authorization or safety boundary."""


@dataclass(frozen=True)
class SupportDispatchOutcome:
    request_id: str
    action: str
    call_id: str | None = None
    detail: str | None = None


def render_provider_task(
    event: Event, provider: SupportProvider, request: SupportRequest
) -> str:
    category = CATEGORY_LABELS[request.category]
    return f"""This is an automated coordination call from {event.utility_name}. This call may be recorded. We are checking general support availability during a possible Public Safety Power Shutoff.

Are you an authorized representative of {provider.name}? Can your organization accept a general referral for {category}, with support requested {request.urgency.value.replace('_', ' ')}?

Please give only your general availability, a broad response window, and public instructions an operator may relay. Do not ask for or record a resident name, phone number, address, account number, diagnosis, medicine name, dose, prescription number, or equipment model. This call does not place an order or reserve an item. If a person-specific discussion is required, say so and the utility operator will handle it separately.

We will never ask for payment or credentials on this call."""


def validate_provider_result(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise SupportError("provider result must be an object")
    expected = set(PROVIDER_RESULT_SCHEMA["properties"])
    if set(payload) != expected:
        missing = sorted(expected - set(payload))
        extra = sorted(set(payload) - expected)
        detail = []
        if missing:
            detail.append(f"missing: {', '.join(missing)}")
        if extra:
            detail.append(f"unexpected: {', '.join(extra)}")
        raise SupportError("provider result schema mismatch (" + "; ".join(detail) + ")")
    if not isinstance(payload["availability"], str):
        raise SupportError("provider availability must be a string")
    if payload["availability"] not in AVAILABILITY_VALUES:
        raise SupportError("provider availability must be yes, no, or unknown")
    for name, limit in (
        ("response_window", RESPONSE_WINDOW_MAX_LENGTH),
        ("public_instructions", PUBLIC_INSTRUCTIONS_MAX_LENGTH),
    ):
        value = payload[name]
        if not isinstance(value, str):
            raise SupportError(f"provider field {name} must be a string")
        if len(value) > limit:
            raise SupportError(f"provider field {name} exceeds {limit} characters")
    return {
        "availability": payload["availability"],
        "response_window": redact_free_text(payload["response_window"]) or "",
        "public_instructions": redact_free_text(payload["public_instructions"]) or "",
    }


def _provider(event: Event, provider_id: str) -> SupportProvider:
    providers = {item.provider_id: item for item in event.support_providers}
    try:
        return providers[provider_id]
    except KeyError as exc:
        raise SupportError("select an approved provider from this event") from exc


def _idempotency_key(request: SupportRequest, provider: SupportProvider) -> str:
    key = f"pc:support:{request.request_id}:{provider.provider_id}"
    if len(key) > 255:
        raise SupportError("support request id is too long for a CALL-E idempotency key")
    return key


def authorize_provider_call(
    ledger: Ledger,
    transport: CallTransport,
    event: Event,
    request_id: str,
    *,
    provider_id: str,
    actor: str,
    now: datetime,
    budget: LiveCallBudget | None = None,
    live_mode: bool = False,
) -> SupportDispatchOutcome:
    request = ledger.get_support_request(request_id)
    if request is None:
        raise SupportError(f"unknown support request {request_id}")
    if request.state is not SupportRequestState.PENDING_REVIEW:
        return SupportDispatchOutcome(
            request_id,
            "skipped",
            request.call_id,
            f"request is already {request.state.value}",
        )
    if request.consent is not YesNoUnknown.YES:
        raise SupportError("the resident did not give permission for a provider call")

    provider = _provider(event, provider_id)
    if live_mode and provider.demo_only:
        raise SupportError("demo-only providers cannot be called in live mode")
    key = _idempotency_key(request, provider)
    try:
        request = ledger.authorize_support_request(
            request_id,
            provider_id=provider.provider_id,
            actor=actor,
            idempotency_key=key,
            at=now,
        )
    except LedgerError as exc:
        raise SupportError(str(exc)) from exc

    if budget is not None:
        budget.reserve()
    result = transport.submit(
        task_text=render_provider_task(event, provider, request),
        phone_e164=provider.phone_e164,
        locale=provider.locale,
        region=provider.region,
        recipient_result_schema=PROVIDER_RESULT_SCHEMA,
        idempotency_key=key,
        metadata={
            "pc_contact_id": f"provider-{provider.provider_id}",
            "pc_ladder_step": "1",
            "pc_workflow": "support-availability",
            "pc_provider_id": provider.provider_id,
        },
    )
    if result.kind == "accepted" and result.call_id:
        ledger.record_support_submission(
            request_id,
            state=SupportRequestState.SUBMITTED,
            call_id=result.call_id,
            at=now,
        )
        return SupportDispatchOutcome(request_id, "submitted", result.call_id)
    if result.kind == "unknown":
        ledger.record_support_submission(
            request_id,
            state=SupportRequestState.SUBMISSION_UNKNOWN,
            result={"reason": redact_free_text(result.reason) or "submission outcome unknown"},
            at=now,
        )
        return SupportDispatchOutcome(request_id, "unknown", detail=result.reason)
    ledger.record_support_submission(
        request_id,
        state=SupportRequestState.NEEDS_HUMAN,
        result={"reason": redact_free_text(result.reason) or "provider rejected the call"},
        at=now,
    )
    return SupportDispatchOutcome(request_id, "rejected", detail=result.reason)


def poll_support_requests(
    ledger: Ledger, transport: CallTransport, event: Event, *, now: datetime
) -> list[SupportDispatchOutcome]:
    outcomes: list[SupportDispatchOutcome] = []
    for request in ledger.list_support_requests(event.event_id):
        if request.state is not SupportRequestState.SUBMITTED:
            continue
        if not request.call_id:
            ledger.record_support_submission(
                request.request_id,
                state=SupportRequestState.NEEDS_HUMAN,
                result={"reason": "submitted provider call has no call id"},
                at=now,
            )
            outcomes.append(
                SupportDispatchOutcome(request.request_id, "needs_human", detail="missing call id")
            )
            continue
        try:
            snapshot = transport.read(request.call_id)
        except TransportError as exc:
            outcomes.append(
                SupportDispatchOutcome(request.request_id, "waiting", request.call_id, str(exc))
            )
            continue
        if not snapshot.is_terminal:
            outcomes.append(
                SupportDispatchOutcome(request.request_id, "waiting", request.call_id)
            )
            continue
        if snapshot.status != "completed":
            ledger.record_support_submission(
                request.request_id,
                state=SupportRequestState.NEEDS_HUMAN,
                result={"reason": f"provider call ended {snapshot.status}"},
                at=now,
            )
            outcomes.append(
                SupportDispatchOutcome(
                    request.request_id, "needs_human", request.call_id, snapshot.status
                )
            )
            continue
        try:
            safe_result = validate_provider_result(snapshot.recipient_result)
        except SupportError as exc:
            ledger.record_support_submission(
                request.request_id,
                state=SupportRequestState.NEEDS_HUMAN,
                result={"reason": str(exc)},
                at=now,
            )
            outcomes.append(
                SupportDispatchOutcome(
                    request.request_id, "needs_human", request.call_id, str(exc)
                )
            )
            continue
        ledger.record_support_submission(
            request.request_id,
            state=SupportRequestState.COMPLETED,
            result=safe_result,
            at=now,
        )
        outcomes.append(
            SupportDispatchOutcome(request.request_id, "completed", request.call_id)
        )
    return outcomes
