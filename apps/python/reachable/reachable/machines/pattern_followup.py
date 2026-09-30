"""The pattern follow-up machine, including the contact cascade. No I/O.

One instance per (trigger date, pupil). Transitions are exactly those in
docs/STATE_MACHINE.md §2.3.

Two rules dominate everything else here:

* **URGENT_HUMAN is evaluated first**, before reason, support, or anything else.
  A call that produces both a reason *and* a sign the contact did not know about
  the absence is an escalation, not a reason.
* **The cascade advances on failure and stops on success.** A wrong person or a
  dead number flags that contact and moves to the next; one confirmed
  conversation ends the cascade.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..models import NoCallReason
from ..models import PatternState as S


class PFEvent(str, Enum):
    TRIGGER_DETECTED = "trigger_detected"
    SCREENING_STARTED = "screening_started"
    SCREENING_REFUSED = "screening_refused"
    CONTACT_SELECTED = "contact_selected"
    CONTACT_UNUSABLE = "contact_unusable"
    GUARD_REFUSED = "guard_refused"
    SUBMITTED = "submitted"
    SUBMISSION_UNKNOWN = "submission_unknown"
    RESULT_URGENT = "result_urgent"
    RESULT_REASON_GIVEN = "result_reason_given"
    RESULT_SUPPORT_REQUESTED = "result_support_requested"
    RESULT_NO_CONTACT = "result_no_contact"
    RESULT_WRONG_PERSON = "result_wrong_person"
    RESULT_NOT_IN_SERVICE = "result_not_in_service"
    RESULT_NEEDS_HUMAN = "result_needs_human"
    RECONCILED_TERMINAL = "reconciled_terminal"
    RECONCILE_MISMATCH = "reconcile_mismatch"
    CASCADE_NEXT = "cascade_next"
    STAFF_RESOLVED = "staff_resolved"
    STAFF_CLOSED = "staff_closed"


@dataclass(frozen=True)
class PFContext:
    """Guard answers supplied by the caller. The machine fetches nothing."""

    has_next_contact: bool = False
    cascade_limit_reached: bool = False
    refusal: NoCallReason | None = None
    staff_target: S | None = None


@dataclass(frozen=True)
class Transition:
    state: S
    reason: str
    flags_contact: bool = False
    raises_task: bool = False
    urgent: bool = False


class InvalidTransition(ValueError):
    """The event cannot occur in this state."""


def _screening_refusal(reason: NoCallReason | None) -> Transition:
    if reason is NoCallReason.PUPIL_VULNERABLE:
        return Transition(
            S.PF_NOT_CALLED,
            "Not calling: pupil flagged vulnerable - staff task created",
            raises_task=True,
        )
    if reason is NoCallReason.NO_FIRST_DAY_PROCESS:
        return Transition(
            S.PF_NOT_CALLED,
            "Not calling: no first-day process configured, so pattern follow-up is disabled",
        )
    if reason is NoCallReason.REASON_NOW_RECORDED:
        return Transition(S.PF_NOT_CALLED, "Not calling: a reason was recorded since the trigger")
    if reason is NoCallReason.OPEN_CASE_EXISTS:
        return Transition(S.PF_NOT_CALLED, "Not calling: an open staff case already exists")
    if reason in {NoCallReason.NON_SCHOOL_DAY, NoCallReason.OUTSIDE_CALLING_WINDOW}:
        # A hold: the case stays screening and is re-evaluated next cycle.
        return Transition(S.PF_SCREENING, f"Held: {reason.value}")
    return Transition(S.PF_NOT_CALLED, f"Not calling: {reason.value if reason else 'refused'}")


def _dial_refusal(reason: NoCallReason | None) -> Transition:
    if reason in {NoCallReason.DRY_RUN, NoCallReason.AWAITING_CONFIRMATION}:
        return Transition(S.PF_CASCADE_READY, f"Not called: {reason.value}")
    if reason in {
        NoCallReason.OUTSIDE_CALLING_WINDOW,
        NoCallReason.NON_SCHOOL_DAY,
        NoCallReason.CALL_IN_PROGRESS,
    }:
        return Transition(S.PF_CASCADE_READY, f"Held: {reason.value}")
    if reason is NoCallReason.PUPIL_VULNERABLE:
        return Transition(
            S.PF_NOT_CALLED,
            "Not calling: pupil flagged vulnerable - staff task created",
            raises_task=True,
        )
    if reason in {NoCallReason.INVALID_DESTINATION, NoCallReason.LANGUAGE_NOT_SUPPORTED}:
        # Skips this contact, not the case: the cascade advances.
        return Transition(
            S.PF_CASCADE_ADVANCE,
            f"Contact skipped: {reason.value}",
            flags_contact=True,
            raises_task=reason is NoCallReason.LANGUAGE_NOT_SUPPORTED,
        )
    if reason is NoCallReason.ATTEMPT_BUDGET_SPENT:
        return Transition(S.PF_CASCADE_ADVANCE, "Attempt budget spent for this contact")
    if reason is NoCallReason.IDEMPOTENCY_KEY_USED:
        return Transition(S.PF_NEEDS_HUMAN, "Idempotency key already reserved")
    return Transition(S.PF_NOT_CALLED, f"Not calling: {reason.value if reason else 'refused'}")


def step(state: S, event: PFEvent, context: PFContext | None = None) -> Transition:
    """Advance one pattern follow-up case. Pure."""
    ctx = context or PFContext()

    if event is PFEvent.TRIGGER_DETECTED:
        return Transition(S.PF_TRIGGERED, "Trigger: consecutive unexplained sessions")

    if event is PFEvent.STAFF_CLOSED:
        return Transition(S.PF_NOT_CALLED, "Closed by staff")

    # Evaluated before every other result: this is the rule the product exists
    # for, and it must not be reachable only after other branches have run.
    if event is PFEvent.RESULT_URGENT:
        if state not in {S.PF_CALL_IN_FLIGHT, S.PF_CALL_UNVERIFIED, S.PF_NEEDS_HUMAN}:
            raise InvalidTransition(f"{event.value} in {state.value}")
        return Transition(
            S.PF_URGENT_HUMAN,
            "Contact may not know about the absence, or does not know where the pupil is",
            raises_task=True,
            urgent=True,
        )

    if state is S.PF_TRIGGERED:
        if event is PFEvent.SCREENING_STARTED:
            return Transition(S.PF_SCREENING, "Screening gates")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_SCREENING:
        if event is PFEvent.SCREENING_REFUSED:
            return _screening_refusal(ctx.refusal)
        if event is PFEvent.CONTACT_SELECTED:
            return Transition(S.PF_CASCADE_READY, "Contact selected in the school's order")
        if event is PFEvent.CASCADE_NEXT:
            # No callable contact at all.
            return Transition(S.PF_UNREACHED, "No callable contact for this pupil")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_CASCADE_READY:
        if event is PFEvent.SUBMITTED:
            return Transition(S.PF_CALL_IN_FLIGHT, "Submitted; idempotency key reserved")
        if event is PFEvent.GUARD_REFUSED:
            return _dial_refusal(ctx.refusal)
        if event is PFEvent.CONTACT_UNUSABLE:
            return Transition(
                S.PF_CASCADE_ADVANCE,
                "Contact skipped; flagged in contact health",
                flags_contact=True,
            )
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_CALL_IN_FLIGHT:
        if event is PFEvent.SUBMISSION_UNKNOWN:
            return Transition(
                S.PF_CALL_UNVERIFIED, "Submission unknown; reconciling, not redialling"
            )
        if event is PFEvent.RESULT_REASON_GIVEN:
            return Transition(
                S.PF_REASON_GIVEN, "Reason category captured; suggestion awaiting staff approval"
            )
        if event is PFEvent.RESULT_SUPPORT_REQUESTED:
            return Transition(
                S.PF_SUPPORT_REQUESTED, "Support requested", raises_task=True
            )
        if event is PFEvent.RESULT_WRONG_PERSON:
            return Transition(
                S.PF_CASCADE_ADVANCE,
                "Wrong person; contact flagged, cascade advances",
                flags_contact=True,
            )
        if event is PFEvent.RESULT_NOT_IN_SERVICE:
            return Transition(
                S.PF_CASCADE_ADVANCE,
                "Number not in service; contact flagged, cascade advances",
                flags_contact=True,
            )
        if event is PFEvent.RESULT_NO_CONTACT:
            return Transition(S.PF_CASCADE_ADVANCE, "No contact; cascade advances")
        if event is PFEvent.RESULT_NEEDS_HUMAN:
            return Transition(S.PF_NEEDS_HUMAN, "Result not usable; routed to a person")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_CALL_UNVERIFIED:
        if event is PFEvent.RECONCILED_TERMINAL:
            return Transition(S.PF_CALL_IN_FLIGHT, "Reconciled from GET /v1/calls")
        if event is PFEvent.RECONCILE_MISMATCH:
            return Transition(S.PF_NEEDS_HUMAN, "Snapshot fails the binding check")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_CASCADE_ADVANCE:
        if event is PFEvent.CASCADE_NEXT:
            if ctx.has_next_contact and not ctx.cascade_limit_reached:
                return Transition(S.PF_CASCADE_READY, "Next contact in the school's order")
            reason = (
                "Cascade limit reached; no further contacts will be tried"
                if ctx.cascade_limit_reached
                else "Cascade exhausted; no contact reachable for this pupil"
            )
            # Every contact unreachable is itself a finding a safeguarding lead
            # needs, so this raises a task rather than closing quietly.
            return Transition(S.PF_UNREACHED, reason, raises_task=True)
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_NEEDS_HUMAN:
        if event is PFEvent.STAFF_RESOLVED:
            target = ctx.staff_target or S.PF_NOT_CALLED
            return Transition(target, f"Resolved by staff to {target.value}")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.PF_URGENT_HUMAN:
        if event is PFEvent.STAFF_RESOLVED:
            # Only a named member of staff closes an escalation, and closing is
            # itself audited.
            target = ctx.staff_target or S.PF_NOT_CALLED
            return Transition(target, f"Escalation closed by staff to {target.value}")
        raise InvalidTransition(f"{event.value} in {state.value}")

    raise InvalidTransition(f"{event.value} is not valid in terminal state {state.value}")
