"""Simulated transport: implements the exact same interface as the real
CALL-E transport, so the dispatcher/planner/reconciler code path is identical
whether running the zero-cost evaluation harness or a real mobilization.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime

from mobilize.core.commitment import calibrated_commitment
from mobilize.core.types import Candidate, CallOutcome, CallResult, utcnow
from mobilize.sim.population import SyntheticDonor, simulate_call

_PendingCall = tuple[SyntheticDonor, dict, float, datetime]


class SimulatedTransport:
    """Deterministic-given-seed simulated transport.

    Call latency is modeled as a small random number of `tick()` calls before
    a result becomes available, mimicking real dial + conversation latency
    without needing wall-clock sleeps during the evaluation harness sweeps.
    """

    def __init__(self, donors: list[SyntheticDonor], *, seed: int = 0, min_latency_s: float = 0.05, max_latency_s: float = 0.4):
        self._by_id = {d.candidate.id: d for d in donors}
        self._rng = random.Random(seed)
        self._pending: dict[str, _PendingCall] = {}
        self._min_latency_s = min_latency_s
        self._max_latency_s = max_latency_s
        self.calls_placed = 0

    async def dispatch(self, candidate: Candidate, need_label: str, location: str) -> str:
        donor = self._by_id[candidate.id]
        call_id = f"sim_{uuid.uuid4().hex[:12]}"
        outcome = simulate_call(donor, self._rng)
        latency = self._rng.uniform(self._min_latency_s, self._max_latency_s)
        self._pending[call_id] = (donor, outcome, latency, utcnow())
        self.calls_placed += 1
        return call_id

    async def poll(self, call_id: str) -> CallResult | None:
        entry = self._pending.get(call_id)
        if entry is None:
            return None
        donor, outcome, latency, started = entry
        elapsed = (utcnow() - started).total_seconds()
        if elapsed < latency:
            return None

        can_come = outcome["can_come"]
        evidence = outcome["evidence_summary"]
        picked_up = outcome["_picked_up"]

        if not picked_up:
            result_outcome = CallOutcome.NO_ANSWER
            commitment = 0.0
        elif can_come == "no":
            result_outcome = CallOutcome.INELIGIBLE if not donor.candidate.eligible else CallOutcome.NO
            commitment = 0.0
        else:
            commitment = calibrated_commitment(
                evidence=evidence,
                candidate_prior_showup_rate=donor.candidate.historical_showup_rate,
            )
            result_outcome = CallOutcome.FIRM_YES if commitment >= 0.6 else CallOutcome.SOFT_YES

        return CallResult(
            call_id=call_id,
            candidate_id=donor.candidate.id,
            outcome=result_outcome,
            commitment_score=commitment,
            stated_yes=(can_come == "yes"),
            evidence=evidence,
            transcript=[{"speaker": "bot", "text": "Can you help?"}, {"speaker": "user", "text": evidence}],
            completed_at=utcnow(),
            raw={**outcome, "_true_showup": outcome["_true_showup"]},
        )
