"""The dispatcher: turn one reserved intent into at most one call.

Order of operations is the whole point of this module.

1. The intent is already persisted with its key before anything is sent.
2. The key is derived from the authorization, never from the attempt.
3. The returned call id is written to `attempts` before the state transition is appended,
   so a crash in between leaves a call we can still account for.
4. An unknown submission stops. It never mints a new key, and it never dials again.

`ARCHITECTURE.md` section 6 gives `RESERVED` exactly two exits: `SUBMITTED` and
`SUBMISSION_UNKNOWN`. A provider rejection therefore travels the ambiguity path and is
closed out as `RECONCILE_FAILED`, which records both facts in the audit trail: we could
not place this call, and a human now owns it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .escalate import apply
from .ledger import Ledger
from .models import Attempt, Event, Intent, IntentState, LadderEvent
from .policy import Policy, step_can_finish_before_cutoff
from .redact import mask_e164, redact_free_text
from .script import (
    RECIPIENT_RESULT_SCHEMA,
    SCHEMA_VERSION,
    TASK_VERSION,
    render_task_text,
)
from .transports.base import CallTransport, SubmitResult


class BudgetExceeded(RuntimeError):
    """Raised rather than placing a call beyond the operator's `--max-calls` ceiling."""


class LiveCallBudget:
    """A hard ceiling on real calls, counted across every path including reconciliation."""

    def __init__(self, max_calls: int | None) -> None:
        self.max_calls = max_calls
        self.spent = 0

    @property
    def unlimited(self) -> bool:
        return self.max_calls is None

    @property
    def remaining(self) -> int | None:
        return None if self.max_calls is None else max(0, self.max_calls - self.spent)

    def reserve(self) -> None:
        if self.max_calls is None:
            return
        if self.spent >= self.max_calls:
            raise BudgetExceeded(
                f"--max-calls {self.max_calls} reached; refusing to place another call"
            )
        self.spent += 1


@dataclass
class DispatchOutcome:
    intent_id: str
    action: str
    call_id: str | None = None
    detail: str | None = None


def build_metadata(intent: Intent) -> dict:
    """Caller-owned correlation keys, echoed back by CALL-E and verified on re-read."""
    return {
        "pc_event_id": intent.event_id,
        "pc_contact_id": intent.contact_id,
        "pc_intent_id": intent.intent_id,
        "pc_ladder_step": str(intent.ladder_step),
        "pc_target": intent.target.value,
        "pc_task_version": intent.task_version,
        "pc_schema_version": intent.schema_version,
    }


def dispatch_intent(
    ledger: Ledger,
    transport: CallTransport,
    event: Event,
    policy: Policy,
    intent: Intent,
    *,
    now: datetime,
    budget: LiveCallBudget | None = None,
    log: list[str] | None = None,
) -> DispatchOutcome:
    """Submit one reserved intent exactly once."""
    state = ledger.reconstruct(intent.intent_id)
    if state is IntentState.SUBMISSION_UNKNOWN:
        return reconcile_unknown_submission(
            ledger, transport, event, intent, policy=policy, now=now, budget=budget, log=log
        )
    if state is not IntentState.RESERVED:
        return DispatchOutcome(intent.intent_id, "skipped", detail=f"already {state.value}")

    existing = ledger.get_attempt(intent.intent_id)
    if existing is not None:
        # A call id exists but the transition did not land. Recover rather than resubmit.
        apply(
            ledger,
            intent,
            LadderEvent.CALL_ACCEPTED,
            "recovered_existing_call_binding",
            evidence_refs={"call_id": existing.call_id},
            at=now,
        )
        return DispatchOutcome(intent.intent_id, "skipped", existing.call_id, "binding recovered")

    if not step_can_finish_before_cutoff(now, event.field_visit_cutoff, policy):
        # The step was scheduled inside the window but the process only got here after the
        # deadline. Placing the call now would spend a slot on a result that arrives too
        # late to stop a truck, so leave it for `sweep_cutoff` to queue.
        return DispatchOutcome(
            intent.intent_id, "skipped", detail="past the field-visit cutoff; not dialled"
        )

    contact = ledger.get_contact(intent.contact_id)
    if contact is None:
        raise RuntimeError(f"intent {intent.intent_id} references an unknown contact")

    phone = contact.phone_for(intent.target)
    if phone is None:
        return _fail_to_human(
            ledger, intent, "no_number_for_target", f"no {intent.target.value} number on file",
            now=now,
        )
    if ledger.is_retired(intent.contact_id) and intent.target.value == "primary":
        return _fail_to_human(
            ledger, intent, "number_retired_for_event",
            "the primary number was retired after a wrong-number outcome", now=now,
        )

    task_text = render_task_text(
        event,
        first_name=contact.first_name,
        service_address_short=contact.service_address_short,
        locale=contact.locale,
        tz_name=contact.tz,
    )
    metadata = build_metadata(intent)

    if budget is not None:
        budget.reserve()

    if log is not None:
        log.append(
            f"submitting {intent.intent_id} step {intent.ladder_step} "
            f"{intent.target.value} to {mask_e164(phone)} key={intent.idempotency_key}"
        )

    result: SubmitResult = transport.submit(
        task_text=task_text,
        phone_e164=phone,
        locale=contact.locale,
        region="US",
        recipient_result_schema=RECIPIENT_RESULT_SCHEMA,
        idempotency_key=intent.idempotency_key,
        metadata=metadata,
    )

    if result.kind == "accepted" and result.call_id:
        # Persist the binding first. If the process dies on the next line, the call id is
        # already recorded and `dispatch_intent` recovers it above instead of redialling.
        ledger.bind_attempt(
            Attempt(intent_id=intent.intent_id, call_id=result.call_id, submitted_at=now)
        )
        apply(
            ledger,
            intent,
            LadderEvent.CALL_ACCEPTED,
            "call_submitted",
            evidence_refs={"call_id": result.call_id, "idempotency_key": intent.idempotency_key},
            at=now,
        )
        return DispatchOutcome(intent.intent_id, "submitted", result.call_id)

    if result.kind == "unknown":
        apply(
            ledger,
            intent,
            LadderEvent.SUBMISSION_AMBIGUOUS,
            f"submission_unknown:{result.error_code or 'no_code'}",
            evidence_refs={
                "reason": redact_free_text(result.reason),
                "idempotency_key": intent.idempotency_key,
            },
            at=now,
        )
        return DispatchOutcome(intent.intent_id, "unknown", detail=result.reason)

    return _fail_to_human(
        ledger,
        intent,
        f"submission_rejected:{result.error_code or 'no_code'}",
        result.reason or "provider rejected the submission",
        now=now,
    )


