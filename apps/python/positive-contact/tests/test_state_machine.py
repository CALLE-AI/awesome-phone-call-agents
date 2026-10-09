"""Every edge in ARCHITECTURE.md section 6, and a set that must not exist."""

from __future__ import annotations

import pytest

from positive_contact.escalate import (
    ALLOWED_EDGES,
    ALLOWED_TRANSITIONS,
    IllegalTransition,
    replay_edge,
    transition,
)
from positive_contact.models import IntentState as S
from positive_contact.models import LadderEvent as E

LEGAL_EDGES = [
    (S.RESERVED, E.CALL_ACCEPTED, S.SUBMITTED),
    (S.RESERVED, E.SUBMISSION_AMBIGUOUS, S.SUBMISSION_UNKNOWN),
    (S.SUBMISSION_UNKNOWN, E.RECONCILED, S.SUBMITTED),
    (S.SUBMISSION_UNKNOWN, E.RECONCILE_FAILED, S.NEEDS_HUMAN),
    (S.SUBMITTED, E.TERMINAL_OBSERVED, S.TERMINAL_UNVERIFIED),
    (S.TERMINAL_UNVERIFIED, E.BINDING_VERIFIED, S.ADJUDICATED),
    (S.TERMINAL_UNVERIFIED, E.BINDING_MISMATCH, S.NEEDS_HUMAN),
    (S.ADJUDICATED, E.DISPOSITION_CONFIRMED, S.CONFIRMED),
    (S.ADJUDICATED, E.DISPOSITION_UNCONFIRMED, S.UNCONFIRMED_WAITING),
    (S.ADJUDICATED, E.DISPOSITION_NEEDS_HUMAN, S.NEEDS_HUMAN),
    (S.UNCONFIRMED_WAITING, E.LADDER_ADVANCED, S.RESERVED),
    (S.UNCONFIRMED_WAITING, E.LADDER_EXHAUSTED, S.FIELD_VISIT_PENDING),
    (S.UNCONFIRMED_WAITING, E.CUTOFF_REACHED, S.FIELD_VISIT_PENDING),
    (S.NEEDS_HUMAN, E.OPERATOR_CONFIRMED, S.CONFIRMED),
    (S.NEEDS_HUMAN, E.CUTOFF_REACHED, S.FIELD_VISIT_PENDING),
    (S.NEEDS_HUMAN, E.OPERATOR_REFUSED, S.CLOSED_REFUSED),
    (S.FIELD_VISIT_PENDING, E.FIELD_VISIT_APPROVED, S.FIELD_VISIT_ISSUED),
]


@pytest.mark.parametrize("state,event,expected", LEGAL_EDGES)
def test_every_legal_edge_in_the_diagram(state, event, expected):
    assert transition(state, event) is expected


def test_the_table_contains_exactly_the_diagram_edges():
    assert len(ALLOWED_TRANSITIONS) == len(LEGAL_EDGES)
    assert {(state, event) for state, event, _ in LEGAL_EDGES} == set(ALLOWED_TRANSITIONS)


ILLEGAL_EDGES = [
    # Voicemail can never be confirmation, so nothing skips adjudication.
    (S.RESERVED, E.DISPOSITION_CONFIRMED),
    # A submitted call cannot be confirmed without a verified re-read.
    (S.SUBMITTED, E.DISPOSITION_CONFIRMED),
    # An unknown submission never becomes a call by wishing.
    (S.SUBMISSION_UNKNOWN, E.TERMINAL_OBSERVED),
    # A terminal state is terminal.
    (S.CONFIRMED, E.LADDER_ADVANCED),
    (S.CLOSED_REFUSED, E.OPERATOR_CONFIRMED),
    (S.FIELD_VISIT_ISSUED, E.CUTOFF_REACHED),
    # An operator cannot confirm a contact that was never adjudicated.
    (S.RESERVED, E.OPERATOR_CONFIRMED),
    # A field visit cannot be issued without passing through the pending queue.
    (S.NEEDS_HUMAN, E.FIELD_VISIT_APPROVED),
    # Binding checks cannot be skipped.
    (S.TERMINAL_UNVERIFIED, E.DISPOSITION_CONFIRMED),
    # The adjudicator does not get to advance the ladder itself.
    (S.ADJUDICATED, E.LADDER_ADVANCED),
]


@pytest.mark.parametrize("state,event", ILLEGAL_EDGES)
def test_illegal_transitions_raise(state, event):
    with pytest.raises(IllegalTransition):
        transition(state, event)


def test_at_least_six_illegal_transitions_are_asserted():
    assert len(ILLEGAL_EDGES) >= 6


def test_replay_accepts_the_opening_edge():
    assert replay_edge(None, S.RESERVED) is S.RESERVED


def test_replay_accepts_the_ladder_advance_opening():
    assert replay_edge(S.UNCONFIRMED_WAITING, S.RESERVED) is S.RESERVED


def test_replay_rejects_an_edge_that_is_not_in_the_graph():
    with pytest.raises(IllegalTransition):
        replay_edge(S.RESERVED, S.CONFIRMED)


def test_replay_rejects_a_forged_start():
    with pytest.raises(IllegalTransition):
        replay_edge(None, S.CONFIRMED)


def test_allowed_edges_are_derived_from_the_table():
    for (state, _event), target in ALLOWED_TRANSITIONS.items():
        assert (state, target) in ALLOWED_EDGES
