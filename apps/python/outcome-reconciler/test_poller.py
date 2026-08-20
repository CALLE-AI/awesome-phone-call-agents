"""Tests for polling, backoff, and budget exhaustion.

The clock and sleep are injected, so a call stuck for five days is driven to
exhaustion in microseconds. Nothing here sleeps and nothing opens a socket.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import pytest

from clients import AuthUnavailableError, PlanTimeoutError, ReplayClient, TransportError
from mapping import OutcomeMap
from poller import DEFAULT_POLICY, PollingPolicy, backoff_delays, poll


@pytest.fixture(scope="module")
def outcome_map() -> OutcomeMap:
    return OutcomeMap.load()


class StepClock:
    def __init__(self, step: float = 1.0) -> None:
        self._now = 0.0
        self._step = step

    def __call__(self) -> float:
        self._now += self._step
        return self._now


class RecordingSleep:
    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


class ScriptedClient:
    surface = "rest.calls"

    def __init__(self, steps: list[Any], auth_error: str | None = None) -> None:
        self.steps = steps
        self.cursor = 0
        self.auth_error = auth_error
        self.auth_checks = 0

    def check_auth(self) -> None:
        self.auth_checks += 1
        if self.auth_error:
            raise AuthUnavailableError(self.auth_error)

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        index = min(self.cursor, len(self.steps) - 1)
        self.cursor += 1
        step = self.steps[index]
        if isinstance(step, Exception):
            raise step
        return step


def run(client: Any, outcome_map: OutcomeMap, policy: PollingPolicy, sleep: Any = None):
    return poll(
        "call_test_reference",
        client,
        outcome_map,
        policy,
        clock=StepClock(),
        sleep=sleep or (lambda _s: None),
        timestamp=lambda: "2026-08-06T10:00:00+00:00",
        jitter=lambda: 0.5,
    )


def test_polling_stops_at_the_observation_budget(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient([{"status": "in_progress"}])
    result = run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=10_000, max_observations=5))
    assert len(result.observations) == 5
    assert result.exhausted is True
    assert result.exhaustion_reason == "polling_budget_exhausted"


def test_polling_stops_at_the_wall_clock_budget(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient([{"status": "in_progress"}])
    result = run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=6, max_observations=10_000))
    assert result.exhausted is True
    assert result.exhaustion_reason == "polling_budget_exhausted"
    assert len(result.observations) < 10_000


def test_a_call_stuck_for_days_still_terminates(outcome_map: OutcomeMap) -> None:
    """Issue #97: no terminal state ever arrives. Reconciliation must still return."""
    client = ReplayClient.from_fixture(Path(__file__).resolve().parent / "fixtures" / "stuck.json")
    result = run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=432_000, max_observations=25))
    assert result.exhausted is True
    assert result.exhaustion_reason == "polling_budget_exhausted"
    assert len(result.observations) == 25


def test_polling_stops_as_soon_as_a_terminal_state_is_seen(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient(
        [{"status": "queued"}, {"status": "in_progress"}, {"status": "completed"}, {"status": "completed"}]
    )
    result = run(client, outcome_map, DEFAULT_POLICY)
    assert len(result.observations) == 3
    assert result.exhausted is False


def test_undocumented_terminal_values_still_end_polling(outcome_map: OutcomeMap) -> None:
    """Terminality is operational: polling stops even where meaning is unpublished."""

    class McpClient(ScriptedClient):
        surface = "mcp.get_call_run"

    client = McpClient([{"status": "IN_PROGRESS"}, {"status": "VOICEMAIL"}])
    result = run(client, outcome_map, DEFAULT_POLICY)
    assert len(result.observations) == 2
    assert result.exhausted is False


def test_transport_errors_are_retried_within_budget(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient(
        [TransportError("connection reset"), TransportError("HTTP 502"), {"status": "completed"}]
    )
    result = run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=1000, max_observations=10))
    assert len(result.observations) == 3
    assert result.exhausted is False
    assert [o.transport_error is not None for o in result.observations] == [True, True, False]


def test_persistent_transport_errors_exhaust_the_budget(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient([TransportError("connection reset")])
    result = run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=1000, max_observations=4))
    assert result.exhausted is True
    assert all(o.transport_error for o in result.observations)


def test_a_request_timeout_stops_polling_with_its_own_reason(outcome_map: OutcomeMap) -> None:
    """Issue #80: a timed-out request has no recoverable state."""
    client = ScriptedClient([PlanTimeoutError("MCP request timed out for tools/call")])
    result = run(client, outcome_map, DEFAULT_POLICY)
    assert result.exhausted is True
    assert result.exhaustion_reason == "plan_timeout"
    assert len(result.observations) == 1


def test_auth_is_rechecked_every_cycle(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient([{"status": "in_progress"}])
    run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=1000, max_observations=4))
    assert client.auth_checks == 4


def test_missing_credentials_surface_as_a_configuration_error(outcome_map: OutcomeMap) -> None:
    """A credential problem must not masquerade as an ambiguous call outcome."""
    client = ScriptedClient([{"status": "completed"}], auth_error="token missing")
    with pytest.raises(AuthUnavailableError, match="token missing"):
        run(client, outcome_map, DEFAULT_POLICY)


def test_credentials_lost_mid_poll_are_recorded_as_evidence(outcome_map: OutcomeMap) -> None:
    """Once observations exist they are worth keeping, so the record is emitted."""

    class ExpiringClient(ScriptedClient):
        def check_auth(self) -> None:
            self.auth_checks += 1
            if self.auth_checks > 2:
                raise AuthUnavailableError("token expired")

    client = ExpiringClient([{"status": "in_progress"}])
    result = run(client, outcome_map, PollingPolicy(max_wall_clock_seconds=1000, max_observations=10))
    assert result.exhausted is True
    assert result.exhaustion_reason == "polling_budget_exhausted"
    assert "authentication became unavailable mid-poll" in (
        result.observations[-1].transport_error or ""
    )


def test_sleep_never_overruns_the_remaining_budget(outcome_map: OutcomeMap) -> None:
    client = ScriptedClient([{"status": "in_progress"}])
    sleep = RecordingSleep()
    policy = PollingPolicy(max_wall_clock_seconds=30, max_observations=100)
    run(client, outcome_map, policy, sleep=sleep)
    assert sleep.calls
    assert all(delay <= policy.max_wall_clock_seconds for delay in sleep.calls)


def test_backoff_doubles_and_caps() -> None:
    policy = PollingPolicy(initial_backoff_seconds=2, max_backoff_seconds=60, jitter_ratio=0.0)
    delays = backoff_delays(policy, 8, jitter=lambda: 0.5)
    assert delays[:5] == [2, 4, 8, 16, 32]
    assert all(delay <= 60 for delay in delays)
    assert delays[-1] == 60


def test_jitter_stays_within_its_declared_ratio() -> None:
    policy = PollingPolicy(initial_backoff_seconds=10, max_backoff_seconds=10, jitter_ratio=0.1)
    lowest = backoff_delays(policy, 3, jitter=lambda: 0.0)
    highest = backoff_delays(policy, 3, jitter=lambda: 1.0)
    assert all(abs(value - 9.0) < 1e-9 for value in lowest)
    assert all(abs(value - 11.0) < 1e-9 for value in highest)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"max_wall_clock_seconds": 0},
        {"max_observations": 0},
        {"initial_backoff_seconds": 0},
        {"max_backoff_seconds": 1, "initial_backoff_seconds": 2},
        {"jitter_ratio": 1.0},
        {"jitter_ratio": -0.1},
    ],
)
def test_invalid_policies_are_rejected(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        PollingPolicy(**kwargs)
