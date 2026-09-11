"""Proves that one candidate's dispatch failure cannot cancel a sibling's
in-flight dispatch. Before this fix, asyncio.gather()'s default behavior on
an unhandled exception cancels every other pending task in the same
gather() call -- meaning a bad phone number or a transient provider error
for ONE candidate could tear down another candidate's real, in-flight
CALL-E request before ledger.record_dispatch() ever ran for it. That is a
call-placed-but-never-ledgered gap: the exact crash-safety property this
whole module exists to guarantee, broken by something as mundane as one
malformed number in a batch.
"""

from __future__ import annotations

import asyncio

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import Need
from mobilize.tests.test_planner import make_candidate


class OneBadAppleTransport:
    """c_bad's dispatch() raises immediately. c_good and c_slow succeed,
    but c_slow's dispatch() is deliberately slow -- if gather's default
    cancellation behavior were still in effect, c_bad's exception firing
    while c_slow is still mid-`await` would cancel c_slow's dispatch,
    proving the isolation gap. With the fix, c_slow must complete normally
    regardless of what c_bad does."""

    def __init__(self) -> None:
        self.slow_completed = False
        self.slow_cancelled = False

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        if candidate.id == "c_bad":
            raise ValueError("Phone number is not valid E.164: 'garbage'")
        if candidate.id == "c_slow":
            try:
                await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                self.slow_cancelled = True
                raise
            self.slow_completed = True
            return "call_c_slow"
        return f"call_{candidate.id}"

    async def poll(self, call_id, *, expected_candidate=None):
        return None


@pytest.mark.asyncio
async def test_one_bad_candidate_does_not_cancel_a_sibling_in_flight_dispatch(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    transport = OneBadAppleTransport()
    pool = [
        make_candidate("c_good", accept=0.01, showup=0.01),
        make_candidate("c_bad", accept=0.01, showup=0.01),
        make_candidate("c_slow", accept=0.01, showup=0.01),
    ]
    need = Need(label="x", count=10, deadline_minutes=60, location="loc", max_calls=10)

    events = []
    result = await mobilize(
        need, pool, transport, ledger=ledger, mobilization_id="mob_isolation",
        on_progress=lambda event, data: events.append((event, data)),
        poll_timeout_s=0.5,
    )

    assert transport.slow_completed, "c_slow's dispatch was cancelled by c_bad's exception -- isolation failed"
    assert not transport.slow_cancelled

    # c_bad's failure is surfaced, not swallowed.
    assert any(event == "dispatch_failed" and data["candidate_id"] == "c_bad" for event, data in events)

    # c_good and c_slow were both actually dispatched and ledgered.
    dispatched_ids = {e.candidate_id for e in ledger.replay("mob_isolation") if e.kind == "dispatched"}
    assert dispatched_ids == {"c_good", "c_slow"}
    assert "c_bad" not in dispatched_ids

    # calls_used only counts real dispatches, not the failed attempt.
    assert result.calls_used == 2
