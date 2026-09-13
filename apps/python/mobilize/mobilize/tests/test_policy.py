from datetime import datetime, time, timedelta, timezone

from mobilize.core.policy import (
    GovernancePolicy,
    GovernanceState,
    add_do_not_call,
    is_callable,
    record_call,
)
from mobilize.core.types import Candidate

NOON = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
NIGHT = datetime(2026, 1, 1, 23, 0, tzinfo=timezone.utc)


def make_candidate(id_="c1") -> Candidate:
    return Candidate(
        id=id_, phone="+15550000000", name=id_, days_since_last_action=90,
        distance_km=5, historical_accept_rate=0.5, historical_showup_rate=0.5,
    )


def test_do_not_call_blocks_permanently():
    state = GovernanceState()
    policy = GovernancePolicy()
    candidate = make_candidate()
    add_do_not_call(candidate.id, state=state)
    allowed, reason = is_callable(candidate, state=state, policy=policy, now=NOON)
    assert not allowed and reason == "do_not_call"


def test_outside_calling_hours_blocks():
    state = GovernanceState()
    policy = GovernancePolicy(calling_hours_start=time(8, 0), calling_hours_end=time(21, 0))
    candidate = make_candidate()
    allowed, reason = is_callable(candidate, state=state, policy=policy, now=NIGHT)
    assert not allowed and reason == "outside_calling_hours"


def test_emergency_override_bypasses_calling_hours():
    state = GovernanceState()
    policy = GovernancePolicy(emergency_override=True)
    candidate = make_candidate()
    allowed, _ = is_callable(candidate, state=state, policy=policy, now=NIGHT)
    assert allowed


def test_cooldown_blocks_recent_call():
    state = GovernanceState()
    policy = GovernancePolicy(cooldown=timedelta(hours=12))
    candidate = make_candidate()
    record_call(candidate, state=state, now=NOON)
    allowed, reason = is_callable(candidate, state=state, policy=policy, now=NOON + timedelta(hours=1))
    assert not allowed and reason == "cooldown_active"


def test_cooldown_expires():
    state = GovernanceState()
    policy = GovernancePolicy(cooldown=timedelta(hours=2))
    candidate = make_candidate()
    record_call(candidate, state=state, now=NOON)
    allowed, _ = is_callable(candidate, state=state, policy=policy, now=NOON + timedelta(hours=3))
    assert allowed


def test_contact_fatigue_limit():
    state = GovernanceState()
    policy = GovernancePolicy(max_calls_per_window=2, window=timedelta(days=30), cooldown=timedelta(seconds=1))
    candidate = make_candidate()
    record_call(candidate, state=state, now=NOON - timedelta(days=10))
    record_call(candidate, state=state, now=NOON - timedelta(days=5))
    allowed, reason = is_callable(candidate, state=state, policy=policy, now=NOON)
    assert not allowed and reason == "contact_fatigue_limit"


def test_contact_fatigue_window_expires_old_calls():
    state = GovernanceState()
    policy = GovernancePolicy(max_calls_per_window=2, window=timedelta(days=30), cooldown=timedelta(seconds=1))
    candidate = make_candidate()
    record_call(candidate, state=state, now=NOON - timedelta(days=40))
    record_call(candidate, state=state, now=NOON - timedelta(days=35))
    allowed, _ = is_callable(candidate, state=state, policy=policy, now=NOON)
    assert allowed
