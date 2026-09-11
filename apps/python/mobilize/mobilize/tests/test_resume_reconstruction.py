"""Proves that resuming a mobilization against a ledger that already has
completed confirmations reconstructs them correctly -- doesn't forget them
(and therefore doesn't over-dispatch past the need), and reports a
time-to-fill based on when the confirmation actually happened, not on
this new process's start time."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.types import CallOutcome, CallResult, Need
from mobilize.tests.test_planner import make_candidate


class RefusesToDispatchTransport:
    """If mobilize() tries to dispatch anyone, the resumed run is over-
    counting: the need was already met by prior (reconstructed) results and
    should never have needed a new wave."""

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        raise AssertionError(f"should not dispatch to {candidate.id} -- need was already met")

    async def poll(self, call_id, *, expected_candidate=None):
        return None


@pytest.mark.asyncio
async def test_resume_reconstructs_confirmations_and_does_not_redispatch(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    ledger = Ledger(ledger_path)

    # Simulate a prior process having fully filled a need of 2 and recorded
    # both confirmations, then crashed before returning.
    ledger.record_dispatch("mob_resume", "c0", "call_c0")
    ledger.record_result("mob_resume", "c0", "call_c0", {
        "call_id": "call_c0", "candidate_id": "c0", "outcome": "firm_yes",
        "commitment_score": 0.9, "stated_yes": True, "evidence": "leaving now",
    })
    ledger.record_dispatch("mob_resume", "c1", "call_c1")
    ledger.record_result("mob_resume", "c1", "call_c1", {
        "call_id": "call_c1", "candidate_id": "c1", "outcome": "firm_yes",
        "commitment_score": 0.9, "stated_yes": True, "evidence": "leaving now",
    })

    pool = [make_candidate("c0"), make_candidate("c1"), make_candidate("c2")]
    need = Need(label="x", count=2, deadline_minutes=60, location="loc", max_calls=10)
    transport = RefusesToDispatchTransport()

    result = await mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_resume")

    assert result.filled
    assert len(result.confirmed) == 2
    assert {r.candidate_id for r in result.confirmed} == {"c0", "c1"}
    # calls_used correctly counts the 2 PRIOR dispatches recovered from the
    # ledger. The real assertion is that RefusesToDispatchTransport.dispatch
    # was never called for c2 -- if it had been, the test would have failed
    # with an AssertionError raised from inside dispatch() itself.
    assert result.calls_used == 2


@pytest.mark.asyncio
async def test_resume_time_to_fill_uses_ledger_timestamp_not_resume_time(tmp_path):
    ledger_path = tmp_path / "ledger.jsonl"
    ledger = Ledger(ledger_path)

    # Manually construct a result entry with a specific, known timestamp
    # far in the past relative to "now", simulating a confirmation that
    # landed several minutes into the original (pre-crash) run.
    started_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    confirmed_at = started_at + timedelta(minutes=3)

    ledger._append(_entry(  # noqa: SLF001 -- constructing a specific historical entry deliberately
        "dispatched", "mob_ts", "c0", "call_c0", None, started_at,
    ))
    ledger._append(_entry(
        "result", "mob_ts", "c0", "call_c0",
        {
            "call_id": "call_c0", "candidate_id": "c0", "outcome": "firm_yes",
            "commitment_score": 0.9, "stated_yes": True, "evidence": "leaving now",
        },
        confirmed_at,
    ))

    pool = [make_candidate("c0")]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=10)
    transport = RefusesToDispatchTransport()

    result = await mobilize(need, pool, transport, ledger=ledger, mobilization_id="mob_ts")

    assert result.filled
    assert result.time_to_fill_seconds is not None
    # Should be ~180s (3 minutes), reflecting the ORIGINAL gap between the
    # mobilization's first ledger entry and the confirmation -- not the
    # near-zero value a naive "elapsed since this process started" would
    # produce for a run that never dispatched anything live.
    assert 170 <= result.time_to_fill_seconds <= 190


def _entry(kind, mob_id, cand_id, call_id, payload, at: datetime):
    from mobilize.core.ledger import LedgerEntry
    return LedgerEntry(
        kind=kind, mobilization_id=mob_id, candidate_id=cand_id,
        idempotency_key=f"{mob_id}:{cand_id}", call_id=call_id, payload=payload,
        at=at.isoformat(),
    )
