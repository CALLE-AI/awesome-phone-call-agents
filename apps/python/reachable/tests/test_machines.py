"""Table-driven walks of both state machines.

Every row corresponds to a transition in docs/STATE_MACHINE.md. The machines are
pure, so these tests need no store, no clock and no network.
"""

from __future__ import annotations

import pytest

from reachable.machines import contact_check as cc
from reachable.machines import pattern_followup as pf
from reachable.models import ContactCheckState as S
from reachable.models import NoCallReason
from reachable.models import PatternState as P

# --------------------------------------------------------------- contact check

CC_TABLE = [
    ("added to term list", S.CC_PENDING, cc.CCEvent.ADDED_TO_TERM_LIST, cc.CCContext(), S.CC_PENDING),
    ("pending -> ready", S.CC_PENDING, cc.CCEvent.RENDERED, cc.CCContext(), S.CC_READY),
    ("ready -> in flight", S.CC_READY, cc.CCEvent.SUBMITTED, cc.CCContext(), S.CC_IN_FLIGHT),
    (
        "in flight -> verified",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_VERIFIED, cc.CCContext(), S.CC_VERIFIED,
    ),
    (
        "in flight -> wrong person",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_WRONG_PERSON, cc.CCContext(), S.CC_WRONG_PERSON,
    ),
    (
        "in flight -> number not working",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_NOT_IN_SERVICE, cc.CCContext(), S.CC_NUMBER_NOT_WORKING,
    ),
    (
        "in flight -> no longer a contact",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_NO_LONGER_CONTACT, cc.CCContext(),
        S.CC_NO_LONGER_A_CONTACT,
    ),
    (
        "in flight -> update requested",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_UPDATE_REQUESTED, cc.CCContext(), S.CC_UPDATE_REQUESTED,
    ),
    (
        "no contact with budget left returns to ready",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_NO_CONTACT, cc.CCContext(attempts_remaining=True),
        S.CC_READY,
    ),
    (
        "no contact with budget spent is unreached",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_NO_CONTACT, cc.CCContext(attempts_remaining=False),
        S.CC_UNREACHED,
    ),
    (
        "in flight -> needs human",
        S.CC_IN_FLIGHT, cc.CCEvent.RESULT_NEEDS_HUMAN, cc.CCContext(), S.CC_NEEDS_HUMAN,
    ),
    (
        "submission unknown -> unverified",
        S.CC_IN_FLIGHT, cc.CCEvent.SUBMISSION_UNKNOWN, cc.CCContext(), S.CC_UNVERIFIED,
    ),
    (
        "unverified reconciles back to in flight",
        S.CC_UNVERIFIED, cc.CCEvent.RECONCILED_TERMINAL, cc.CCContext(), S.CC_IN_FLIGHT,
    ),
    (
        "unverified with a binding mismatch needs a human",
        S.CC_UNVERIFIED, cc.CCEvent.RECONCILE_MISMATCH, cc.CCContext(), S.CC_NEEDS_HUMAN,
    ),
    (
        "staff resolve a needs-human case",
        S.CC_NEEDS_HUMAN, cc.CCEvent.STAFF_RESOLVED, cc.CCContext(staff_target=S.CC_WRONG_PERSON),
        S.CC_WRONG_PERSON,
    ),
    (
        "dry run holds at ready",
        S.CC_READY, cc.CCEvent.GUARD_REFUSED, cc.CCContext(refusal=NoCallReason.DRY_RUN),
        S.CC_READY,
    ),
    (
        "invalid destination is terminal",
        S.CC_PENDING, cc.CCEvent.GUARD_REFUSED,
        cc.CCContext(refusal=NoCallReason.INVALID_DESTINATION), S.CC_NOT_CALLED,
    ),
    (
        "unsupported language is terminal and raises a task",
        S.CC_PENDING, cc.CCEvent.GUARD_REFUSED,
        cc.CCContext(refusal=NoCallReason.LANGUAGE_NOT_SUPPORTED), S.CC_NOT_CALLED,
    ),
    (
        "budget spent at the guard is unreached",
        S.CC_READY, cc.CCEvent.GUARD_REFUSED,
        cc.CCContext(refusal=NoCallReason.ATTEMPT_BUDGET_SPENT), S.CC_UNREACHED,
    ),
    (
        "key already reserved needs a human",
        S.CC_READY, cc.CCEvent.GUARD_REFUSED,
        cc.CCContext(refusal=NoCallReason.IDEMPOTENCY_KEY_USED), S.CC_NEEDS_HUMAN,
    ),
]


