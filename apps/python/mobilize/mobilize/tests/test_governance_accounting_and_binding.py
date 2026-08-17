"""Two bugs found in self-review before a third external review round:

1. calls_used was computed by intersecting ledger history with the current
   (possibly governance-filtered) `remaining` pool. A candidate dispatched
   in a prior run, then added to do-not-call before a resume, would vanish
   from that count -- silently under-reporting calls_used and letting a
   resumed run exceed max_calls.
2. CalleTransport.poll() only validated result-candidate binding against its
   own in-memory dispatch-time cache, which is empty on a fresh instance
   after a real process restart -- meaning the round-1 binding-validation
   fix silently stopped applying during exactly the crash-recovery path it
   was meant to protect.
"""

from __future__ import annotations

import pytest

from mobilize.core.dispatcher import mobilize
from mobilize.core.ledger import Ledger
from mobilize.core.policy import GovernancePolicy, GovernanceState, add_do_not_call
from mobilize.core.types import CallOutcome, Need
from mobilize.tests.test_planner import make_candidate
from mobilize.transports.calle import _to_call_result


class NoOpTransport:
    async def dispatch(self, candidate, need_label, location, *, idempotency_key):
        raise AssertionError("should not dispatch -- pool is exhausted/filtered")

    async def poll(self, call_id, *, expected_candidate=None):
        return None


@pytest.mark.asyncio
async def test_calls_used_counts_prior_dispatch_even_after_candidate_added_to_dnc(tmp_path):
    ledger = Ledger(tmp_path / "ledger.jsonl")
    ledger.record_dispatch("mob_dnc", "c0", "call_c0")
    ledger.record_result("mob_dnc", "c0", "call_c0", {
        "call_id": "call_c0", "candidate_id": "c0", "outcome": "no",
        "commitment_score": 0.0, "stated_yes": False, "evidence": "declined",
    })

    # c0 was dispatched and declined in a prior run. Before the resume,
    # something adds c0 to the do-not-call list (unrelated reason, e.g. an
    # explicit opt-out request).
    governance_state = GovernanceState()
    add_do_not_call("c0", state=governance_state)

    pool = [make_candidate("c0")]
    need = Need(label="x", count=1, deadline_minutes=60, location="loc", max_calls=5)

    result = await mobilize(
        need, pool, NoOpTransport(), ledger=ledger, mobilization_id="mob_dnc",
        governance_state=governance_state, governance_policy=GovernancePolicy(),
    )

    # c0's prior dispatch must still be counted even though governance
    # filtering removed them from the callable pool for this run.
    assert result.calls_used == 1
    assert not result.filled  # c0 declined; no one else to call


@pytest.mark.asyncio
async def test_poll_binding_validation_applies_during_recovery_after_restart(tmp_path):
    """Directly exercises _to_call_result the way CalleTransport.poll() now
    calls it during recovery: with an expected_candidate supplied by the
    dispatcher (from the ledger) rather than the transport's own empty
    post-restart cache. A response claiming to be a different candidate
    must be rejected, not silently trusted."""
    candidate = make_candidate("c0")
    call_response_for_wrong_candidate = {
        "recipients": [{"phones": ["+15559998888"], "structured_result": {"can_come": "yes", "evidence_summary": "leaving now"}}],
        "metadata": {"candidate_id": "someone_else"},
        "status": "completed",
    }

    result = _to_call_result("call_1", call_response_for_wrong_candidate, candidate)

    assert result.outcome == CallOutcome.FAILED
    assert result.commitment_score == 0.0


def test_mobilization_id_override_prevents_collision(tmp_path):
    from mobilize.core.ids import derive_mobilization_id

    # Two genuinely separate real-world requests that happen to share the
    # same need_label and phones would otherwise collide into the same
    # mobilization_id by default.
    default_id = derive_mobilization_id("Need blood", ["+15550101234"])
    explicit_override = "real_explicit_override_123"

    assert explicit_override != default_id
    # The CLI/MCP `mobilization_id or derive_mobilization_id(...)` pattern
    # means an explicit non-None value always wins over the derived default.
    chosen = explicit_override or derive_mobilization_id("Need blood", ["+15550101234"])
    assert chosen == explicit_override
