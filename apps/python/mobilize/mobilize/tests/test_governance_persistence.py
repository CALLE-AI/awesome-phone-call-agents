from datetime import datetime, time, timedelta, timezone

from mobilize.core.policy import (
    GovernancePolicy,
    GovernanceState,
    add_do_not_call,
    is_callable,
    load_governance_state,
    record_call,
    save_governance_state,
)
from mobilize.core.types import Candidate

NOON_UTC = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def make_candidate(id_="c1", tz="UTC") -> Candidate:
    return Candidate(
        id=id_, phone="+15550000000", name=id_, days_since_last_action=90,
        distance_km=5, historical_accept_rate=0.5, historical_showup_rate=0.5,
        timezone=tz,
    )


def test_save_and_load_round_trip(tmp_path):
    path = tmp_path / "gov.json"
    state = GovernanceState()
    candidate = make_candidate("c1")
    record_call(candidate, state=state, now=NOON_UTC)
    add_do_not_call("c2", state=state)

    save_governance_state(state, path)
    loaded = load_governance_state(path)

    assert "c2" in loaded.do_not_call
    assert loaded.last_called_at["c1"] == NOON_UTC
    assert loaded.calls_in_window["c1"] == [NOON_UTC]


def test_load_missing_file_returns_empty_state(tmp_path):
    loaded = load_governance_state(tmp_path / "does_not_exist.json")
    assert loaded.do_not_call == set()
    assert loaded.last_called_at == {}


def test_persisted_cooldown_survives_a_reload_simulating_a_new_process(tmp_path):
    """The actual bug being fixed: do-not-call/cooldown state must survive
    across separate invocations of the CLI/MCP entry points, not just
    within one mobilize() call."""
    path = tmp_path / "gov.json"
    policy = GovernancePolicy(cooldown=timedelta(hours=12))
    candidate = make_candidate("c1")

    # "Process 1": call the candidate, persist state.
    state_1 = GovernanceState()
    record_call(candidate, state=state_1, now=NOON_UTC)
    save_governance_state(state_1, path)

    # "Process 2": a brand new GovernanceState() loaded from disk should
    # still see the cooldown from process 1.
    state_2 = load_governance_state(path)
    allowed, reason = is_callable(candidate, state=state_2, policy=policy, now=NOON_UTC + timedelta(hours=1))
    assert not allowed
    assert reason == "cooldown_active"


def test_calling_hours_use_recipient_local_time_not_server_utc():
    """A candidate in a timezone where local calling hours differ from
    server UTC must be evaluated against THEIR local time."""
    policy = GovernancePolicy(calling_hours_start=time(8, 0), calling_hours_end=time(21, 0))
    state = GovernanceState()

    # 2026-01-01 02:00 UTC is 07:30 in Kolkata (UTC+5:30) -- just before the
    # 8am local start, so it should be blocked for a Kolkata candidate...
    early_utc = datetime(2026, 1, 1, 2, 0, tzinfo=timezone.utc)
    kolkata_candidate = make_candidate("kolkata", tz="Asia/Kolkata")
    allowed, reason = is_callable(kolkata_candidate, state=state, policy=policy, now=early_utc)
    assert not allowed
    assert reason == "outside_calling_hours"

    # ...but 2026-01-01 06:00 UTC is 11:30 in Kolkata, well within hours,
    # even though a naive UTC-only check (6am) would also block it.
    later_utc = datetime(2026, 1, 1, 6, 0, tzinfo=timezone.utc)
    allowed, reason = is_callable(kolkata_candidate, state=state, policy=policy, now=later_utc)
    assert allowed


def test_calling_hours_unknown_timezone_falls_back_to_utc():
    policy = GovernancePolicy()
    state = GovernanceState()
    candidate = make_candidate("c1", tz="Not/A/RealZone")
    # Must not raise -- falls back to UTC rather than crashing on a bad
    # timezone string.
    is_callable(candidate, state=state, policy=policy, now=NOON_UTC)
