"""Proves wave dispatch is actually concurrent, not just described as such.

A reviewer correctly pointed out that the original implementation awaited
each transport.dispatch() in a sequential `for` loop, which -- against a
transport with real per-call latency -- serializes what the whole project
claims is parallel. This test uses a fake transport with an artificial
per-dispatch delay and asserts the wall-clock time for dispatching N
candidates is close to one delay, not N delays.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import CallOutcome, CallResult, Need
from mobilize.tests.test_planner import make_candidate

DISPATCH_DELAY_S = 0.2


class SlowSequentialCheckTransport:
    """dispatch() sleeps to simulate network latency. If the dispatcher
    awaits these sequentially, N candidates take N * DISPATCH_DELAY_S.
    If concurrent, they take roughly one DISPATCH_DELAY_S regardless of N."""

    def __init__(self) -> None:
        self.dispatch_calls: list[float] = []

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        self.dispatch_calls.append(time.monotonic())
        await asyncio.sleep(DISPATCH_DELAY_S)
        return f"call_{candidate.id}"

    async def poll(self, call_id):
        return CallResult(
            call_id=call_id, candidate_id=call_id.removeprefix("call_"),
            outcome=CallOutcome.NO, commitment_score=0.0, stated_yes=False, evidence="",
        )


@pytest.mark.asyncio
async def test_wave_dispatch_is_concurrent_not_sequential(tmp_path):
    transport = SlowSequentialCheckTransport()
    pool = [make_candidate(f"c{i}", accept=0.01, showup=0.01) for i in range(8)]
    need = Need(label="x", count=100, deadline_minutes=60, location="loc", max_calls=8)
    ledger = Ledger(tmp_path / "ledger.jsonl")

    start = time.monotonic()
    await mobilize(need, pool, transport, ledger=ledger, poll_timeout_s=1.0)
    elapsed = time.monotonic() - start

    # Sequential would take ~8 * 0.2s = 1.6s just for dispatch. Concurrent
    # dispatch plus a short poll loop should stay well under that.
    assert elapsed < DISPATCH_DELAY_S * 3, (
        f"wave dispatch took {elapsed:.2f}s for 8 candidates at {DISPATCH_DELAY_S}s each -- "
        f"looks sequential, not concurrent"
    )
    assert len(transport.dispatch_calls) == 8

    # All 8 dispatch() calls should have started within one delay window of
    # each other -- the clearest direct evidence of concurrency.
    spread = max(transport.dispatch_calls) - min(transport.dispatch_calls)
    assert spread < DISPATCH_DELAY_S, f"dispatch start times spread over {spread:.2f}s -- not concurrent"