@pytest.mark.parametrize(
    ("label", "state", "event", "context", "expected"), CC_TABLE, ids=[r[0] for r in CC_TABLE]
)
def test_contact_check_transitions(label, state, event, context, expected):
    assert cc.step(state, event, context).state is expected, label


def test_contact_check_flags_the_contact_on_every_health_changing_result():
    for event in (
        cc.CCEvent.RESULT_VERIFIED,
        cc.CCEvent.RESULT_WRONG_PERSON,
        cc.CCEvent.RESULT_NOT_IN_SERVICE,
        cc.CCEvent.RESULT_UPDATE_REQUESTED,
        cc.CCEvent.RESULT_NO_LONGER_CONTACT,
    ):
        assert cc.step(S.CC_IN_FLIGHT, event).flags_contact, event


def test_update_requested_raises_a_task_and_says_no_number_was_taken():
    transition = cc.step(S.CC_IN_FLIGHT, cc.CCEvent.RESULT_UPDATE_REQUESTED)
    assert transition.raises_task
    assert "no number captured" in transition.reason


@pytest.mark.parametrize(
    ("state", "event"),
    [
        (S.CC_PENDING, cc.CCEvent.SUBMITTED),
        (S.CC_READY, cc.CCEvent.RESULT_VERIFIED),
        (S.CC_IN_FLIGHT, cc.CCEvent.RENDERED),
        (S.CC_VERIFIED, cc.CCEvent.SUBMITTED),
        (S.CC_UNREACHED, cc.CCEvent.RESULT_VERIFIED),
    ],
)
def test_contact_check_rejects_impossible_events(state, event):
    """A machine that silently absorbs an impossible event hides the bug."""
    with pytest.raises(cc.InvalidTransition):
        cc.step(state, event)


# ------------------------------------------------------------ pattern followup

