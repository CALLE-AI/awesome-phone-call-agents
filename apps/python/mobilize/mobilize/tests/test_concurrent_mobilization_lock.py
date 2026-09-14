"""Proves two concurrent mobilize() calls for the IDENTICAL mobilization_id
within one process (two browser tabs, a double-clicked button) don't race
each other into dispatching the same candidates twice before either call's
ledger writes land."""

from __future__ import annotations

import asyncio

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import Need
from mobilize.tests.test_planner import make_candidate


class SlowDispatchTransport:
    """Deliberately slow dispatch, so two concurrent mobilize() calls for
    the same mobilization_id are guaranteed to overlap in time -- without
    the lock, both would read the ledger's empty pre-dispatch state before
    either writes anything."""

    def __init__(self) -> None:
        self.dispatch_calls: list[str] = []

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        self.dispatch_calls.append(candidate.id)
        await asyncio.sleep(0.1)
        return f"call_{candidate.id}"

    async def poll(self, call_id, *, expected_candidate=None):
        return None


@pytest.mark.asyncio
async def test_concurrent_calls_for_same_mobilization_id_do_not_double_dispatch(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    transport = SlowDispatchTransport()
    pool = [make_candidate("c0", accept=0.99, showup=0.99)]
    need = Need(label="x", count=5, deadline_minutes=60, location="loc", max_calls=5)

    # Two "requests" for the exact same mobilization, launched together.
    results = await asyncio.gather(
        mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_race", poll_timeout_s=0.5),
        mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_race", poll_timeout_s=0.5),
    )

    # c0 must have been dispatched exactly once across BOTH calls combined
    # -- the second call, serialized behind the lock, must see c0 already
    # in the ledger and not attempt it again.
    assert transport.dispatch_calls.count("c0") == 1

    dispatched_entries = [e for e in ledger.replay("mob_race") if e.kind == "dispatched" and e.candidate_id == "c0"]
    assert len(dispatched_entries) == 1


@pytest.mark.asyncio
async def test_concurrent_calls_for_different_mobilization_ids_run_independently(tmp_path):
    """The lock must not serialize UNRELATED mobilizations -- only same-ID
    collisions are a correctness concern."""
    ledger = Ledger(tmp_path / "ledger.jsonl")
    transport = SlowDispatchTransport()
    pool = [make_candidate("c0", accept=0.99, showup=0.99)]
    need = Need(label="x", count=5, deadline_minutes=60, location="loc", max_calls=5)

    poll_timeout_s = 0.3
    start = asyncio.get_event_loop().time()
    await asyncio.gather(
        mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_a", poll_timeout_s=poll_timeout_s),
        mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_b", poll_timeout_s=poll_timeout_s),
    )
    elapsed = asyncio.get_event_loop().time() - start

    # This fake transport's poll() always returns None, so each individual
    # mobilize() call runs out its full poll_timeout_s (~0.3s) waiting for a
    # result that never arrives, regardless of the lock. The dispatch-side
    # 0.1s sleep is not what dominates timing here. The signal that actually
    # distinguishes "ran concurrently" from "incorrectly serialized by the
    # lock" is staying near ONE poll_timeout_s, not two -- if the two
    # different-mobilization_id calls were wrongly serialized, this would
    # take close to 2 * poll_timeout_s (~0.6s).
    assert elapsed < poll_timeout_s * 1.5
