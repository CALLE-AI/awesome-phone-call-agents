"""The state machine and the escalation engine.

The first half is a pure function: `transition(state, event) -> state`, backed by an
explicit table. Anything not in the table raises. Nothing else in the application is
allowed to invent a state change.

The second half is the engine that walks the ladder: it turns a disposition into the next
scheduled step, opens human review, and prepares field visits for a person to approve.

Two rules live here that are easy to lose:

- A `NEEDS_HUMAN` contact is still on the clock. Human review pauses automation, never the
  deadline. If nobody resolves it before the field-visit cutoff, it becomes
  `FIELD_VISIT_PENDING`.
- `wrong_number` and `refused` never redial, and `language_barrier` never redials
  automatically.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from .models import (
    ContactType,
    Disposition,
    DispositionKind,
    Event,
    Intent,
    IntentState,
    LadderEvent,
    LadderTarget,
    NeedsAssistance,
    WorkOrder,
    derive_idempotency_key,
    derive_intent_id,
)
from .policy import Policy, schedule_step, select_next_step, step_can_finish_before_cutoff

if TYPE_CHECKING:  # pragma: no cover - import cycle guard
    from .ledger import Ledger


class IllegalTransition(RuntimeError):
    """Raised when something asks for a state change the diagram does not allow."""


# The complete allowed-transition table. Every edge in ARCHITECTURE.md section 6 appears
# here exactly once, and nothing else does.
ALLOWED_TRANSITIONS: dict[tuple[IntentState, LadderEvent], IntentState] = {
    (IntentState.RESERVED, LadderEvent.CALL_ACCEPTED): IntentState.SUBMITTED,
    (IntentState.RESERVED, LadderEvent.SUBMISSION_AMBIGUOUS): IntentState.SUBMISSION_UNKNOWN,
    (IntentState.SUBMISSION_UNKNOWN, LadderEvent.RECONCILED): IntentState.SUBMITTED,
    (IntentState.SUBMISSION_UNKNOWN, LadderEvent.RECONCILE_FAILED): IntentState.NEEDS_HUMAN,
    (IntentState.SUBMITTED, LadderEvent.TERMINAL_OBSERVED): IntentState.TERMINAL_UNVERIFIED,
    (IntentState.TERMINAL_UNVERIFIED, LadderEvent.BINDING_VERIFIED): IntentState.ADJUDICATED,
    (IntentState.TERMINAL_UNVERIFIED, LadderEvent.BINDING_MISMATCH): IntentState.NEEDS_HUMAN,
    (IntentState.ADJUDICATED, LadderEvent.DISPOSITION_CONFIRMED): IntentState.CONFIRMED,
    (
        IntentState.ADJUDICATED,
        LadderEvent.DISPOSITION_UNCONFIRMED,
    ): IntentState.UNCONFIRMED_WAITING,
    (IntentState.ADJUDICATED, LadderEvent.DISPOSITION_NEEDS_HUMAN): IntentState.NEEDS_HUMAN,
    (IntentState.UNCONFIRMED_WAITING, LadderEvent.LADDER_ADVANCED): IntentState.RESERVED,
    (
        IntentState.UNCONFIRMED_WAITING,
        LadderEvent.LADDER_EXHAUSTED,
    ): IntentState.FIELD_VISIT_PENDING,
    (
        IntentState.UNCONFIRMED_WAITING,
        LadderEvent.CUTOFF_REACHED,
    ): IntentState.FIELD_VISIT_PENDING,
    (IntentState.NEEDS_HUMAN, LadderEvent.OPERATOR_CONFIRMED): IntentState.CONFIRMED,
    (IntentState.NEEDS_HUMAN, LadderEvent.CUTOFF_REACHED): IntentState.FIELD_VISIT_PENDING,
    (IntentState.NEEDS_HUMAN, LadderEvent.OPERATOR_REFUSED): IntentState.CLOSED_REFUSED,
    (
        IntentState.FIELD_VISIT_PENDING,
        LadderEvent.FIELD_VISIT_APPROVED,
    ): IntentState.FIELD_VISIT_ISSUED,
}

# Derived from the table above so the two can never drift apart.
ALLOWED_EDGES: frozenset[tuple[IntentState | None, IntentState]] = frozenset(
    {(None, IntentState.RESERVED)}
    | {(source, target) for (source, _), target in ALLOWED_TRANSITIONS.items()}
)


def transition(state: IntentState, event: LadderEvent) -> IntentState:
    """Pure state machine. Raises `IllegalTransition` for anything off the table."""
    try:
        return ALLOWED_TRANSITIONS[(state, event)]
    except KeyError as exc:
        raise IllegalTransition(
            f"{state.value} cannot handle {event.value}; "
            "no such edge in the escalation state machine"
        ) from exc


def replay_edge(state: IntentState | None, to_state: IntentState) -> IntentState:
    """Validate one recorded edge while replaying an audit trail."""
    if (state, to_state) not in ALLOWED_EDGES:
        raise IllegalTransition(
            f"recorded transition {state.value if state else 'start'} -> {to_state.value} "
            "is not an edge in the escalation state machine"
        )
    return to_state


def apply(
    ledger: "Ledger",
    intent: Intent,
    event: LadderEvent,
    reason_code: str,
    *,
    evidence_refs: dict | None = None,
    actor: str = "system",
    at: datetime | None = None,
) -> IntentState:
    """Run the pure transition, then append the audit row. Never one without the other."""
    current = ledger.reconstruct(intent.intent_id)
    next_state = transition(current, event)
    ledger.append_transition(
        intent.intent_id,
        current,
        next_state,
        reason_code,
        evidence_refs=evidence_refs,
        actor=actor,
        at=at,
    )
    return next_state


# -- the ladder -------------------------------------------------------------------


def build_intent(
    event: Event,
    contact_id: str,
    ladder_step: int,
    target: LadderTarget,
    *,
    not_before: datetime,
    task_version: str,
    schema_version: str,
    created_at: datetime,
) -> Intent:
    return Intent(
        intent_id=derive_intent_id(event.event_id, contact_id, ladder_step, target),
        event_id=event.event_id,
        contact_id=contact_id,
        ladder_step=ladder_step,
        target=target,
        idempotency_key=derive_idempotency_key(
            event.event_id, contact_id, ladder_step, target
        ),
        task_version=task_version,
        schema_version=schema_version,
        state=IntentState.RESERVED,
        not_before=not_before,
        created_at=created_at,
    )


def seed_first_step(
    ledger: "Ledger",
    event: Event,
    policy: Policy,
    contact_id: str,
    *,
    now: datetime,
    task_version: str,
    schema_version: str,
) -> Intent | None:
    """Reserve step 1 for a contact. Returns None when the ladder cannot start."""
    contact = ledger.get_contact(contact_id)
    if contact is None:
        return None
    first = policy.step(policy.ladder[0].step)
    assert first is not None
    not_before = schedule_step(first, after=now, tz_name=contact.tz, policy=policy)
    intent = build_intent(
        event,
        contact_id,
        first.step,
        first.target,
        not_before=not_before,
        task_version=task_version,
        schema_version=schema_version,
        created_at=now,
    )
    return ledger.reserve_intent(intent)


def _open_field_visit(
    ledger: "Ledger",
    event: Event,
    intent: Intent,
    reason_code: str,
    *,
    now: datetime,
) -> None:
    """Prepare a field visit. It is not dispatched until a person approves it."""
    ledger.create_work_order(
        WorkOrder(
            work_order_id=f"wo:{event.event_id}:{intent.contact_id}",
            contact_id=intent.contact_id,
            event_id=event.event_id,
            reason_code=reason_code,
            created_at=now,
        )
    )


def advance_after_disposition(
    ledger: "Ledger",
    event: Event,
    policy: Policy,
    intent: Intent,
    disposition: Disposition,
    *,
    now: datetime,
    task_version: str,
    schema_version: str,
) -> IntentState:
    """Move an adjudicated intent forward, and schedule the next ladder step if there is one."""
    if disposition.disposition is DispositionKind.CONFIRMED:
        return apply(
            ledger,
            intent,
            LadderEvent.DISPOSITION_CONFIRMED,
            disposition.reason_code,
            evidence_refs={"spans": len(disposition.evidence_spans)},
            at=now,
        )

    if disposition.disposition is DispositionKind.NEEDS_HUMAN:
        if disposition.contact_type is ContactType.WRONG_NUMBER:
            ledger.retire_number(intent.contact_id, "wrong_number_reported_on_call", at=now)
        state = apply(
            ledger,
            intent,
            LadderEvent.DISPOSITION_NEEDS_HUMAN,
            disposition.reason_code,
            evidence_refs={
                "contact_type": disposition.contact_type.value,
                "needs_assistance": disposition.needs_assistance.value,
                "priority": disposition.needs_assistance is NeedsAssistance.MEDICAL_QUESTION,
            },
            at=now,
        )
        # The ladder stops here, but the clock does not. `sweep_cutoff` will convert this
        # to FIELD_VISIT_PENDING if nobody resolves it in time.
        return state

    # UNCONFIRMED: the notice may have been left, but nobody confirmed hearing it.
    state = apply(
        ledger,
        intent,
        LadderEvent.DISPOSITION_UNCONFIRMED,
        disposition.reason_code,
        evidence_refs={"contact_type": disposition.contact_type.value},
        at=now,
    )
    return schedule_next_step(
        ledger,
        event,
        policy,
        intent,
        disposition.contact_type,
        now=now,
        task_version=task_version,
        schema_version=schema_version,
    )


def schedule_next_step(
    ledger: "Ledger",
    event: Event,
    policy: Policy,
    intent: Intent,
    last_contact_type: ContactType,
    *,
    now: datetime,
    task_version: str,
    schema_version: str,
) -> IntentState:
    """Pick the next ladder step, or send the contact to the field-visit queue."""
    contact = ledger.get_contact(intent.contact_id)
    assert contact is not None

    if ledger.count_calls_for_contact(intent.contact_id) >= policy.max_calls_per_contact:
        return _exhaust(ledger, event, intent, "max_calls_per_contact_reached", now=now)

    has_alternate = contact.alt_phone_e164 is not None and not ledger.is_retired(
        intent.contact_id
    )
    next_step = select_next_step(
        policy,
        current_step=intent.ladder_step,
        last_contact_type=last_contact_type,
        has_alternate=has_alternate,
    )
    if next_step is None:
        return _exhaust(ledger, event, intent, "ladder_exhausted", now=now)

    not_before = schedule_step(next_step, after=now, tz_name=contact.tz, policy=policy)
    if not step_can_finish_before_cutoff(not_before, event.field_visit_cutoff, policy):
        # Deliberately skip straight to the truck rather than start a call that cannot
        # be adjudicated in time.
        return _cutoff(ledger, event, intent, "next_step_cannot_finish_before_cutoff", now=now)

    successor = build_intent(
        event,
        intent.contact_id,
        next_step.step,
        next_step.target,
        not_before=not_before,
        task_version=task_version,
        schema_version=schema_version,
        created_at=now,
    )
    ledger.reserve_intent(
        successor,
        opening_from_state=IntentState.UNCONFIRMED_WAITING,
        reason_code="ladder_advanced",
        evidence_refs={
            "previous_intent_id": intent.intent_id,
            "previous_contact_type": last_contact_type.value,
            "ladder_step": next_step.step,
            "target": next_step.target.value,
        },
    )
    return IntentState.UNCONFIRMED_WAITING


def _exhaust(
    ledger: "Ledger", event: Event, intent: Intent, reason_code: str, *, now: datetime
) -> IntentState:
    state = apply(ledger, intent, LadderEvent.LADDER_EXHAUSTED, reason_code, at=now)
    _open_field_visit(ledger, event, intent, reason_code, now=now)
    return state


def _cutoff(
    ledger: "Ledger", event: Event, intent: Intent, reason_code: str, *, now: datetime
) -> IntentState:
    state = apply(ledger, intent, LadderEvent.CUTOFF_REACHED, reason_code, at=now)
    _open_field_visit(ledger, event, intent, reason_code, now=now)
    return state


def sweep_cutoff(ledger: "Ledger", event: Event, policy: Policy, *, now: datetime) -> list[str]:
    """Convert anything still open at the field-visit cutoff into a pending field visit.

    This is what keeps `NEEDS_HUMAN` on the clock: an unresolved review item becomes a
    truck roll at the deadline whether or not a person got to it.
    """
    if now < event.field_visit_cutoff:
        return []
    moved: list[str] = []
    open_states = [IntentState.NEEDS_HUMAN, IntentState.UNCONFIRMED_WAITING]
    for intent in ledger.list_intents(event.event_id, open_states):
        # A contact whose later ladder step is already running is not stranded.
        if _has_live_successor(ledger, intent):
            continue
        apply(
            ledger,
            intent,
            LadderEvent.CUTOFF_REACHED,
            "field_visit_cutoff_reached_while_open",
            at=now,
        )
        _open_field_visit(
            ledger, event, intent, "field_visit_cutoff_reached_while_open", now=now
        )
        moved.append(intent.intent_id)
    return moved


def _has_live_successor(ledger: "Ledger", intent: Intent) -> bool:
    for candidate in ledger.list_intents_for_contact(intent.contact_id):
        if candidate.ladder_step > intent.ladder_step and candidate.state not in {
            IntentState.UNCONFIRMED_WAITING,
        }:
            return True
    return False


# -- operator actions -------------------------------------------------------------


class OperatorError(RuntimeError):
    """Raised when an operator action is missing the evidence the audit trail requires."""


def operator_confirm(
    ledger: "Ledger",
    intent: Intent,
    *,
    actor: str,
    evidence_text: str,
    now: datetime,
) -> IntentState:
    """Record a human confirmation. The operator must supply evidence, not just a click."""
    if not actor.strip():
        raise OperatorError("an operator confirmation must record who made it")
    if not evidence_text.strip():
        raise OperatorError(
            "an operator confirmation must cite a transcript span or a typed reason"
        )
    return apply(
        ledger,
        intent,
        LadderEvent.OPERATOR_CONFIRMED,
        "operator_confirmed_with_evidence",
        evidence_refs={"operator_evidence": evidence_text.strip()},
        actor=actor,
        at=now,
    )


def operator_refuse(
    ledger: "Ledger",
    intent: Intent,
    *,
    actor: str,
    evidence_text: str,
    now: datetime,
) -> IntentState:
    if not actor.strip():
        raise OperatorError("recording a refusal must record who recorded it")
    if not evidence_text.strip():
        raise OperatorError("recording a refusal must cite what the customer said")
    return apply(
        ledger,
        intent,
        LadderEvent.OPERATOR_REFUSED,
        "operator_recorded_refusal",
        evidence_refs={"operator_evidence": evidence_text.strip()},
        actor=actor,
        at=now,
    )


def approve_field_visit(
    ledger: "Ledger",
    event: Event,
    work_order_id: str,
    *,
    actor: str,
    now: datetime,
) -> list[str]:
    """Approve one prepared field visit. The system prepares; a person dispatches."""
    if not actor.strip():
        raise OperatorError("a field visit must record who approved it")
    orders = {order.work_order_id: order for order in ledger.list_work_orders(event.event_id)}
    order = orders.get(work_order_id)
    if order is None:
        raise OperatorError(f"no prepared field visit named {work_order_id}")
    ledger.approve_work_order(work_order_id, actor, at=now)
    issued: list[str] = []
    for intent in ledger.list_intents_for_contact(order.contact_id):
        if ledger.reconstruct(intent.intent_id) is IntentState.FIELD_VISIT_PENDING:
            apply(
                ledger,
                intent,
                LadderEvent.FIELD_VISIT_APPROVED,
                "field_visit_approved_by_operator",
                evidence_refs={"work_order_id": work_order_id},
                actor=actor,
                at=now,
            )
            issued.append(intent.intent_id)
    return issued
