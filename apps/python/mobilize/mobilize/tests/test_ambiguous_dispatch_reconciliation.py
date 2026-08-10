"""Proves that a dispatch failure which COULD mean CALL-E already accepted
the request (a timeout, a connection error -- anything other than our own
pre-flight ValueError) leaves a durable ledger record and is never
silently auto-retried on a resume, closing the "every create exception is
treated as if CALL-E never accepted the request" gap a reviewer found.

Also proves the follow-up gap a later review round found: an ambiguous
dispatch must consume the real-world calls_used budget (it might really
have reached CALL-E) and must halt any FURTHER wave -- in this run or a
later resumed one -- until a human reconciles it. Without this, a possibly-
accepted call stays invisible while more calls go out on top of it.
"""

from __future__ import annotations

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import Need
from mobilize.tests.test_planner import make_candidate


class TimeoutOnFirstAttemptTransport:
    """c0's dispatch attempt raises a network-shaped error (NOT a
    ValueError) -- ambiguous, might have actually reached CALL-E. Any other
    candidate in the same wave succeeds normally, proving the ambiguity is
    isolated to c0 specifically rather than poisoning the whole wave."""

    def __init__(self) -> None:
        self.attempts = 0

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        self.attempts += 1
        if candidate.id == "c0":
            raise TimeoutError("simulated network timeout after possible acceptance")
        return f"call_{candidate.id}"

    async def poll(self, call_id, *, expected_candidate=None):
        return None


@pytest.mark.asyncio
async def test_ambiguous_failure_is_reported_and_leaves_a_ledger_breadcrumb(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    transport = TimeoutOnFirstAttemptTransport()
    pool = [make_candidate("c0", accept=0.99, showup=0.99)]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=5)

    result = await mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_ambig")

    assert result.ambiguous_candidate_ids == ["c0"]
    assert not result.filled
    # An ambiguous attempt might really have reached CALL-E -- it must
    # count against the real-world call budget, not be treated as free.
    assert result.calls_used == 1

    # A durable breadcrumb exists even though the dispatch never resolved
    # to a call_id -- this is what makes manual reconciliation possible.
    intent_entries = [e for e in ledger.replay("mob_ambig") if e.kind == "dispatch_intent" and e.candidate_id == "c0"]
    assert len(intent_entries) == 1
    dispatched_entries = [e for e in ledger.replay("mob_ambig") if e.kind == "dispatched" and e.candidate_id == "c0"]
    assert dispatched_entries == []  # never resolved


class RefusesAnyDispatchTransport:
    """If a resumed mobilize() call for the SAME mobilization_id ever
    dispatches ANYONE -- c0 or otherwise -- this raises. A prior run's
    unresolved ambiguity must halt the whole mobilization until a human
    reconciles it, not just exclude the one ambiguous candidate while
    happily dispatching everyone else."""

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        raise AssertionError(
            f"mobilization has an unresolved ambiguous candidate; "
            f"{candidate.id} must never be dispatched until it's reconciled"
        )

    async def poll(self, call_id, *, expected_candidate=None):
        # c1 was genuinely dispatched (has a call_id) in the prior run and
        # is legitimately in flight -- recovering/polling an ALREADY-
        # dispatched call is not a new dispatch and must still be allowed.
        # It's only NEW dispatch() calls (a further wave) that must never
        # happen while c0's ambiguity is unresolved.
        return None


@pytest.mark.asyncio
async def test_unresolved_ambiguity_halts_the_whole_mobilization_on_resume(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    pool = [make_candidate("c0", accept=0.99, showup=0.99), make_candidate("c1", accept=0.99, showup=0.99)]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=5)

    # First "process": c0's dispatch is ambiguous. c1 (also in this wave,
    # given the pool's high prior scores) dispatches successfully but this
    # fake transport's poll() never resolves it -- short poll_timeout_s so
    # the test doesn't wait out the real 30s default for that to time out.
    await mobilize(need, pool, TimeoutOnFirstAttemptTransport(), ledger=ledger,
                    mobilization_id="mob_resume_ambig", poll_timeout_s=0.3)

    # Second, separate mobilize() call for the SAME mobilization_id -- c0's
    # ambiguity is still unresolved, so NO further dispatch happens at all,
    # even to c1, even though the need still looks unmet and c1 was never
    # itself ambiguous. RefusesAnyDispatchTransport would raise if dispatch
    # were attempted for anyone.
    result = await mobilize(need, pool, RefusesAnyDispatchTransport(), ledger=ledger, mobilization_id="mob_resume_ambig")

    assert not result.filled
    assert result.ambiguous_candidate_ids == ["c0"]
    assert result.waves == []


class AmbiguousFirstWaveThenRefusesTransport:
    """The two highest-prior candidates (c0, c1) are dispatched together in
    wave 0; c0 is ambiguous, c1 resolves to a non-confirming outcome. If a
    second wave were ever dispatched to reach the lower-prior remainder of
    the pool, dispatch() raises -- proving it never happens."""

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        if candidate.id == "c0":
            raise ConnectionError("simulated network failure after possible acceptance")
        if candidate.id == "c1":
            return "call_c1"
        raise AssertionError(f"a further wave must never be dispatched while c0 is unresolved (tried {candidate.id})")

    async def poll(self, call_id, *, expected_candidate=None):
        from mobilize.core.types import CallOutcome, CallResult
        return CallResult(
            call_id=call_id, candidate_id="c1", outcome=CallOutcome.NO,
            commitment_score=0.0, stated_yes=False, evidence="not available",
        )


@pytest.mark.asyncio
async def test_ambiguous_dispatch_halts_further_waves_within_the_same_run(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    # c0/c1 are high-prior (dispatched together in wave 0, expected value
    # already clears the target after just these two); c2..c5 are low-prior
    # and would only ever be reached by a SECOND wave.
    pool = [
        make_candidate("c0", accept=0.9, showup=0.9),
        make_candidate("c1", accept=0.9, showup=0.9),
        make_candidate("c2", accept=0.2, showup=0.2),
        make_candidate("c3", accept=0.2, showup=0.2),
    ]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=10)

    result = await mobilize(need, pool, AmbiguousFirstWaveThenRefusesTransport(), ledger=ledger, mobilization_id="mob_halt_wave")

    assert not result.filled
    assert result.ambiguous_candidate_ids == ["c0"]
    # calls_used counts both the ambiguous attempt and c1's real dispatch --
    # under the old behavior calls_used would have been 1 (c1 only) and
    # a second wave would have gone out to c2/c3.
    assert result.calls_used == 2
    assert len(result.waves) == 1
    assert result.waves[0].candidate_ids == ["c0", "c1"]
