"""Candidate ranking and wave-sizing policy.

Given a Need and a pool of Candidates, decide who to call first and how many
to call, then whether a further wave is justified once results land. Since
CALL-E's API has no cancel operation (confirmed from the OpenAPI spec), the
only lever is choosing wave size well: big enough to plausibly fill the need
in one round, small enough not to over-recruit and waste people's time.

Policy: rank by prior_score() (accept rate, show-up rate, recency, distance).
Size the first wave so that expected confirmations >= need.count * safety_margin,
using each candidate's prior as an independent probability estimate.
"""

from __future__ import annotations

from dataclasses import dataclass

from mobilize.core.types import Candidate, Need


@dataclass(frozen=True)
class WavePlan:
    candidates: list[Candidate]
    expected_confirmations: float


def rank_candidates(pool: list[Candidate]) -> list[Candidate]:
    return sorted((c for c in pool if c.eligible), key=lambda c: c.prior_score(), reverse=True)


def plan_wave(
    remaining_pool: list[Candidate],
    need_count: int,
    *,
    safety_margin: float = 1.3,
    max_wave_size: int | None = None,
) -> WavePlan:
    """Choose the smallest prefix of the ranked pool whose expected confirmed
    count meets need_count * safety_margin. This is the over-recruitment
    optimizer described in the plan: greedy by prior_score, which is optimal
    for independent Bernoulli trials when maximizing expected count under a
    cardinality constraint (each candidate contributes independently)."""
    ranked = rank_candidates(remaining_pool)
    target = need_count * safety_margin

    chosen: list[Candidate] = []
    expected = 0.0
    for candidate in ranked:
        if max_wave_size is not None and len(chosen) >= max_wave_size:
            break
        chosen.append(candidate)
        expected += candidate.prior_score()
        if expected >= target:
            break

    return WavePlan(candidates=chosen, expected_confirmations=expected)


def should_dispatch_next_wave(
    *,
    confirmed_count: int,
    need_count: int,
    calls_used: int,
    max_calls: int,
    remaining_pool_size: int,
) -> bool:
    if confirmed_count >= need_count:
        return False
    if calls_used >= max_calls:
        return False
    if remaining_pool_size == 0:
        return False
    return True
