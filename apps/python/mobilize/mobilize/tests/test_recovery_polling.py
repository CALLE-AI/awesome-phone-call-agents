"""Proves that on restart, mobilize() actually polls recovered in-flight
call_ids for their results (works against a transport whose state survives
a process restart) instead of silently abandoning them, which was the
original behavior a reviewer flagged."""

from __future__ import annotations

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import CallOutcome, CallResult, Need
from mobilize.tests.test_planner import make_candidate


class PreResolvedTransport:
    """Simulates a transport whose call state lives server-side (like real
    CALL-E): pre-seeded with a result for a call_id that was 'dispatched'
    before this process instance existed, standing in for a post-restart
    poll against a call the previous process placed."""

    def __init__(self, prefilled: dict[str, CallResult]) -> None:
        self._prefilled = prefilled
        self.poll_calls: list[str] = []
        self.dispatch_calls = 0

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        self.dispatch_calls += 1
        return f"new_call_{candidate.id}"

    async def poll(self, call_id):
        self.poll_calls.append(call_id)
        return self._prefilled.get(call_id)


@pytest.mark.asyncio
async def test_recovered_in_flight_call_is_polled_and_counted(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    ledger = Ledger(ledger_path)

    # Simulate a prior process having dispatched one candidate and crashed
    # before recording a result.
    ledger.record_dispatch("mob_x", "c0", "provider_call_c0")

    firm_result = CallResult(
        call_id="provider_call_c0", candidate_id="c0",
        outcome=CallOutcome.FIRM_YES, commitment_score=0.9, stated_yes=True,
        evidence="leaving now",
    )
    transport = PreResolvedTransport({"provider_call_c0": firm_result})

    pool = [make_candidate("c0"), make_candidate("c1", accept=0.01, showup=0.01)]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=10)

    result = await mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_x",
                             recovery_timeout_s=2.0)

    # The recovered call must have been polled...
    assert "provider_call_c0" in transport.poll_calls
    # ...and its firm confirmation must count toward the need, without ever
    # re-dispatching c0.
    assert result.filled
    assert any(r.candidate_id == "c0" for r in result.confirmed)
    dispatched_candidates = [
        e.candidate_id for e in ledger.replay("mob_x") if e.kind == "dispatched"
    ]
    assert dispatched_candidates.count("c0") == 1