PF_TABLE = [
    ("trigger detected", P.PF_TRIGGERED, pf.PFEvent.TRIGGER_DETECTED, pf.PFContext(), P.PF_TRIGGERED),
    ("triggered -> screening", P.PF_TRIGGERED, pf.PFEvent.SCREENING_STARTED, pf.PFContext(), P.PF_SCREENING),
    (
        "vulnerable pupil is never called",
        P.PF_SCREENING, pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.PUPIL_VULNERABLE), P.PF_NOT_CALLED,
    ),
    (
        "no first-day process disables the workflow",
        P.PF_SCREENING, pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.NO_FIRST_DAY_PROCESS), P.PF_NOT_CALLED,
    ),
    (
        "a reason recorded since the trigger stops it",
        P.PF_SCREENING, pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.REASON_NOW_RECORDED), P.PF_NOT_CALLED,
    ),
    (
        "an open case stops it",
        P.PF_SCREENING, pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.OPEN_CASE_EXISTS), P.PF_NOT_CALLED,
    ),
    (
        "a non-school day holds at screening",
        P.PF_SCREENING, pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.NON_SCHOOL_DAY), P.PF_SCREENING,
    ),
    (
        "outside the window holds at screening",
        P.PF_SCREENING, pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.OUTSIDE_CALLING_WINDOW), P.PF_SCREENING,
    ),
    ("screening -> cascade ready", P.PF_SCREENING, pf.PFEvent.CONTACT_SELECTED, pf.PFContext(), P.PF_CASCADE_READY),
    (
        "no callable contact at all",
        P.PF_SCREENING, pf.PFEvent.CASCADE_NEXT, pf.PFContext(), P.PF_UNREACHED,
    ),
    ("cascade ready -> in flight", P.PF_CASCADE_READY, pf.PFEvent.SUBMITTED, pf.PFContext(), P.PF_CALL_IN_FLIGHT),
    (
        "unusable contact advances the cascade",
        P.PF_CASCADE_READY, pf.PFEvent.CONTACT_UNUSABLE, pf.PFContext(), P.PF_CASCADE_ADVANCE,
    ),
    (
        "invalid destination advances the cascade",
        P.PF_CASCADE_READY, pf.PFEvent.GUARD_REFUSED,
        pf.PFContext(refusal=NoCallReason.INVALID_DESTINATION), P.PF_CASCADE_ADVANCE,
    ),
    (
        "unsupported language advances the cascade",
        P.PF_CASCADE_READY, pf.PFEvent.GUARD_REFUSED,
        pf.PFContext(refusal=NoCallReason.LANGUAGE_NOT_SUPPORTED), P.PF_CASCADE_ADVANCE,
    ),
    (
        "dry run holds at cascade ready",
        P.PF_CASCADE_READY, pf.PFEvent.GUARD_REFUSED,
        pf.PFContext(refusal=NoCallReason.DRY_RUN), P.PF_CASCADE_READY,
    ),
    (
        "urgent beats everything",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_URGENT, pf.PFContext(), P.PF_URGENT_HUMAN,
    ),
    (
        "reason given",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_REASON_GIVEN, pf.PFContext(), P.PF_REASON_GIVEN,
    ),
    (
        "support requested",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_SUPPORT_REQUESTED, pf.PFContext(),
        P.PF_SUPPORT_REQUESTED,
    ),
    (
        "wrong person advances the cascade",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_WRONG_PERSON, pf.PFContext(), P.PF_CASCADE_ADVANCE,
    ),
    (
        "not in service advances the cascade",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_NOT_IN_SERVICE, pf.PFContext(), P.PF_CASCADE_ADVANCE,
    ),
    (
        "no answer advances the cascade",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_NO_CONTACT, pf.PFContext(), P.PF_CASCADE_ADVANCE,
    ),
    (
        "unusable result needs a human",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.RESULT_NEEDS_HUMAN, pf.PFContext(), P.PF_NEEDS_HUMAN,
    ),
    (
        "submission unknown -> unverified",
        P.PF_CALL_IN_FLIGHT, pf.PFEvent.SUBMISSION_UNKNOWN, pf.PFContext(), P.PF_CALL_UNVERIFIED,
    ),
    (
        "unverified reconciles",
        P.PF_CALL_UNVERIFIED, pf.PFEvent.RECONCILED_TERMINAL, pf.PFContext(), P.PF_CALL_IN_FLIGHT,
    ),
    (
        "unverified binding mismatch needs a human",
        P.PF_CALL_UNVERIFIED, pf.PFEvent.RECONCILE_MISMATCH, pf.PFContext(), P.PF_NEEDS_HUMAN,
    ),
    (
        "cascade advances to the next contact",
        P.PF_CASCADE_ADVANCE, pf.PFEvent.CASCADE_NEXT, pf.PFContext(has_next_contact=True),
        P.PF_CASCADE_READY,
    ),
    (
        "cascade exhausted is unreached",
        P.PF_CASCADE_ADVANCE, pf.PFEvent.CASCADE_NEXT, pf.PFContext(has_next_contact=False),
        P.PF_UNREACHED,
    ),
    (
        "cascade limit reached is unreached",
        P.PF_CASCADE_ADVANCE, pf.PFEvent.CASCADE_NEXT,
        pf.PFContext(has_next_contact=True, cascade_limit_reached=True), P.PF_UNREACHED,
    ),
    (
        "staff resolve a needs-human case",
        P.PF_NEEDS_HUMAN, pf.PFEvent.STAFF_RESOLVED, pf.PFContext(staff_target=P.PF_REASON_GIVEN),
        P.PF_REASON_GIVEN,
    ),
    (
        "staff close an escalation",
        P.PF_URGENT_HUMAN, pf.PFEvent.STAFF_RESOLVED, pf.PFContext(staff_target=P.PF_NOT_CALLED),
        P.PF_NOT_CALLED,
    ),
]


