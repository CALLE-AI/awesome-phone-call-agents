"""Proves that a dispatch failure which COULD mean CALL-E already accepted
the request (a timeout, a connection error -- anything other than our own
pre-flight ValueError) leaves a durable ledger record and is never
silently auto-retried on a resume, closing the "every create exception is
treated as if CALL-E never accepted the request" gap a reviewer found.
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

    # A durable breadcrumb exists even though the dispatch never resolved
    # to a call_id -- this is what makes manual reconciliation possible.
    intent_entries = [e for e in ledger.replay("mob_ambig") if e.kind == "dispatch_intent" and e.candidate_id == "c0"]
    assert len(intent_entries) == 1
    dispatched_entries = [e for e in ledger.replay("mob_ambig") if e.kind == "dispatched" and e.candidate_id == "c0"]
    assert dispatched_entries == []  # never resolved


class RefusesC0Transport:
    """If a resumed mobilize() call for the SAME mobilization_id ever
    tries to dispatch c0 again, this raises -- proving the exclusion."""

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        if candidate.id == "c0":
            raise AssertionError("c0 had an ambiguous prior attempt and must never be auto-retried")
        return f"call_{candidate.id}"

    async def poll(self, call_id, *, expected_candidate=None):
        from mobilize.core.types import CallOutcome, CallResult
        candidate_id = call_id.removeprefix("call_")
        return CallResult(
            call_id=call_id, candidate_id=candidate_id, outcome=CallOutcome.FIRM_YES,
            commitment_score=0.9, stated_yes=True, evidence="leaving now",
        )


@pytest.mark.asyncio
async def test_ambiguous_candidate_never_auto_retried_on_resume(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    pool = [make_candidate("c0", accept=0.99, showup=0.99), make_candidate("c1", accept=0.99, showup=0.99)]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=5)

    # First "process": c0's dispatch is ambiguous. c1 (also in this wave,
    # given the pool's high prior scores) dispatches successfully but this
    # fake transport's poll() never resolves it -- short poll_timeout_s so
    # the test doesn't wait out the real 30s default for that to time out.
    await mobilize(need, pool, TimeoutOnFirstAttemptTransport(), ledger=ledger,
                    mobilization_id="mob_resume_ambig", poll_timeout_s=0.3)

    # Second, separate mobilize() call for the SAME mobilization_id --
    # c1 should still be dispatchable and fill the need; c0 must never be
    # retried automatically (RefusesC0Transport would raise if it were).
    result = await mobilize(need, pool, RefusesC0Transport(), ledger=ledger, mobilization_id="mob_resume_ambig")

    assert result.filled
    assert all(r.candidate_id != "c0" for r in result.confirmed)
