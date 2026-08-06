"""Governance guardrails: do-not-call, cooldowns, contact fatigue, and
calling-hour windows. Applied before a candidate is ever handed to a
transport for dispatch.

This is deliberately separate from the planner (which optimizes for filling
the need) so that governance constraints are enforced independently of
optimization -- a candidate on the do-not-call list is never called no
matter how attractive their prior_score is.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mobilize.core.types import Candidate


@dataclass
class GovernanceState:
    """Tracks state that persists across mobilizations for one pool.

    This must survive across separate process invocations to mean anything
    -- a fresh GovernanceState() constructed on every CLI or MCP call makes
    do-not-call, cooldown, and contact-fatigue tracking silently useless
    beyond a single run. See `save_governance_state` / `load_governance_state`.
    """

    do_not_call: set[str] = field(default_factory=set)
    last_called_at: dict[str, datetime] = field(default_factory=dict)
    calls_in_window: dict[str, list[datetime]] = field(default_factory=dict)


@dataclass(frozen=True)
class GovernancePolicy:
    cooldown: timedelta = timedelta(hours=12)
    max_calls_per_window: int = 2
    window: timedelta = timedelta(days=30)
    calling_hours_start: time = time(8, 0)
    calling_hours_end: time = time(21, 0)
    emergency_override: bool = False  # explicit, logged override for genuine time-critical needs


def _local_time(now: datetime, candidate_timezone: str) -> time:
    try:
        zone = ZoneInfo(candidate_timezone)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    return now.astimezone(zone).time()


def is_callable(
    candidate: Candidate,
    *,
    state: GovernanceState,
    policy: GovernancePolicy,
    now: datetime | None = None,
) -> tuple[bool, str | None]:
    """Return (allowed, reason_if_blocked)."""
    now = now or datetime.now(timezone.utc)

    if candidate.id in state.do_not_call:
        return False, "do_not_call"

    if not policy.emergency_override:
        # Compared against the RECIPIENT's local time, not server/UTC time --
        # a candidate 8 timezones away must not be called at 3am their time
        # just because it's a reasonable hour on the machine running this.
        local_time = _local_time(now, candidate.timezone)
        if not (policy.calling_hours_start <= local_time <= policy.calling_hours_end):
            return False, "outside_calling_hours"

    last_called = state.last_called_at.get(candidate.id)
    if last_called is not None and (now - last_called) < policy.cooldown:
        return False, "cooldown_active"

    window_start = now - policy.window
    recent = [t for t in state.calls_in_window.get(candidate.id, []) if t >= window_start]
    if len(recent) >= policy.max_calls_per_window:
        return False, "contact_fatigue_limit"

    return True, None


def filter_callable(
    candidates: list[Candidate],
    *,
    state: GovernanceState,
    policy: GovernancePolicy,
    now: datetime | None = None,
) -> list[Candidate]:
    return [c for c in candidates if is_callable(c, state=state, policy=policy, now=now)[0]]


def record_call(candidate: Candidate, *, state: GovernanceState, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    state.last_called_at[candidate.id] = now
    state.calls_in_window.setdefault(candidate.id, []).append(now)


def add_do_not_call(candidate_id: str, *, state: GovernanceState) -> None:
    """Permanent and immediate -- a candidate can request removal at any time,
    including mid-call, and must never be dispatched again for any need."""
    state.do_not_call.add(candidate_id)


def save_governance_state(state: GovernanceState, path: str | Path) -> None:
    payload = {
        "do_not_call": sorted(state.do_not_call),
        "last_called_at": {k: v.isoformat() for k, v in state.last_called_at.items()},
        "calls_in_window": {
            k: [t.isoformat() for t in v] for k, v in state.calls_in_window.items()
        },
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def load_governance_state(path: str | Path) -> GovernanceState:
    path = Path(path)
    if not path.exists():
        return GovernanceState()
    payload = json.loads(path.read_text())
    return GovernanceState(
        do_not_call=set(payload.get("do_not_call", [])),
        last_called_at={k: datetime.fromisoformat(v) for k, v in payload.get("last_called_at", {}).items()},
        calls_in_window={
            k: [datetime.fromisoformat(t) for t in v]
            for k, v in payload.get("calls_in_window", {}).items()
        },
    )
