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


# -- transport error classification -----------------------------------------


def rest_client(monkeypatch: pytest.MonkeyPatch, error: Exception) -> "RestStatusClient":
    from clients import REST_API_KEY_ENV_VAR, RestStatusClient
    import urllib.request

    monkeypatch.setenv(REST_API_KEY_ENV_VAR, "fake-status-token")
    monkeypatch.setenv("CALLE_TEST_API_KEY", "fake-status-token")

    def refuse(*_args: Any, **_kwargs: Any) -> None:
        raise error

    # `_get` builds its own opener so it can refuse redirects, so patch the
    # opener rather than the module-level urlopen.
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", refuse)
    return RestStatusClient(base_url="http://127.0.0.1:1")


def test_a_read_timeout_is_a_plan_timeout_not_a_transport_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = rest_client(monkeypatch, TimeoutError("timed out"))
    with pytest.raises(PlanTimeoutError):
        client.fetch("call_x")


def test_a_connect_timeout_wrapped_in_urlerror_is_still_a_plan_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """urllib wraps connect-phase timeouts, and socket.timeout is TimeoutError.

    Classified as a transport error, a real request timeout would be reported
    as an exhausted budget — the distinction this layer exists to draw.
    """
    import urllib.error

    client = rest_client(monkeypatch, urllib.error.URLError(TimeoutError("timed out")))
    with pytest.raises(PlanTimeoutError):
        client.fetch("call_x")


def test_a_genuine_network_error_stays_a_transport_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    client = rest_client(monkeypatch, urllib.error.URLError(ConnectionRefusedError("refused")))
    with pytest.raises(TransportError):
        client.fetch("call_x")


def test_an_auth_rejection_is_not_a_transport_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    client = rest_client(
        monkeypatch, urllib.error.HTTPError("http://x", 401, "Unauthorized", {}, None)
    )
    with pytest.raises(AuthUnavailableError):
        client.fetch("call_x")


def test_the_documented_host_is_the_default(monkeypatch: pytest.MonkeyPatch) -> None:
    from clients import DEFAULT_BASE_URL, REST_BASE_URL_ENV_VAR, resolve_base_url

    monkeypatch.delenv(REST_BASE_URL_ENV_VAR, raising=False)
    assert resolve_base_url(None) == DEFAULT_BASE_URL
    assert resolve_base_url("https://api.heycall-e.com/") == DEFAULT_BASE_URL


def test_the_base_url_can_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from clients import REST_BASE_URL_ENV_VAR, resolve_base_url

    monkeypatch.setenv(REST_BASE_URL_ENV_VAR, "http://127.0.0.1:8080")
    assert resolve_base_url(None) == "http://127.0.0.1:8080"
    assert resolve_base_url("http://localhost:9000") == "http://localhost:9000"


@pytest.mark.parametrize(
    "base_url",
    [
        "https://api.heycall-e.com.attacker.example",  # suffix, not the host
        "https://notapi.heycall-e.com",
        "http://api.heycall-e.com",  # unencrypted
        "https://api.heycall-e.com:4443",  # unexpected port
        "https://api.heycall-e.com/v1",  # path
        "https://api.heycall-e.com?x=1",  # query
        "https://user:pw@api.heycall-e.com",  # embedded credentials
        "https://evil.example",
        "http://192.168.1.5:8080",  # not loopback
        "http://localhost",  # loopback needs an explicit port
        "api.heycall-e.com",  # not a URL
        "",
    ],
)
def test_the_api_key_is_never_sent_to_an_untrusted_host(base_url: str) -> None:
    """https alone proves the transport, not who answers. The host must be exact.

    This runs before the key is read: a warning would be useless, because by the
    time anyone saw it the credential would already have left.
    """
    from clients import ConfigurationError, validate_base_url

    with pytest.raises(ConfigurationError, match="not a host this app trusts"):
        validate_base_url(base_url)


@pytest.mark.parametrize(
    "base_url,expected",
    [
        ("https://api.heycall-e.com", "https://api.heycall-e.com"),
        ("https://api.heycall-e.com:443", "https://api.heycall-e.com"),
        ("https://API.HeyCall-E.com", "https://api.heycall-e.com"),
        ("http://127.0.0.1:52229", "http://127.0.0.1:52229"),
        ("http://localhost:8080/", "http://localhost:8080"),
    ],
)
def test_trusted_hosts_are_accepted_and_normalised(base_url: str, expected: str) -> None:
    from clients import validate_base_url

    assert validate_base_url(base_url) == expected