def _fail_to_human(
    ledger: Ledger, intent: Intent, reason_code: str, detail: str, *, now: datetime
) -> DispatchOutcome:
    """Close out a submission that will never become a call, via the ambiguity path."""
    # Provider error text is free text from outside the trust boundary, and the audit
    # trail is append-only, so anything unredacted written here is unredactable later.
    safe = redact_free_text(detail)
    apply(
        ledger,
        intent,
        LadderEvent.SUBMISSION_AMBIGUOUS,
        reason_code,
        evidence_refs={"detail": safe},
        at=now,
    )
    apply(
        ledger,
        intent,
        LadderEvent.RECONCILE_FAILED,
        "submission_cannot_become_a_call",
        evidence_refs={"detail": safe},
        at=now,
    )
    return DispatchOutcome(intent.intent_id, "rejected", detail=detail)


def reconcile_unknown_submission(
    ledger: Ledger,
    transport: CallTransport,
    event: Event,
    intent: Intent,
    *,
    policy: Policy,
    now: datetime,
    budget: LiveCallBudget | None = None,
    log: list[str] | None = None,
) -> DispatchOutcome:
    """Resolve a `SUBMISSION_UNKNOWN` intent without ever creating a second call.

    The reconciliation mechanism is the contract's own: replaying the same
    `Idempotency-Key` with the same request "returns the original call instead of creating
    a duplicate". So this replays the identical body under the identical key. If the
    original submission did land, we get that call back. If it never landed, exactly one
    call is placed for an authorization that has always been for exactly one call.

    A new key is never minted here, and the ladder never advances past an unknown.
    """
    contact = ledger.get_contact(intent.contact_id)
    if contact is None:
        raise RuntimeError(f"intent {intent.intent_id} references an unknown contact")
    phone = contact.phone_for(intent.target)
    if phone is None:
        apply(
            ledger, intent, LadderEvent.RECONCILE_FAILED, "no_number_for_target", at=now
        )
        return DispatchOutcome(intent.intent_id, "rejected", detail="no number for target")

    if not step_can_finish_before_cutoff(now, event.field_visit_cutoff, policy):
        # Replaying the key can create the call if the original never landed, so this path
        # dials for real and needs the same past-cutoff guard as a first submission.
        return DispatchOutcome(
            intent.intent_id, "skipped", detail="past the field-visit cutoff; not dialled"
        )

    if budget is not None:
        budget.reserve()

    if log is not None:
        log.append(
            f"reconciling {intent.intent_id} by replaying key={intent.idempotency_key} "
            "(no new key is ever minted)"
        )

    result = transport.submit(
        task_text=render_task_text(
            event,
            first_name=contact.first_name,
            service_address_short=contact.service_address_short,
            locale=contact.locale,
            tz_name=contact.tz,
        ),
        phone_e164=phone,
        locale=contact.locale,
        region="US",
        recipient_result_schema=RECIPIENT_RESULT_SCHEMA,
        idempotency_key=intent.idempotency_key,
        metadata=build_metadata(intent),
    )

    if result.kind == "accepted" and result.call_id:
        ledger.bind_attempt(
            Attempt(intent_id=intent.intent_id, call_id=result.call_id, submitted_at=now)
        )
        apply(
            ledger,
            intent,
            LadderEvent.RECONCILED,
            "reconciled_by_idempotent_replay",
            evidence_refs={"call_id": result.call_id},
            at=now,
        )
        return DispatchOutcome(intent.intent_id, "reconciled", result.call_id)

    if result.kind == "unknown":
        # Still unknown. Leave the state where it is; a human decides what happens next.
        return DispatchOutcome(
            intent.intent_id, "unknown", detail=result.reason or "still unresolved"
        )

    apply(
        ledger,
        intent,
        LadderEvent.RECONCILE_FAILED,
        f"reconcile_failed:{result.error_code or 'no_code'}",
        evidence_refs={"reason": redact_free_text(result.reason)},
        at=now,
    )
    return DispatchOutcome(intent.intent_id, "rejected", detail=result.reason)


def assert_task_versions_match(intent: Intent) -> None:
    """Guard against a task or schema edit changing the body behind a live key."""
    if intent.task_version != TASK_VERSION or intent.schema_version != SCHEMA_VERSION:
        raise RuntimeError(
            f"intent {intent.intent_id} was reserved under task {intent.task_version} / "
            f"schema {intent.schema_version}, but this build sends {TASK_VERSION} / "
            f"{SCHEMA_VERSION}. Reusing its key with a changed body would be an "
            "idempotency conflict. Finish this event on the build that started it."
        )
