"""Orchestrates a mobilization: wave-based dispatch against any Transport,
ledger-backed for crash safety, stopping as soon as the need is met.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Callable

from mobilize.core.ledger import Ledger
from mobilize.core.planner import plan_wave, should_dispatch_next_wave
from mobilize.core.policy import GovernancePolicy, GovernanceState, filter_callable, record_call
from mobilize.core.types import (
    Candidate,
    CallOutcome,
    CallResult,
    MobilizeResult,
    Need,
    Wave,
)
from mobilize.transports.base import Transport

CONFIRMED_OUTCOMES = {CallOutcome.FIRM_YES, CallOutcome.SOFT_YES}
COMMITMENT_THRESHOLD = 0.55  # commitment_score at/above this counts toward "confirmed"

ProgressCallback = Callable[[str, dict], None]


async def mobilize(
    need: Need,
    pool: list[Candidate],
    transport: Transport,
    *,
    ledger: Ledger,
    mobilization_id: str | None = None,
    poll_interval_s: float = 0.05,
    poll_timeout_s: float = 30.0,
    recovery_timeout_s: float = 5.0,
    on_progress: ProgressCallback | None = None,
    governance_state: GovernanceState | None = None,
    governance_policy: GovernancePolicy | None = None,
) -> MobilizeResult:
    mobilization_id = mobilization_id or f"mob_{uuid.uuid4().hex[:10]}"
    start = time.monotonic()
    deadline_at = start + need.deadline_minutes * 60

    if governance_state is not None:
        policy = governance_policy or GovernancePolicy()
        original_pool_size = len(pool)
        pool = filter_callable(pool, state=governance_state, policy=policy)
        if len(pool) < original_pool_size and on_progress:
            on_progress("governance_filtered", {
                "blocked": original_pool_size - len(pool),
                "remaining": len(pool),
            })

    by_id = {c.id: c for c in pool}
    remaining = dict(by_id)
    all_results: list[CallResult] = []
    waves: list[Wave] = []
    confirmed: list[CallResult] = []
    calls_used = 0
    time_to_fill: float | None = None

    def emit(event: str, data: dict) -> None:
        if on_progress:
            on_progress(event, data)

    def _record_confirmation_if_applicable(result: CallResult) -> None:
        nonlocal time_to_fill
        if result.outcome in CONFIRMED_OUTCOMES and result.commitment_score >= COMMITMENT_THRESHOLD:
            confirmed.append(result)
            if len(confirmed) == need.count and time_to_fill is None:
                time_to_fill = time.monotonic() - start
                emit("need_met", {"time_to_fill_seconds": time_to_fill, "confirmed": len(confirmed)})

    # Recover from a prior crash. Every candidate already dispatched for this
    # mobilization_id must never be dispatched again -- that guarantee comes
    # from the ledger record alone and holds regardless of what follows. What
    # follows is an attempt to actually recover their outcome: poll each
    # recovered call_id (works against the real transport, since call state
    # lives server-side and survives a process restart; SimulatedTransport
    # holds state in memory, so a fresh instance has no way to resolve a
    # pre-crash simulated call_id and will simply time out here -- a property
    # of the simulator, not of this recovery logic).
    in_flight = ledger.in_flight(mobilization_id)
    for candidate_id in list(remaining):
        if ledger.already_dispatched(mobilization_id, candidate_id):
            remaining.pop(candidate_id, None)
            calls_used += 1

    if in_flight:
        emit("recovering_in_flight", {"count": len(in_flight)})
        recovery_deadline = time.monotonic() + recovery_timeout_s
        pending_recovery = dict(in_flight)
        while pending_recovery and time.monotonic() < recovery_deadline:
            for candidate_id, call_id in list(pending_recovery.items()):
                result = await transport.poll(call_id)
                if result is None:
                    continue
                pending_recovery.pop(candidate_id)
                all_results.append(result)
                ledger.record_result(mobilization_id, candidate_id, call_id, _serialize(result))
                emit("call_result", {"candidate_id": candidate_id, "outcome": result.outcome.value, "commitment": result.commitment_score})
                _record_confirmation_if_applicable(result)
            if pending_recovery:
                await asyncio.sleep(poll_interval_s)
        for candidate_id in pending_recovery:
            emit("recovery_unresolved", {"candidate_id": candidate_id})

    wave_index = 0
    while (
        time.monotonic() < deadline_at
        and should_dispatch_next_wave(
            confirmed_count=len(confirmed),
            need_count=need.count,
            calls_used=calls_used,
            max_calls=need.max_calls,
            remaining_pool_size=len(remaining),
        )
    ):
        remaining_needed = need.count - len(confirmed)
        budget_left = need.max_calls - calls_used
        plan = plan_wave(list(remaining.values()), remaining_needed, max_wave_size=budget_left)
        if not plan.candidates:
            break

        wave = Wave(index=wave_index, candidate_ids=[c.id for c in plan.candidates])
        emit("wave_dispatch", {"wave": wave_index, "candidates": [c.id for c in plan.candidates]})

        async def _dispatch_one(candidate: Candidate) -> tuple[str, str]:
            idem_key = ledger.idempotency_key(mobilization_id, candidate.id)
            call_id = await transport.dispatch(candidate, need.label, need.location, idempotency_key=idem_key)
            ledger.record_dispatch(mobilization_id, candidate.id, call_id)
            if governance_state is not None:
                record_call(candidate, state=governance_state)
            return candidate.id, call_id

        # Fire every dispatch in this wave concurrently -- this is the
        # mechanism the whole project is named for. A sequential loop here
        # would await each network round trip in turn, silently serializing
        # what the README, the skill, and the demo all describe as parallel.
        dispatched = await asyncio.gather(*(_dispatch_one(c) for c in plan.candidates))
        call_ids: dict[str, str] = dict(dispatched)
        calls_used += len(call_ids)
        for candidate_id in call_ids:
            remaining.pop(candidate_id, None)

        pending = dict(call_ids)
        poll_deadline = min(time.monotonic() + poll_timeout_s, deadline_at)
        while pending and time.monotonic() < poll_deadline:
            for candidate_id, call_id in list(pending.items()):
                result = await transport.poll(call_id)
                if result is None:
                    continue
                pending.pop(candidate_id)
                wave.results.append(result)
                all_results.append(result)
                ledger.record_result(mobilization_id, candidate_id, call_id, _serialize(result))
                emit("call_result", {"candidate_id": candidate_id, "outcome": result.outcome.value, "commitment": result.commitment_score})
                _record_confirmation_if_applicable(result)

            if pending:
                await asyncio.sleep(poll_interval_s)

        for candidate_id in pending:
            emit("call_timed_out", {"candidate_id": candidate_id})

        waves.append(wave)
        wave_index += 1

        if len(confirmed) >= need.count:
            break

    filled = len(confirmed) >= need.count
    over_recruitment = (calls_used / need.count) if need.count else 0.0

    return MobilizeResult(
        need=need,
        confirmed=confirmed,
        all_results=all_results,
        waves=waves,
        calls_used=calls_used,
        time_to_fill_seconds=time_to_fill,
        filled=filled,
        over_recruitment_ratio=over_recruitment,
    )


def _serialize(result: CallResult) -> dict:
    return {
        "call_id": result.call_id,
        "candidate_id": result.candidate_id,
        "outcome": result.outcome.value,
        "commitment_score": result.commitment_score,
        "stated_yes": result.stated_yes,
        "evidence": result.evidence,
    }
