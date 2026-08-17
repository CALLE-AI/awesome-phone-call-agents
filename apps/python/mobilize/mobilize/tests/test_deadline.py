"""Proves deadline_minutes actually stops the mobilization from dispatching
further waves once the deadline has passed, rather than being a field that's
stored but never checked."""

from __future__ import annotations

import asyncio

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import CallOutcome, CallResult, Need
from mobilize.tests.test_planner import make_candidate


class NeverConfirmsSlowTransport:
    """Every call comes back as a firm 'no' after a short delay, so the
    need is never met and the dispatcher would keep dispatching waves
    forever if the deadline weren't enforced."""

    def __init__(self, delay_s: float = 0.05) -> None:
        self.dispatch_count = 0
        self._delay_s = delay_s

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        self.dispatch_count += 1
        return f"call_{candidate.id}_{self.dispatch_count}"

    async def poll(self, call_id, *, expected_candidate=None):
        await asyncio.sleep(self._delay_s)
        return CallResult(
            call_id=call_id, candidate_id=call_id.split("_")[1],
            outcome=CallOutcome.NO, commitment_score=0.0, stated_yes=False, evidence="",
        )


@pytest.mark.asyncio
async def test_deadline_stops_dispatching_further_waves(tmp_path):
    transport = NeverConfirmsSlowTransport()
    # Small waves (2 candidates each, via a large pool with weak priors so
    # plan_wave doesn't grab everyone in wave 1) and a very short deadline,
    # so if the deadline weren't enforced this would burn through the whole
    # 60-candidate pool across dozens of waves.
    pool = [make_candidate(f"c{i}", accept=0.02, showup=0.02) for i in range(60)]
    need = Need(label="x", count=3, deadline_minutes=0.02, location="loc", max_calls=60)  # 1.2s deadline
    ledger = Ledger(tmp_path / "ledger.jsonl")

    result = await mobilize(need, pool, transport, ledger=ledger, poll_timeout_s=0.5, poll_interval_s=0.01)

    assert not result.filled
    # Loose upper bound: even a couple of waves completing before the
    # deadline trips is fine, but dispatching the entire 60-candidate pool
    # would mean the deadline was never checked at all.
    assert result.calls_used < 60, (
        f"dispatched {result.calls_used} calls against a 1.2s deadline -- "
        f"deadline_minutes does not appear to be enforced"
    )
