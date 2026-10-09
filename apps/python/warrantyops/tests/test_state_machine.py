"""Conformance: what the code does is what the table says, end to end.

Every scenario fixture runs through the real workflow, the real review and
the real write-back, and each observed transition — attempt, transport,
terminal, claim, review, write-back — must be an edge listed in
``warrantyops/statemachine.py``. A state change that is not in the table is
a bug in the code or a missing row in the table; the test cannot tell
which, which is why the table exists. The recovery edge from ``UNKNOWN`` is
exercised through the fault matrix; here it is asserted by construction
against the same table the docs render.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from warrantyops.authorization import AuthorizationBasis, CallAuthorization
from warrantyops.contract import ClaimStatus
from warrantyops.envelope import source_claim_from_dict
from warrantyops.ledger import InMemoryAttemptLedger
from warrantyops.outcome import TerminalState, TransportState
from warrantyops.providers.fake import FIXTURE_DIR, FakeCallProvider
from warrantyops.review import ReviewDecision, ReviewRecord, prepare_review
from warrantyops.source import InMemorySourceStore
from warrantyops.statemachine import (
    ATTEMPT_TRANSITIONS,
    CLAIM_TRANSITIONS,
    REVIEW_TRANSITIONS,
    START,
    TERMINAL_TRANSITIONS,
    TRANSPORT_TRANSITIONS,
    WRITE_BACK_TRANSITIONS,
    transition_is_listed,
)
from warrantyops.workflow import run_exception
from warrantyops.writeback import (
    InMemoryNoteLedger,
    WriteBackOutcome,
    WriteBackRefusal,
    write_back,
    write_back_outcome,
)

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
PURPOSE = "warranty claim exception follow-up"
SCENARIOS = sorted(path.stem for path in FIXTURE_DIR.glob("*.json"))

ATTEMPT = "attempt"
TRANSPORT = "transport"
TERMINAL = "terminal"
CLAIM = "claim"
REVIEW = "review"
WRITE_BACK = "write-back"

TABLE_FOR = {
    ATTEMPT: ATTEMPT_TRANSITIONS,
    TRANSPORT: TRANSPORT_TRANSITIONS,
    TERMINAL: TERMINAL_TRANSITIONS,
    CLAIM: CLAIM_TRANSITIONS,
    REVIEW: REVIEW_TRANSITIONS,
    WRITE_BACK: WRITE_BACK_TRANSITIONS,
}


def authorization_for(number: str) -> CallAuthorization:
    return CallAuthorization(
        recipient_e164=number,
        basis=AuthorizationBasis.TEST_RECIPIENT_CONSENT,
        purpose=PURPOSE,
        granted_by="fixture-owner",
        granted_at=NOW - timedelta(days=1),
        expires_at=NOW + timedelta(days=1),
        record_reference="synthetic://fixture-authorization",
    )


def run_case(scenario: str, *, approve: bool, note_ledger=None):
    """One scenario end to end.

    Returns ``(observed, result)`` where ``observed`` is every transition
    the run produced and ``result`` is the write-back result (or ``None``
    when the run refused or review was withheld).
    """

    provider = FakeCallProvider(scenario=scenario)
    fixture = provider.load()
    claim = source_claim_from_dict(fixture["envelope"])
    recipient = fixture["recipient_e164"]
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    ledger = InMemoryAttemptLedger()
    run = run_exception(
        claim,
        authorization_for(recipient),
        provider,
        version_reader=store,
        attempt_ledger=ledger,
        now=NOW,
        allowlist=frozenset({recipient}),
    )

    observed: list = []

    for event in ledger.audit_events():
        source = event.from_state or START
        observed.append((ATTEMPT, source, event.to_state))

    if run.refusal is not None:
        observed.append((TRANSPORT, START, TransportState.NOT_ATTEMPTED.value))
        observed.append((TERMINAL, START, TerminalState.NOT_ATTEMPTED.value))
        observed.append((WRITE_BACK, START, WriteBackOutcome.NO_BUSINESS_RESULT.value))
        return observed, None

    outcome = run.outcome
    assert outcome is not None
    observed.append((TRANSPORT, START, outcome.transport.state.value))
    if outcome.transport.state is TransportState.NOT_ATTEMPTED:
        observed.append((TERMINAL, START, TerminalState.NOT_ATTEMPTED.value))
    elif not outcome.transport.is_terminal:
        observed.append((TERMINAL, START, TerminalState.IN_FLIGHT.value))
        observed.append((WRITE_BACK, START, WriteBackOutcome.NO_BUSINESS_RESULT.value))
    else:
        observed.append((TERMINAL, START, TerminalState.IN_FLIGHT.value))
        observed.append((TERMINAL, TerminalState.IN_FLIGHT.value, outcome.terminal_state.value))
    observed.append((CLAIM, START, outcome.business.claim_status.value))

    if not approve:
        observed.append((WRITE_BACK, START, WriteBackOutcome.NOT_REVIEWED.value))
        return observed, None

    packet = prepare_review(outcome, recipient)
    decision = ReviewRecord(
        decision=ReviewDecision.APPROVE,
        reviewer="conformance",
        decided_at=NOW,
        review_id=packet.review_id,
        packet_sha256=packet.packet_sha256,
        operator_id="conformance-operator",
    )
    observed.append((REVIEW, START, ReviewDecision.APPROVE.value))

    source_change = fixture.get("source_change") or {}
    if source_change.get("before_writeback_version"):
        store.set_version(
            claim.source_platform,
            claim.source_claim_id,
            source_change["before_writeback_version"],
        )

    result = write_back(
        claim,
        store,
        note_ledger if note_ledger is not None else InMemoryNoteLedger(),
        packet,
        decision,
        outcome,
        idempotency_key=run.idempotency_key or "",
        written_at=NOW,
    )
    classified = write_back_outcome(result)
    observed.append((WRITE_BACK, START, classified.value))
    if classified is WriteBackOutcome.RECEIPT:
        observed.append((REVIEW, ReviewDecision.APPROVE.value, WriteBackOutcome.RECEIPT.value))
    return observed, result


def unlisted_transitions(observed) -> list:
    return [
        (vocabulary, source, target)
        for vocabulary, source, target in observed
        if not transition_is_listed(TABLE_FOR[vocabulary], source, target)
    ]


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_every_observed_transition_is_listed(scenario):
    observed, _ = run_case(scenario, approve=False)
    assert not unlisted_transitions(observed), unlisted_transitions(observed)


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_every_observed_transition_is_listed_through_write_back(scenario):
    observed, _ = run_case(scenario, approve=True)
    assert not unlisted_transitions(observed), unlisted_transitions(observed)


def test_the_matrix_is_not_vacuous():
    """The scenarios collectively exercise every vocabulary's start edge and
    the folded-terminal, review and write-back paths — otherwise conformance
    could pass on a table nothing ever traverses."""

    seen = set()
    for scenario in SCENARIOS:
        for approve in (False, True):
            observed, _result = run_case(scenario, approve=approve)
            seen.update(observed)
    assert (ATTEMPT, START, "RESERVED") in seen
    assert (TRANSPORT, START, TransportState.NOT_ATTEMPTED.value) in seen
    assert any(
        v == TERMINAL and s == START and t == TerminalState.IN_FLIGHT.value
        for v, s, t in seen
    )
    assert (CLAIM, START, ClaimStatus.UNKNOWN.value) in seen
    assert any(v == CLAIM and t != ClaimStatus.UNKNOWN.value for v, _s, t in seen)
    assert (REVIEW, START, ReviewDecision.APPROVE.value) in seen
    assert (WRITE_BACK, START, WriteBackOutcome.RECEIPT.value) in seen
    assert (WRITE_BACK, START, WriteBackOutcome.SOURCE_CHANGED.value) in seen
    assert (WRITE_BACK, START, WriteBackOutcome.NOT_REVIEWED.value) in seen
    assert (WRITE_BACK, START, WriteBackOutcome.NO_BUSINESS_RESULT.value) in seen


def test_replay_and_conflict_are_edges_of_the_write_back_table():
    ledger = InMemoryNoteLedger()
    provider = FakeCallProvider(scenario="case_a_useful_resolution")
    fixture = provider.load()
    claim = source_claim_from_dict(fixture["envelope"])
    recipient = fixture["recipient_e164"]
    store = InMemorySourceStore()
    store.set_version(claim.source_platform, claim.source_claim_id, claim.source_version)
    run = run_exception(
        claim,
        authorization_for(recipient),
        provider,
        version_reader=store,
        attempt_ledger=InMemoryAttemptLedger(),
        now=NOW,
        allowlist=frozenset({recipient}),
    )
    outcome = run.outcome
    packet = prepare_review(outcome, recipient)
    decision = ReviewRecord(
        decision=ReviewDecision.APPROVE,
        reviewer="conformance",
        decided_at=NOW,
        review_id=packet.review_id,
        packet_sha256=packet.packet_sha256,
        operator_id="conformance-operator",
    )
    first = write_back(
        claim, store, ledger, packet, decision, outcome,
        idempotency_key="warrantyops:conformance", written_at=NOW,
    )
    assert not isinstance(first, WriteBackRefusal)
    # Replay: the same decision again over the same note ledger.
    replay = write_back(
        claim, store, ledger, packet, decision, outcome,
        idempotency_key="warrantyops:conformance", written_at=NOW,
    )
    assert not isinstance(replay, WriteBackRefusal)
    assert replay.replayed
    assert transition_is_listed(
        WRITE_BACK_TRANSITIONS, WriteBackOutcome.RECEIPT.value, WriteBackOutcome.RECEIPT.value
    )
    # A second, different review of the same note identity is the conflict
    # edge — also listed, also never a write.
    from dataclasses import replace

    second_packet = replace(packet, review_id="0" * 32)
    second_decision = replace(decision, review_id=second_packet.review_id)
    conflict = write_back(
        claim, store, ledger, second_packet, second_decision, outcome,
        idempotency_key="warrantyops:conformance", written_at=NOW,
    )
    assert conflict is WriteBackRefusal.REVIEW_CONFLICT
    assert transition_is_listed(
        WRITE_BACK_TRANSITIONS,
        WriteBackOutcome.RECEIPT.value,
        WriteBackOutcome.REVIEW_CONFLICT.value,
    )


# --- the vocabularies never mix ----------------------------------------------

def test_the_terminal_and_claim_vocabularies_share_no_value():
    terminal = {state.value for state in TerminalState}
    claim_values = {status.value for status in ClaimStatus}
    assert terminal & claim_values == set()


def test_terminal_never_reuses_attempt_or_review_values():
    terminal = {state.value for state in TerminalState}
    from warrantyops.ledger import AttemptState
    from warrantyops.review import ReviewDecision

    assert terminal & {s.value for s in AttemptState} == set()
    assert terminal & {d.value for d in ReviewDecision} == set()


def test_the_outcome_vocabulary_mirrors_the_refusals_exactly():
    refusals = {refusal.value for refusal in WriteBackRefusal}
    outcomes = {outcome.value for outcome in WriteBackOutcome}
    assert refusals <= outcomes
    assert WriteBackOutcome.RECEIPT.value in outcomes - refusals