# -- permanent vs retryable upstream errors ---------------------------------
#
# The poller retries TransportError within budget. Anything permanent must not
# go down that path: on a metered API, retrying a 404 sixty times spends the
# caller's quota to be told the same thing sixty times.


@pytest.mark.parametrize("code", [400, 404, 405, 410, 422])
def test_a_permanent_http_error_is_not_retried(
    monkeypatch: pytest.MonkeyPatch, code: int
) -> None:
    import urllib.error

    from clients import UpstreamRequestError

    client = rest_client(monkeypatch, urllib.error.HTTPError("http://x", code, "no", {}, None))
    with pytest.raises(UpstreamRequestError):
        client.fetch("call_x")


@pytest.mark.parametrize("code", [408, 429, 500, 502, 503])
def test_a_transient_http_error_is_still_retryable(
    monkeypatch: pytest.MonkeyPatch, code: int
) -> None:
    import urllib.error

    client = rest_client(monkeypatch, urllib.error.HTTPError("http://x", code, "no", {}, None))
    with pytest.raises(TransportError):
        client.fetch("call_x")


def test_a_missing_reference_stops_the_run_rather_than_burning_the_budget(
    monkeypatch: pytest.MonkeyPatch, outcome_map: OutcomeMap
) -> None:
    """A 404 must escape poll(), not be absorbed as one more failed observation."""
    import urllib.error

    from clients import UpstreamRequestError

    client = rest_client(monkeypatch, urllib.error.HTTPError("http://x", 404, "no", {}, None))
    with pytest.raises(UpstreamRequestError, match="no record of"):
        poll(
            "call_typo",
            client,
            outcome_map,
            PollingPolicy(max_wall_clock_seconds=60, max_observations=60),
            clock=StepClock(),
            sleep=lambda _s: None,
        )


def test_the_production_key_is_never_sent_over_plaintext(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Loopback exists for fake servers, and a fake server gets a fake credential.

    Positive control first: with the test credential set, the same client works.
    Without it, the production key must not be substituted.
    """
    from clients import REST_API_KEY_ENV_VAR, AuthUnavailableError, RestStatusClient

    monkeypatch.setenv(REST_API_KEY_ENV_VAR, "production-key-value")
    monkeypatch.setenv("CALLE_TEST_API_KEY", "throwaway")
    assert RestStatusClient(base_url="http://127.0.0.1:9").check_auth() is None

    monkeypatch.delenv("CALLE_TEST_API_KEY", raising=False)
    with pytest.raises(AuthUnavailableError, match="not https"):
        RestStatusClient(base_url="http://127.0.0.1:9").check_auth()


def test_the_production_key_is_still_used_for_the_real_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from clients import DEFAULT_BASE_URL, REST_API_KEY_ENV_VAR, RestStatusClient

    monkeypatch.setenv(REST_API_KEY_ENV_VAR, "production-key-value")
    monkeypatch.delenv("CALLE_TEST_API_KEY", raising=False)
    assert RestStatusClient(base_url=DEFAULT_BASE_URL).check_auth() is None


def test_a_redirect_is_refused_rather_than_followed_with_the_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """urllib copies Authorization onto a redirect without rechecking the host.

    The base-URL allowlist only ever sees the first URL, so a 302 from a trusted
    origin would carry the API key to any host upstream named.
    """
    import urllib.request

    from clients import UpstreamRequestError, _RefuseRedirects

    handler = _RefuseRedirects()
    request = urllib.request.Request("https://api.heycall-e.com/v1/calls/x")
    with pytest.raises(UpstreamRequestError, match="was not forwarded"):
        handler.redirect_request(request, None, 302, "Found", {}, "https://evil.example/steal")


def test_the_rest_client_installs_the_refusing_redirect_handler() -> None:
    """Positive control: the handler is actually wired into the opener."""
    import inspect

    from clients import _RestReader

    assert "_RefuseRedirects()" in inspect.getsource(_RestReader._get), (
        "the redirect guard is defined but not installed on the opener"
    )
