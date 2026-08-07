"""Proves a mid-call opt-out ("don't contact me again") is detected and
persisted as a permanent do-not-call entry immediately -- not just
documented as a promise in safety.md, which is what a reviewer found: the
code had no path that ever called add_do_not_call outside of tests."""

from __future__ import annotations

from datetime import timedelta

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.policy import GovernancePolicy, GovernanceState
from mobilize.core.types import CallOutcome, CallResult, Need
from mobilize.tests.test_planner import make_candidate


class OptOutTransport:
    """c0 explicitly opts out; c1 behaves normally."""

    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        return f"call_{candidate.id}"

    async def poll(self, call_id, *, expected_candidate=None):
        candidate_id = call_id.removeprefix("call_")
        if candidate_id == "c0":
            return CallResult(
                call_id=call_id, candidate_id="c0", outcome=CallOutcome.NO,
                commitment_score=0.0, stated_yes=False, stop_requested=True,
                evidence="Please don't call me again.",
            )
        return CallResult(
            call_id=call_id, candidate_id=candidate_id, outcome=CallOutcome.FIRM_YES,
            commitment_score=0.9, stated_yes=True, stop_requested=False,
            evidence="leaving now",
        )


@pytest.mark.asyncio
async def test_opt_out_persists_do_not_call_immediately(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    governance_state = GovernanceState()
    governance_state_path = tmp_path / "gov.json"

    pool = [make_candidate("c0", accept=0.99, showup=0.99), make_candidate("c1", accept=0.99, showup=0.99)]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=10)

    events = []
    await mobilize(
        need, pool, OptOutTransport(), ledger=ledger, mobilization_id="mob_optout",
        governance_state=governance_state, governance_policy=GovernancePolicy(),
        governance_state_path=governance_state_path,
        on_progress=lambda event, data: events.append((event, data)),
    )

    assert "c0" in governance_state.do_not_call
    assert "c1" not in governance_state.do_not_call
    assert ("opted_out", {"candidate_id": "c0"}) in events

    # And it's actually on disk, not just in the in-memory object -- a
    # future, separate invocation loading from this path must see it.
    from mobilize.core.policy import load_governance_state
    reloaded = load_governance_state(governance_state_path)
    assert "c0" in reloaded.do_not_call


@pytest.mark.asyncio
async def test_opted_out_candidate_never_dispatched_in_a_future_mobilization(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    governance_state = GovernanceState()
    governance_state_path = tmp_path / "gov.json"
    # Zero cooldown: this test isolates do-not-call persistence specifically.
    # With the default 12h cooldown, c1 (legitimately called and confirmed
    # in the first mobilization) would ALSO be filtered from the second one
    # by cooldown, which is correct governance behavior but would make this
    # test's assertion about c0-specifically ambiguous.
    policy = GovernancePolicy(cooldown=timedelta(seconds=0))

    pool = [make_candidate("c0", accept=0.99, showup=0.99), make_candidate("c1", accept=0.99, showup=0.99)]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=10)

    # First mobilization: c0 opts out.
    await mobilize(
        need, pool, OptOutTransport(), ledger=ledger, mobilization_id="mob_first",
        governance_state=governance_state, governance_policy=policy,
        governance_state_path=governance_state_path,
    )
    assert "c0" in governance_state.do_not_call

    # Second, separate mobilization -- loading fresh from disk, the way the
    # real CLI/MCP entry points do at the top of every invocation.
    from mobilize.core.policy import load_governance_state

    class RefusesC0Transport(OptOutTransport):
        async def dispatch(self, candidate, need_label, location, *, idempotency_key):
            if candidate.id == "c0":
                raise AssertionError("c0 opted out in a prior mobilization and must never be dispatched again")
            return await super().dispatch(candidate, need_label, location, idempotency_key=idempotency_key)

    fresh_governance_state = load_governance_state(governance_state_path)
    result = await mobilize(
        need, pool, RefusesC0Transport(), ledger=ledger, mobilization_id="mob_second",
        governance_state=fresh_governance_state, governance_policy=policy,
        governance_state_path=governance_state_path,
    )
    assert result.filled  # c1 alone should still fill a need of 1
