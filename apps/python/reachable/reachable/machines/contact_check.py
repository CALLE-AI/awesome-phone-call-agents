"""The contact-check machine. Pure functions, no I/O.

One instance per (term, contact). Transitions are exactly those in
docs/STATE_MACHINE.md §1.3.

Everything here is a function of (current state, event, guard answers). Nothing
reads a clock, a database or a network, so every row of the transition table is
directly testable.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..models import ContactCheckState as S
from ..models import NoCallReason


class CCEvent(str, Enum):
    """What can happen to a contact-check case."""

    ADDED_TO_TERM_LIST = "added_to_term_list"
    RENDERED = "rendered"
    GUARD_REFUSED = "guard_refused"
    SUBMITTED = "submitted"
    SUBMISSION_UNKNOWN = "submission_unknown"
    RESULT_VERIFIED = "result_verified"
    RESULT_WRONG_PERSON = "result_wrong_person"
    RESULT_NOT_IN_SERVICE = "result_not_in_service"
    RESULT_NO_LONGER_CONTACT = "result_no_longer_contact"
    RESULT_UPDATE_REQUESTED = "result_update_requested"
    RESULT_NO_CONTACT = "result_no_contact"
    RESULT_NEEDS_HUMAN = "result_needs_human"
    RECONCILED_TERMINAL = "reconciled_terminal"
    RECONCILE_MISMATCH = "reconcile_mismatch"
    STAFF_RESOLVED = "staff_resolved"
    STAFF_CLOSED = "staff_closed"


@dataclass(frozen=True)
class CCContext:
    """Guard answers the machine needs. Supplied by the caller, never fetched."""

    attempts_remaining: bool = True
    refusal: NoCallReason | None = None
    #: Where staff routed a NEEDS_HUMAN case.
    staff_target: S | None = None


@dataclass(frozen=True)
class Transition:
    state: S
    reason: str
    #: True when this transition should write a contact-health flag.
    flags_contact: bool = False
    #: True when this transition should raise a staff task.
    raises_task: bool = False


class InvalidTransition(ValueError):
    """The event cannot occur in this state.

    Raised rather than ignored: a machine that silently absorbs an impossible
    event hides the bug that produced it.
    """


def _refusal_state(reason: NoCallReason | None) -> Transition:
    """A guard refusal. Holds leave the case where a retry can find it."""
    if reason in {NoCallReason.DRY_RUN, NoCallReason.AWAITING_CONFIRMATION}:
        return Transition(S.CC_READY, f"Not called: {reason.value}")
    if reason is NoCallReason.INVALID_DESTINATION:
        return Transition(
            S.CC_NOT_CALLED,
            "Not called: stored number is not valid E.164",
            flags_contact=True,
        )
    if reason is NoCallReason.LANGUAGE_NOT_SUPPORTED:
        return Transition(
            S.CC_NOT_CALLED,
            "Not called: language not supported on the UK line; staff task raised",
            raises_task=True,
        )
    if reason is NoCallReason.ATTEMPT_BUDGET_SPENT:
        return Transition(S.CC_UNREACHED, "Attempt budget spent without contact")
    if reason in {NoCallReason.OUTSIDE_CALLING_WINDOW, NoCallReason.NON_SCHOOL_DAY,
                  NoCallReason.CALL_IN_PROGRESS}:
        return Transition(S.CC_READY, f"Held: {reason.value}")
    if reason is NoCallReason.IDEMPOTENCY_KEY_USED:
        return Transition(S.CC_NEEDS_HUMAN, "Idempotency key already reserved")
    return Transition(S.CC_NOT_CALLED, f"Not called: {reason.value if reason else 'refused'}")


#: Terminal results that end the check outright.
_RESULT_MAP: dict[CCEvent, Transition] = {
    CCEvent.RESULT_VERIFIED: Transition(
        S.CC_VERIFIED, "Identity and willingness confirmed, quote bound", flags_contact=True
    ),
    CCEvent.RESULT_WRONG_PERSON: Transition(
        S.CC_WRONG_PERSON, "Not the named contact", flags_contact=True
    ),
    CCEvent.RESULT_NOT_IN_SERVICE: Transition(
        S.CC_NUMBER_NOT_WORKING, "Number not in service", flags_contact=True
    ),
    CCEvent.RESULT_NO_LONGER_CONTACT: Transition(
        S.CC_NO_LONGER_A_CONTACT, "Declines the contact role", flags_contact=True, raises_task=True
    ),
    CCEvent.RESULT_UPDATE_REQUESTED: Transition(
        S.CC_UPDATE_REQUESTED,
        "Update requested; office task raised, no number captured",
        flags_contact=True,
        raises_task=True,
    ),
    CCEvent.RESULT_NEEDS_HUMAN: Transition(
        S.CC_NEEDS_HUMAN, "Result not usable; routed to a person"
    ),
}


def step(state: S, event: CCEvent, context: CCContext | None = None) -> Transition:
    """Advance one contact-check case. Pure."""
    ctx = context or CCContext()

    if event is CCEvent.ADDED_TO_TERM_LIST:
        return Transition(S.CC_PENDING, "Added to this term's check list")

    if event is CCEvent.STAFF_CLOSED:
        return Transition(S.CC_NOT_CALLED, "Closed by staff")

    if event is CCEvent.GUARD_REFUSED:
        if state not in {S.CC_PENDING, S.CC_READY}:
            raise InvalidTransition(f"guard refusal is not meaningful in {state.value}")
        return _refusal_state(ctx.refusal)

    if state is S.CC_PENDING:
        if event is CCEvent.RENDERED:
            return Transition(S.CC_READY, "Contact check rendered and authorised")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.CC_READY:
        if event is CCEvent.SUBMITTED:
            return Transition(S.CC_IN_FLIGHT, "Submitted; idempotency key reserved")
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.CC_IN_FLIGHT:
        if event is CCEvent.SUBMISSION_UNKNOWN:
            return Transition(
                S.CC_UNVERIFIED, "Submission unknown; reconciling, not redialling"
            )
        if event is CCEvent.RESULT_NO_CONTACT:
            if ctx.attempts_remaining:
                return Transition(
                    S.CC_READY, "No contact; a further attempt may be authorised"
                )
            return Transition(
                S.CC_UNREACHED, "Attempt budget spent without contact", flags_contact=True
            )
        if event in _RESULT_MAP:
            return _RESULT_MAP[event]
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.CC_UNVERIFIED:
        if event is CCEvent.RECONCILED_TERMINAL:
            # Re-enter as though the terminal result had arrived normally.
            return Transition(S.CC_IN_FLIGHT, "Reconciled from GET /v1/calls")
        if event is CCEvent.RECONCILE_MISMATCH:
            return Transition(
                S.CC_NEEDS_HUMAN, "Snapshot fails the binding check"
            )
        raise InvalidTransition(f"{event.value} in {state.value}")

    if state is S.CC_NEEDS_HUMAN:
        if event is CCEvent.STAFF_RESOLVED:
            target = ctx.staff_target or S.CC_UNREACHED
            return Transition(target, f"Resolved by staff to {target.value}", flags_contact=True)
        raise InvalidTransition(f"{event.value} in {state.value}")

    raise InvalidTransition(f"{event.value} is not valid in terminal state {state.value}")
