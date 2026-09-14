"""Intake: webhooks are wake-ups, never evidence.

The receiver does four things and then stops: validate the envelope, insert one inbox row
under the event id, commit, respond. It appends no transition and reaches no conclusion,
because the contract publishes no authentication on the webhook path
(`docs/adapter-notes.md`, question 3).

A worker then claims each row, re-reads `GET /v1/calls/{call_id}`, checks that what came
back is bound to the intent we authorized, and only then lets the adjudicator run.

Duplicate deliveries add no rows. A conflicting payload under an event id we have already
seen is quarantined rather than overwriting the first one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from .adjudicate import Judge, adjudicate
from .escalate import advance_after_disposition, apply
from .ledger import Ledger, utcnow
from .models import Event, Intent, IntentState, LadderEvent
from .policy import Policy
from .script import SCHEMA_VERSION, TASK_VERSION
from .transports.base import CallTransport, TransportError

WEBHOOK_PATH = "/calle/webhook"
WEBHOOK_EVENT_ID_HEADER = "CALL-E-Event-Id"
KNOWN_EVENT_TYPES = frozenset(
    {"call.completed", "call.failed", "call.result_validation_failed"}
)


@dataclass
class IntakeOutcome:
    intent_id: str
    action: str
    detail: str | None = None


class WebhookReceiver:
    """Holds the ledger the FastAPI route writes into."""

    def __init__(self, ledger: Ledger) -> None:
        self.ledger = ledger


def build_router(receiver: WebhookReceiver) -> APIRouter:
    router = APIRouter()

    @router.post(WEBHOOK_PATH)
    async def receive(
        request: Request,
        calle_event_id: str | None = Header(default=None, alias=WEBHOOK_EVENT_ID_HEADER),
    ) -> JSONResponse:
        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "error": "invalid_json"}, status_code=400)
        if not isinstance(payload, dict):
            return JSONResponse({"ok": False, "error": "invalid_payload"}, status_code=400)

        body_event_id = payload.get("id")
        event_type = payload.get("type")
        data = payload.get("data")

        if not isinstance(body_event_id, str) or not body_event_id:
            return JSONResponse({"ok": False, "error": "missing_event_id"}, status_code=400)
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            return JSONResponse({"ok": False, "error": "missing_call_id"}, status_code=400)

        call_id = data["id"]

        # The header carries the event id and `data.id` carries the call id. Binding to
        # the wrong one would attach every callback to a call that does not exist, so a
        # header that disagrees with the body is quarantined rather than trusted.
        if calle_event_id is not None and calle_event_id != body_event_id:
            receiver.ledger.quarantine_webhook(
                body_event_id, call_id, payload,
                "CALL-E-Event-Id header does not match the payload event id",
            )
            return JSONResponse({"ok": False, "error": "event_id_mismatch"}, status_code=400)

        if event_type not in KNOWN_EVENT_TYPES:
            receiver.ledger.quarantine_webhook(
                body_event_id, call_id, payload, f"unknown webhook event type {event_type!r}"
            )
            return JSONResponse({"ok": False, "error": "unknown_event_type"}, status_code=400)

        status = receiver.ledger.record_webhook(body_event_id, call_id, payload)
        # Any 2xx is treated as delivered by CALL-E. A duplicate is a success, not an error.
        return JSONResponse({"ok": True, "status": status}, status_code=200)

    return router


# -- the worker -------------------------------------------------------------------


def verify_binding(intent: Intent, snapshot_call_id: str, metadata: dict) -> str | None:
    """Return a reason string when the re-read does not belong to this intent."""
    attempt_fields = {
        "pc_event_id": intent.event_id,
        "pc_contact_id": intent.contact_id,
        "pc_intent_id": intent.intent_id,
        "pc_ladder_step": str(intent.ladder_step),
        "pc_target": intent.target.value,
        "pc_task_version": intent.task_version,
        "pc_schema_version": intent.schema_version,
    }
    for key, expected in attempt_fields.items():
        actual = metadata.get(key)
        if actual is None:
            return f"re-read carried no {key}"
        if str(actual) != expected:
            return f"{key} was {actual!r}, expected {expected!r}"
    if intent.task_version != TASK_VERSION or intent.schema_version != SCHEMA_VERSION:
        return (
            f"intent was authorized under task {intent.task_version} / schema "
            f"{intent.schema_version}, this build runs {TASK_VERSION} / {SCHEMA_VERSION}"
        )
    return None


def handle_terminal_call(
    ledger: Ledger,
    transport: CallTransport,
    event: Event,
    policy: Policy,
    intent: Intent,
    *,
    now: datetime,
    judge_c: Judge | None = None,
) -> IntakeOutcome:
    """Re-read one call, verify the binding, adjudicate, and advance the ladder."""
    attempt = ledger.get_attempt(intent.intent_id)
    if attempt is None:
        return IntakeOutcome(intent.intent_id, "skipped", "no call bound to this intent")

    state = ledger.reconstruct(intent.intent_id)
    if state is IntentState.SUBMITTED:
        try:
            snapshot = transport.read(attempt.call_id)
        except TransportError as exc:
            return IntakeOutcome(intent.intent_id, "unreadable", str(exc))
        if not snapshot.is_terminal:
            return IntakeOutcome(intent.intent_id, "still_running", snapshot.status)
        apply(
            ledger,
            intent,
            LadderEvent.TERMINAL_OBSERVED,
            f"terminal_status_{snapshot.status}",
            evidence_refs={"call_id": attempt.call_id},
            at=now,
        )
        state = IntentState.TERMINAL_UNVERIFIED
    elif state is not IntentState.TERMINAL_UNVERIFIED:
        return IntakeOutcome(intent.intent_id, "skipped", f"state is {state.value}")

    # The authoritative re-read. Everything downstream runs on this, not on the webhook.
    try:
        snapshot = transport.read(attempt.call_id)
    except TransportError as exc:
        return IntakeOutcome(intent.intent_id, "unreadable", str(exc))

    if not snapshot.is_terminal:
        # The call went terminal between the two reads and back again, or the provider is
        # still finalising. Adjudicating a running call would turn a live conversation
        # into a NEEDS_HUMAN item. Wait for the next wake-up instead.
        return IntakeOutcome(intent.intent_id, "still_running", snapshot.status)

    if snapshot.call_id != attempt.call_id:
        apply(
            ledger, intent, LadderEvent.BINDING_MISMATCH,
            "binding_mismatch_call_id", at=now,
            evidence_refs={"expected": attempt.call_id, "received": snapshot.call_id},
        )
        return IntakeOutcome(intent.intent_id, "binding_mismatch", "call id did not match")

    mismatch = verify_binding(intent, snapshot.call_id, snapshot.metadata)
    if mismatch is not None:
        apply(
            ledger, intent, LadderEvent.BINDING_MISMATCH, "binding_mismatch",
            evidence_refs={"detail": mismatch}, at=now,
        )
        return IntakeOutcome(intent.intent_id, "binding_mismatch", mismatch)

    ledger.record_terminal_snapshot(intent.intent_id, snapshot.status, snapshot.raw)
    apply(
        ledger,
        intent,
        LadderEvent.BINDING_VERIFIED,
        "authoritative_re_read_bound_to_intent",
        evidence_refs={"call_id": snapshot.call_id, "status": snapshot.status},
        at=now,
    )

    contact = ledger.get_contact(intent.contact_id)
    locale = contact.locale if contact else "en-US"
    disposition = adjudicate(
        snapshot,
        intent_id=intent.intent_id,
        locale=locale,
        confidence_threshold=policy.confidence_threshold,
        judge_c=judge_c,
    )
    ledger.put_disposition(disposition)
    advance_after_disposition(
        ledger,
        event,
        policy,
        intent,
        disposition,
        now=now,
        task_version=TASK_VERSION,
        schema_version=SCHEMA_VERSION,
    )
    return IntakeOutcome(
        intent.intent_id, "adjudicated", f"{disposition.disposition.value}:{disposition.reason_code}"
    )


def process_inbox(
    ledger: Ledger,
    transport: CallTransport,
    event: Event,
    policy: Policy,
    *,
    now: datetime | None = None,
    judge_c: Judge | None = None,
) -> list[IntakeOutcome]:
    """Claim inbox rows and drive each one through an authenticated re-read."""
    moment = now or utcnow()
    outcomes: list[IntakeOutcome] = []
    for row in ledger.claim_unprocessed_webhooks():
        intent = ledger.get_intent_by_call_id(row["call_id"])
        if intent is None:
            ledger.quarantine_webhook(
                row["event_uid"],
                row["call_id"],
                row["payload"],
                "no intent in this ledger owns that call id",
            )
            outcomes.append(IntakeOutcome("-", "quarantined", row["call_id"]))
            continue
        outcome = handle_terminal_call(
            ledger, transport, event, policy, intent, now=moment, judge_c=judge_c
        )
        outcomes.append(outcome)
        if outcome.action in {"still_running", "unreadable"}:
            # Leave the row unprocessed. Marking it here would consume the only wake-up
            # this call gets and leave the intent stuck in SUBMITTED until the poller
            # happened to run.
            continue
        ledger.mark_webhook_processed(row["event_uid"], at=moment)
    return outcomes


def poll_pending(
    ledger: Ledger,
    transport: CallTransport,
    event: Event,
    policy: Policy,
    *,
    now: datetime | None = None,
    judge_c: Judge | None = None,
) -> list[IntakeOutcome]:
    """Poller fallback for environments with no public webhook URL.

    Reads every submitted-but-unresolved call. Safe to run alongside the webhook path:
    both funnel into `handle_terminal_call`, which is a no-op once an intent has moved on.
    """
    moment = now or utcnow()
    outcomes: list[IntakeOutcome] = []
    pending = ledger.list_intents(
        event.event_id, [IntentState.SUBMITTED, IntentState.TERMINAL_UNVERIFIED]
    )
    for intent in pending:
        outcomes.append(
            handle_terminal_call(
                ledger, transport, event, policy, intent, now=moment, judge_c=judge_c
            )
        )
    return outcomes