@pytest.mark.parametrize(
    ("label", "state", "event", "context", "expected"), PF_TABLE, ids=[r[0] for r in PF_TABLE]
)
def test_pattern_transitions(label, state, event, context, expected):
    assert pf.step(state, event, context).state is expected, label


def test_vulnerable_refusal_raises_a_staff_task_and_names_the_reason():
    transition = pf.step(
        P.PF_SCREENING,
        pf.PFEvent.SCREENING_REFUSED,
        pf.PFContext(refusal=NoCallReason.PUPIL_VULNERABLE),
    )
    assert transition.raises_task
    assert "vulnerable" in transition.reason
    assert "staff task" in transition.reason


def test_urgent_is_reachable_from_every_live_call_state():
    """It must not be reachable only after other branches have run."""
    for state in (P.PF_CALL_IN_FLIGHT, P.PF_CALL_UNVERIFIED, P.PF_NEEDS_HUMAN):
        transition = pf.step(state, pf.PFEvent.RESULT_URGENT)
        assert transition.state is P.PF_URGENT_HUMAN
        assert transition.urgent
        assert transition.raises_task


def test_urgent_human_is_not_auto_closable():
    """Only a named member of staff closes an escalation."""
    for event in (
        pf.PFEvent.RESULT_REASON_GIVEN,
        pf.PFEvent.RESULT_SUPPORT_REQUESTED,
        pf.PFEvent.CASCADE_NEXT,
        pf.PFEvent.SUBMITTED,
    ):
        with pytest.raises(pf.InvalidTransition):
            pf.step(P.PF_URGENT_HUMAN, event)


def test_wrong_person_and_dead_number_flag_the_contact():
    """The B -> A half of the loop."""
    for event in (pf.PFEvent.RESULT_WRONG_PERSON, pf.PFEvent.RESULT_NOT_IN_SERVICE):
        assert pf.step(P.PF_CALL_IN_FLIGHT, event).flags_contact


def test_exhausted_cascade_raises_a_task():
    """A pupil with no reachable contact is itself a safeguarding finding."""
    transition = pf.step(
        P.PF_CASCADE_ADVANCE, pf.PFEvent.CASCADE_NEXT, pf.PFContext(has_next_contact=False)
    )
    assert transition.raises_task
    assert "no contact reachable" in transition.reason


@pytest.mark.parametrize(
    ("state", "event"),
    [
        (P.PF_TRIGGERED, pf.PFEvent.SUBMITTED),
        (P.PF_SCREENING, pf.PFEvent.RESULT_REASON_GIVEN),
        (P.PF_CASCADE_READY, pf.PFEvent.RESULT_REASON_GIVEN),
        (P.PF_CALL_IN_FLIGHT, pf.PFEvent.CONTACT_SELECTED),
        (P.PF_REASON_GIVEN, pf.PFEvent.SUBMITTED),
        (P.PF_NOT_CALLED, pf.PFEvent.CASCADE_NEXT),
    ],
)
def test_pattern_rejects_impossible_events(state, event):
    with pytest.raises(pf.InvalidTransition):
        pf.step(state, event)


def test_no_transition_reaches_a_success_state_by_default():
    """Fail closed: only an explicit success event produces a success state."""
    successes = {P.PF_REASON_GIVEN, P.PF_SUPPORT_REQUESTED}
    explicit = {pf.PFEvent.RESULT_REASON_GIVEN, pf.PFEvent.RESULT_SUPPORT_REQUESTED,
                pf.PFEvent.STAFF_RESOLVED}
    for state in P:
        for event in pf.PFEvent:
            if event in explicit:
                continue
            try:
                result = pf.step(state, event, pf.PFContext())
            except pf.InvalidTransition:
                continue
            assert result.state not in successes, f"{state.value} + {event.value}"
