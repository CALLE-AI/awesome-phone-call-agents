"""Orchestrates a mobilization: wave-based dispatch against any Transport,
ledger-backed for crash safety, stopping as soon as the need is met.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from mobilize.core.ledger import Ledger
from mobilize.core.planner import plan_wave, should_dispatch_next_wave
from mobilize.core.policy import (
    GovernancePolicy,
    GovernanceState,
    add_do_not_call,
    filter_callable,
    record_call,
    save_governance_state,
)
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

# Serializes concurrent mobilize() calls for the SAME mobilization_id within
# one process -- e.g. two browser tabs, or a double-clicked "run" button,
# submitting the identical need+registry at nearly the same instant. Without
# this, both calls can read the ledger's "not yet dispatched" state before
# either has written anything, and both independently decide to dispatch to
# the same candidates. CALL-E's idempotency key would likely deduplicate the
# actual downstream call, but our own ledger would still end up with two
# separate "dispatched" entries for the same (mobilization_id, candidate_id)
# pair -- a violation of the ledger's own invariant even if it doesn't cause
# a real double-dial. Different mobilization_ids use different locks and
# run fully concurrently; only same-ID collisions are serialized. Locks are
# never removed from this dict, which is an acceptable, bounded trade-off
# for a single-operator local tool with a small number of distinct
# mobilizations per session, not something meant to run unbounded forever.
_mobilization_locks: dict[str, asyncio.Lock] = {}
_mobilization_locks_guard = asyncio.Lock()


async def _get_mobilization_lock(mobilization_id: str) -> asyncio.Lock:
    async with _mobilization_locks_guard:
        if mobilization_id not in _mobilization_locks:
            _mobilization_locks[mobilization_id] = asyncio.Lock()
        return _mobilization_locks[mobilization_id]


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
    governance_state_path: str | Path | None = None,
) -> MobilizeResult:
    mobilization_id = mobilization_id or f"mob_{uuid.uuid4().hex[:10]}"
    lock = await _get_mobilization_lock(mobilization_id)
    async with lock:
        return await _mobilize_locked(
            need, pool, transport, ledger=ledger, mobilization_id=mobilization_id,
            poll_interval_s=poll_interval_s, poll_timeout_s=poll_timeout_s,
            recovery_timeout_s=recovery_timeout_s, on_progress=on_progress,
            governance_state=governance_state, governance_policy=governance_policy,
            governance_state_path=governance_state_path,
        )


async def _mobilize_locked(
    need: Need,
    pool: list[Candidate],
    transport: Transport,
    *,
    ledger: Ledger,
    mobilization_id: str,
    poll_interval_s: float,
    poll_timeout_s: float,
    recovery_timeout_s: float,
    on_progress: ProgressCallback | None,
    governance_state: GovernanceState | None,
    governance_policy: GovernancePolicy | None,
    governance_state_path: str | Path | None,
) -> MobilizeResult:

    # Wall-clock, not time.monotonic(), is the timing reference for anything
    # that must mean the same thing across a crash and a resume in a new
    # process: the mobilization's true deadline and its true time-to-fill.
    # `ledger.get_started_at` returns when THIS mobilization_id first
    # appeared in the ledger -- possibly in a prior process -- so a resumed
    # run doesn't get a freshly-extended deadline or under-report how long
    # filling the need actually took. time.monotonic() is still used for the
    # short in-process poll loops below, where sub-second precision and
    # immunity to wall-clock adjustments matter more than cross-process
    # continuity.
    wall_start = ledger.get_started_at(mobilization_id) or datetime.now(timezone.utc)
    deadline_at = wall_start + timedelta(minutes=need.deadline_minutes)

    # Built from the pool BEFORE governance filtering, and never narrowed
    # afterward. Two things depend on having every originally-passed-in
    # candidate available regardless of current governance state: counting
    # calls_used against ledger history (a candidate dispatched in a prior
    # run must still be counted even if they're now on the do-not-call list)
    # and binding validation on poll() for recovered in-flight calls (same
    # reasoning -- governance changing since dispatch must not disable the
    # check that a result actually belongs to who we called).
    by_id_all = {c.id: c for c in pool}

    if governance_state is not None:
        policy = governance_policy or GovernancePolicy()
        original_pool_size = len(pool)
        pool = filter_callable(pool, state=governance_state, policy=policy)
        if len(pool) < original_pool_size and on_progress:
            on_progress("governance_filtered", {
                "blocked": original_pool_size - len(pool),
                "remaining": len(pool),
            })

    remaining = {c.id: c for c in pool}
    all_results: list[CallResult] = []
    waves: list[Wave] = []
    confirmed: list[CallResult] = []
    calls_used = 0
    time_to_fill: float | None = None

    def emit(event: str, data: dict) -> None:
        if on_progress:
            on_progress(event, data)

    def _record_confirmation_if_applicable(result: CallResult, *, at: datetime | None = None) -> None:
        nonlocal time_to_fill
        if result.outcome in CONFIRMED_OUTCOMES and result.commitment_score >= COMMITMENT_THRESHOLD:
            confirmed.append(result)
            if len(confirmed) == need.count and time_to_fill is None:
                timestamp = at or datetime.now(timezone.utc)
                time_to_fill = (timestamp - wall_start).total_seconds()
                emit("need_met", {"time_to_fill_seconds": time_to_fill, "confirmed": len(confirmed)})

    def _maybe_persist_governance() -> None:
        if governance_state is not None and governance_state_path is not None:
            save_governance_state(governance_state, governance_state_path)

    def _apply_opt_out_if_requested(result: CallResult) -> None:
        # A mid-call "don't contact me again" is honored permanently and
        # immediately -- persisted before any further dispatch decision, not
        # just noted for later. This must fire wherever a result can
        # surface: live wave polling, in-flight recovery after a crash, and
        # reconstruction from the ledger on resume (idempotent either way,
        # since add_do_not_call is a set add).
        if result.stop_requested and governance_state is not None:
            add_do_not_call(result.candidate_id, state=governance_state)
            emit("opted_out", {"candidate_id": result.candidate_id})
            _maybe_persist_governance()

    # Recover from a prior crash, in three parts:
    #
    # 1. Reconstruct already-completed confirmations from the ledger. Without
    #    this, a resumed run forgets every confirmation recorded before the
    #    crash and can dispatch to more candidates than the need actually
    #    still requires -- filled needs would keep growing past `need.count`.
    #    Timestamps come from the ledger entry itself, not "now", so
    #    time_to_fill reflects when the confirmation actually happened.
    for entry in ledger.replay(mobilization_id):
        if entry.kind == "result" and entry.payload is not None:
            result = _deserialize(entry.payload)
            all_results.append(result)
            _record_confirmation_if_applicable(result, at=datetime.fromisoformat(entry.at))
            _apply_opt_out_if_requested(result)

    # 2. Every candidate already dispatched for this mobilization_id must
    #    never be dispatched again -- this guarantee comes from the ledger
    #    record alone and holds regardless of what follows. calls_used is
    #    counted from the ledger directly (all "dispatched" entries), not by
    #    intersecting with the current, possibly governance-filtered
    #    `remaining` -- a candidate dispatched in a prior run and since
    #    added to the do-not-call list would otherwise vanish from this
    #    count entirely, silently under-reporting calls_used and letting a
    #    resumed run exceed max_calls.
    in_flight = ledger.in_flight(mobilization_id)
    dispatched_candidate_ids = {
        entry.candidate_id for entry in ledger.replay(mobilization_id) if entry.kind == "dispatched"
    }
    calls_used = len(dispatched_candidate_ids)
    for candidate_id in dispatched_candidate_ids:
        remaining.pop(candidate_id, None)

    # 3. For anyone still in flight (dispatched, no result yet), attempt to
    #    actually recover their outcome by polling. Works against the real
    #    transport, since call state lives server-side and survives a
    #    process restart; SimulatedTransport holds state in memory, so a
    #    fresh instance has no way to resolve a pre-crash simulated call_id
    #    and will simply time out here -- a property of the simulator, not
    #    of this recovery logic.
    if in_flight:
        emit("recovering_in_flight", {"count": len(in_flight)})
        recovery_deadline = time.monotonic() + recovery_timeout_s
        pending_recovery = dict(in_flight)
        while pending_recovery and time.monotonic() < recovery_deadline:
            for candidate_id, call_id in list(pending_recovery.items()):
                result = await transport.poll(call_id, expected_candidate=by_id_all.get(candidate_id))
                if result is None:
                    continue
                pending_recovery.pop(candidate_id)
                all_results.append(result)
                ledger.record_result(mobilization_id, candidate_id, call_id, _serialize(result))
                emit("call_result", {"candidate_id": candidate_id, "outcome": result.outcome.value, "commitment": result.commitment_score})
                _record_confirmation_if_applicable(result)
                _apply_opt_out_if_requested(result)
            if pending_recovery:
                await asyncio.sleep(poll_interval_s)
        for candidate_id in pending_recovery:
            emit("recovery_unresolved", {"candidate_id": candidate_id})

    wave_index = 0
    while (
        datetime.now(timezone.utc) < deadline_at
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

        async def _dispatch_one(candidate: Candidate) -> tuple[str, str | None]:
            # Errors are caught HERE, per candidate, rather than left to
            # propagate out of asyncio.gather(). A bad phone number,
            # transient rate limit, or 5xx for ONE candidate must never
            # cancel SIBLING tasks in this wave -- gather's default
            # behavior on an unhandled exception is to cancel every other
            # pending task, which can tear down another candidate's dispatch
            # coroutine while its real HTTP request to CALL-E is already in
            # flight. That is a genuine call-placed-but-never-ledgered gap:
            # a real call goes out, gets cancelled client-side before
            # ledger.record_dispatch() ever runs, and the crash-safety
            # guarantee this whole module exists for is silently broken.
            try:
                idem_key = ledger.idempotency_key(mobilization_id, candidate.id)
                call_id = await transport.dispatch(candidate, need.label, need.location, idempotency_key=idem_key)
            except Exception as exc:
                emit("dispatch_failed", {"candidate_id": candidate.id, "error": str(exc)})
                return candidate.id, None
            ledger.record_dispatch(mobilization_id, candidate.id, call_id)
            if governance_state is not None:
                record_call(candidate, state=governance_state)
                # Persisted immediately, not just at the end of mobilize(),
                # so a crash right after this dispatch still leaves the
                # do-not-call/cooldown/fatigue state consistent with what
                # was actually dialed. Concurrent saves from other candidates
                # in this same wave are harmless -- each captures the full,
                # already-mutated shared state at the moment it runs, and
                # save is a single synchronous write with no await inside it.
                _maybe_persist_governance()
            return candidate.id, call_id

        # Fire every dispatch in this wave concurrently -- this is the
        # mechanism the whole project is named for. A sequential loop here
        # would await each network round trip in turn, silently serializing
        # what the README, the skill, and the demo all describe as parallel.
        dispatched = await asyncio.gather(*(_dispatch_one(c) for c in plan.candidates))
        call_ids: dict[str, str] = {cid: call_id for cid, call_id in dispatched if call_id is not None}
        failed_ids = [cid for cid, call_id in dispatched if call_id is None]
        # Only successful dispatches count toward the real-world calls_used
        # budget -- a candidate whose dispatch raised before CALL-E ever
        # accepted it was never actually called.
        calls_used += len(call_ids)
        for candidate_id in call_ids:
            remaining.pop(candidate_id, None)
        # A candidate whose dispatch failed synchronously (bad phone, a
        # provider error) is not retried within this same run -- that would
        # risk an infinite loop for a permanently invalid number. They stay
        # visible via the dispatch_failed event for the caller to act on; a
        # later, separate mobilize() call for this mobilization_id can still
        # pick them up since they were never marked as dispatched in the
        # ledger.
        for candidate_id in failed_ids:
            remaining.pop(candidate_id, None)

        pending = dict(call_ids)
        seconds_left_on_deadline = max(0.0, (deadline_at - datetime.now(timezone.utc)).total_seconds())
        poll_deadline = time.monotonic() + min(poll_timeout_s, seconds_left_on_deadline)
        while pending and time.monotonic() < poll_deadline:
            for candidate_id, call_id in list(pending.items()):
                result = await transport.poll(call_id, expected_candidate=by_id_all.get(candidate_id))
                if result is None:
                    continue
                pending.pop(candidate_id)
                wave.results.append(result)
                all_results.append(result)
                ledger.record_result(mobilization_id, candidate_id, call_id, _serialize(result))
                emit("call_result", {"candidate_id": candidate_id, "outcome": result.outcome.value, "commitment": result.commitment_score})
                _record_confirmation_if_applicable(result)
                _apply_opt_out_if_requested(result)

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
        "stop_requested": result.stop_requested,
        "evidence": result.evidence,
    }


def _deserialize(payload: dict) -> CallResult:
    return CallResult(
        call_id=payload["call_id"],
        candidate_id=payload["candidate_id"],
        outcome=CallOutcome(payload["outcome"]),
        commitment_score=payload["commitment_score"],
        stated_yes=payload["stated_yes"],
        # .get() with a default: ledger entries written before this field
        # existed won't have it, and that must not be an error on replay.
        stop_requested=payload.get("stop_requested", False),
        evidence=payload["evidence"],
    )
